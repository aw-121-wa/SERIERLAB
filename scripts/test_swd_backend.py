import unittest
import os
import pathlib
import shutil
import subprocess
import tempfile
from unittest.mock import patch
from swd_backend import Backend, encode_value, decode_value, checked_parameter, write_parameter, load_elf, select_parameters, verify_firmware


class Region:
    is_ram = True
    is_writable = True
    start = 0x20000000
    end = start + 1023


class Memory:
    def get_region_for_address(self, address):
        return Region() if Region.start <= address <= Region.end else None


class Target:
    memory_map = Memory()
    value = 0
    def read_memory(self, address, transfer_size=32):
        return self.value
    def write_memory(self, address, value, transfer_size=32):
        self.value = value
    def flush(self):
        pass


class BackendTests(unittest.TestCase):
    def test_attach_options_and_disconnect_never_control_core(self):
        import sys
        import types
        target = Target()
        target.get_state = lambda: 'RUNNING'
        session = types.SimpleNamespace(target=target, open=lambda: None, close=lambda: None)
        created = []
        def create_session(probe, options):
            created.append(options)
            return session
        modules = {
            'pyocd.core.helpers': types.SimpleNamespace(ConnectHelper=types.SimpleNamespace(
                get_all_connected_probes=lambda blocking: [types.SimpleNamespace(unique_id='dap1')])),
            'pyocd.core.session': types.SimpleNamespace(Session=create_session),
            'pyocd.core.target': types.SimpleNamespace(Target=types.SimpleNamespace(State=types.SimpleNamespace(RUNNING='RUNNING'))),
        }
        symbol = dict(path='kp', address=0x20000000, type='float32', size=4, writable=True)
        with patch.dict(sys.modules, modules), patch('swd_backend.load_elf', return_value=([symbol], [], 'hash')), patch('swd_backend.verify_firmware', return_value=128):
            backend = Backend()
            result = backend.dispatch('connect', dict(elf='test.elf', target='stm32f407vg', watch=[dict(path='kp')]))
            self.assertEqual(result['verifiedBytes'], 128)
            self.assertEqual(created[0]['connect_mode'], 'attach')
            self.assertFalse(created[0]['auto_unlock'])
            self.assertFalse(created[0]['resume_on_disconnect'])
            self.assertFalse(created[0]['cache.enable_memory'])
            self.assertTrue(created[0]['no_config'])
            self.assertEqual(created[0]['user_script'], os.devnull)
            self.assertEqual(backend.dispatch('write', dict(id=1, value=5)), 5)
            backend.dispatch('disconnect', {})
            self.assertIsNone(backend.session)
            with self.assertRaisesRegex(ValueError, 'disconnected'):
                backend.dispatch('write', dict(id=1, value=6))
    def test_selection_rejects_ambiguous_and_duplicate_names(self):
        symbol = dict(path='kp', address=0x20000000, type='float32', size=4, writable=True)
        for symbols, watches in [([symbol, dict(symbol, address=0x20000004)], [{'path':'kp'}]),
                                 ([symbol], [{'path':'kp'}, {'path':'kp'}]),
                                 ([symbol], [{'path':'kp', 'min':10, 'max':1}]),
                                 ([symbol], [{'path':'missing'}])]:
            with self.assertRaises(ValueError):
                select_parameters(symbols, watches)

    def test_firmware_mismatch_and_no_flash_rejected(self):
        target = Target()
        with self.assertRaisesRegex(ValueError, 'no immutable'):
            verify_firmware(target, [])
        region = Region()
        region.is_flash = True
        target.memory_map = type('Map', (), {'get_region_for_address': lambda _, a: region})()
        target.read_memory_block8 = lambda a, n: [0] * n
        with self.assertRaisesRegex(ValueError, 'does not match'):
            verify_firmware(target, [(region.start, b'abc')])
        self.assertEqual(verify_firmware(target, [(region.start, bytes(10))]), 10)

    def test_roundtrip(self):
        for kind, value in [('float32', 3.5), ('int32', -42), ('uint32', 4294967295), ('bool', True)]:
            self.assertEqual(decode_value(kind, encode_value(kind, value)), value)

    def test_reject_bad_values(self):
        for kind, value in [('float32', float('nan')), ('float32', 1e100), ('int32', 2.5), ('uint32', -1), ('bool', 1), ('int32', True)]:
            with self.assertRaises(ValueError):
                encode_value(kind, value)

    def test_memory_validation(self):
        param = dict(path='kp', address=0x20000000, type='float32', size=4, writable=True)
        checked_parameter(Target(), param)
        for update in [dict(address=0x08000000), dict(address=0x20000001), dict(writable=False), dict(address=0x200003ff)]:
            with self.assertRaises(ValueError):
                checked_parameter(Target(), dict(param, **update))

    def test_write_bounds_and_readback(self):
        target = Target()
        p = dict(path='kp', address=0x20000000, type='float32', size=4, writable=True, min=0, max=20)
        self.assertEqual(write_parameter(target, p, 3.5), 3.5)
        with self.assertRaises(ValueError):
            write_parameter(target, p, 21)
        self.assertEqual(target.value, encode_value('float32', 3.5))

    def test_failed_readback(self):
        target = Target()
        target.read_memory = lambda *a, **kw: 0
        p = dict(path='kp', address=0x20000000, type='float32', size=4, writable=True)
        with self.assertRaisesRegex(ValueError, 'readback'):
            write_parameter(target, p, 3.5)


@unittest.skipUnless(shutil.which('arm-none-eabi-gcc'), 'ARM compiler unavailable')
class ElfTests(unittest.TestCase):
    def test_real_arm_dwarf(self):
        fixtures = pathlib.Path(__file__).parent / 'fixtures'
        with tempfile.TemporaryDirectory() as tmp:
            elf = os.path.join(tmp, 'params.elf')
            subprocess.run(['arm-none-eabi-gcc', '-g', '-O2', '-nostdlib', '-mcpu=cortex-m4', '-mthumb',
                            str(fixtures / 'swd_params.c'), '-T', str(fixtures / 'swd_params.ld'), '-o', elf], check=True)
            symbols, immutable, digest = load_elf(elf)
            by_path = {s['path']: s for s in symbols}
            self.assertEqual(by_path['yaw_kp']['type'], 'float32')
            self.assertEqual(by_path['negative']['type'], 'int32')
            self.assertEqual(by_path['count']['type'], 'uint32')
            self.assertEqual(by_path['enabled']['size'], 1)
            self.assertEqual(by_path['pid.inner.limit']['address'], by_path['pid.kp']['address'] + 4)
            self.assertEqual(by_path['gains[2]']['address'], by_path['gains[0]']['address'] + 8)
            self.assertNotIn('fixed', by_path)
            self.assertNotIn('pointer', by_path)
            self.assertNotIn('bits.bit', by_path)
            self.assertTrue(immutable)
            self.assertEqual(len(digest), 64)


if __name__ == '__main__':
    unittest.main()
