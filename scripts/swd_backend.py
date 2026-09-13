"""Serial Lab SWD helper. JSON lines on stdout; diagnostics on stderr.

No firmware agent, flash operations, core halt/reset or expression evaluation.
"""
import contextlib
import hashlib
import json
import math
import os
import struct
import subprocess
import sys


FORMATS = {'float32': ('f', 4), 'int32': ('i', 4), 'uint32': ('I', 4), 'bool': ('?', 1)}


def encode_value(kind, value):
    if kind not in FORMATS:
        raise ValueError('unsupported parameter type')
    if kind == 'bool':
        if not isinstance(value, bool):
            raise ValueError('bool required')
    elif isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError('finite number required')
    elif kind != 'float32' and int(value) != value:
        raise ValueError('integer required')
    try:
        data = struct.pack('<' + FORMATS[kind][0], value if kind in ('bool', 'float32') else int(value))
    except (OverflowError, struct.error) as exc:
        raise ValueError('value outside type range') from exc
    return int.from_bytes(data, 'little')


def decode_value(kind, raw):
    fmt, size = FORMATS[kind]
    value = struct.unpack('<' + fmt, raw.to_bytes(size, 'little'))[0]
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError('target contains non-finite float')
    return value


def checked_parameter(target, param):
    address, size = param['address'], param['size']
    if not param['writable'] or size != FORMATS[param['type']][1] or address % size:
        raise ValueError('parameter must be writable and naturally aligned')
    region = target.memory_map.get_region_for_address(address)
    if not region or not region.is_ram or not region.is_writable or address + size - 1 > region.end:
        raise ValueError('parameter is outside target writable RAM')


def read_parameter(target, param):
    checked_parameter(target, param)
    return decode_value(param['type'], target.read_memory(param['address'], transfer_size=param['size'] * 8))


def write_parameter(target, param, value):
    checked_parameter(target, param)
    raw = encode_value(param['type'], value)
    rounded = decode_value(param['type'], raw)
    for candidate in (value, rounded):
        if ('min' in param and candidate < param['min']) or ('max' in param and candidate > param['max']):
            raise ValueError('value outside configured bounds')
    target.write_memory(param['address'], raw, transfer_size=param['size'] * 8)
    target.flush()
    actual = target.read_memory(param['address'], transfer_size=param['size'] * 8)
    if actual != raw:
        raise ValueError('write readback mismatch; target may also be updating this variable')
    return decode_value(param['type'], actual)


def load_elf(filename):
    from elftools.elf.elffile import ELFFile
    from elftools.dwarf.dwarf_expr import DWARFExprParser
    with open(filename, 'rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        stream.seek(0)
        elf = ELFFile(stream)
        if elf['e_machine'] != 'EM_ARM' or not elf.little_endian or elf.elfclass != 32:
            raise ValueError('32-bit little-endian ARM ELF required')
        if not elf.has_dwarf_info():
            raise ValueError('ELF has no DWARF; rebuild firmware with debug information (-g)')
        dwarf = elf.get_dwarf_info()
        parser = DWARFExprParser(dwarf.structs)
        sections = list(elf.iter_sections())
        result = []
        seen = set()

        def name(die):
            attr = die.attributes.get('DW_AT_name')
            return attr.value.decode('utf-8', 'replace') if attr else ''

        def byte_size(die, depth=0):
            if not die or depth > 12:
                return None
            if 'DW_AT_byte_size' in die.attributes:
                return die.attributes['DW_AT_byte_size'].value
            if die.tag in ('DW_TAG_typedef', 'DW_TAG_volatile_type', 'DW_TAG_const_type', 'DW_TAG_restrict_type') and 'DW_AT_type' in die.attributes:
                return byte_size(die.get_DIE_from_attribute('DW_AT_type'), depth + 1)
            return None

        def expand(die, path, address, readonly=False, depth=0, source_file=None):
            if die is None or depth > 12 or len(result) > 20000:
                return
            tag = die.tag
            if tag in ('DW_TAG_typedef', 'DW_TAG_volatile_type', 'DW_TAG_const_type', 'DW_TAG_restrict_type'):
                if 'DW_AT_type' in die.attributes:
                    expand(die.get_DIE_from_attribute('DW_AT_type'), path, address,
                           readonly or tag == 'DW_TAG_const_type', depth + 1, source_file)
                return
            if tag == 'DW_TAG_structure_type':
                for member in die.iter_children():
                    loc = member.attributes.get('DW_AT_data_member_location')
                    if member.tag != 'DW_TAG_member' or not loc or not isinstance(loc.value, int):
                        continue
                    if any(k in member.attributes for k in ('DW_AT_bit_size', 'DW_AT_data_bit_offset')):
                        continue
                    if name(member) and 'DW_AT_type' in member.attributes:
                        expand(member.get_DIE_from_attribute('DW_AT_type'), path + '.' + name(member),
                               address + loc.value, readonly, depth + 1, source_file)
                return
            if tag == 'DW_TAG_array_type' and 'DW_AT_type' in die.attributes:
                ranges = [r for r in die.iter_children() if r.tag == 'DW_TAG_subrange_type']
                if len(ranges) != 1:  # Only fixed one-dimensional arrays.
                    return
                attrs = ranges[0].attributes
                lower = attrs.get('DW_AT_lower_bound')
                if lower and lower.value != 0:
                    return
                count = attrs.get('DW_AT_count')
                upper = attrs.get('DW_AT_upper_bound')
                length = count.value if count else (upper.value + 1 if upper and isinstance(upper.value, int) else 0)
                element = die.get_DIE_from_attribute('DW_AT_type')
                stride = byte_size(element)
                if stride and isinstance(length, int) and 0 < length <= 256:
                    for i in range(length):
                        expand(element, f'{path}[{i}]', address + i * stride, readonly, depth + 1, source_file)
                return
            # Pointers, unions and location lists are deliberately unsupported.
            if tag != 'DW_TAG_base_type' or readonly:
                return
            size = die.attributes.get('DW_AT_byte_size')
            encoding = die.attributes.get('DW_AT_encoding')
            if not size or not encoding:
                return
            kind = {(4, 4): 'float32', (5, 4): 'int32', (7, 4): 'uint32', (2, 1): 'bool'}.get((encoding.value, size.value))
            if not kind:
                return
            storage = next((s for s in sections if s['sh_flags'] & 3 == 3
                            and s['sh_addr'] <= address and address + size.value <= s['sh_addr'] + s['sh_size']), None)
            key = (path, address)
            if storage is not None and key not in seen:
                seen.add(key)
                item = dict(path=path, address=address, type=kind, size=size.value, writable=True)
                if source_file:
                    item['sourceFile'] = source_file
                    item['kind'] = 'file-static'
                else:
                    item['kind'] = 'global'
                result.append(item)

        for cu in dwarf.iter_CUs():
            top = cu.get_top_DIE()
            cu_name_attr = top.attributes.get('DW_AT_name')
            cu_dir_attr = top.attributes.get('DW_AT_comp_dir')
            cu_name = str(cu_name_attr.value) if cu_name_attr else None
            cu_dir = str(cu_dir_attr.value) if cu_dir_attr else ''
            # Canonical CU identity: comp_dir + name (full path, not basename).
            if cu_name and not os.path.isabs(cu_name) and cu_dir:
                cu_file = os.path.normpath(os.path.join(cu_dir, cu_name))
            else:
                cu_file = cu_name
            if cu_file:
                cu_file = cu_file.replace('\\', '/')
            for die in cu.iter_DIEs():
                if die.tag != 'DW_TAG_variable':
                    continue
                loc = die.attributes.get('DW_AT_location')
                typed = die
                for ref in ('DW_AT_specification', 'DW_AT_abstract_origin'):
                    if ref in die.attributes:
                        typed = die.get_DIE_from_attribute(ref)
                variable_name = name(die) or name(typed)
                if not loc or not isinstance(loc.value, (list, bytes)) or not variable_name or 'DW_AT_type' not in typed.attributes:
                    continue
                ops = parser.parse_expr(loc.value)
                if len(ops) == 1 and ops[0].op_name == 'DW_OP_addr':
                    # File-static (no DW_AT_external) keeps compile-unit scope for identity.
                    external = 'DW_AT_external' in die.attributes or 'DW_AT_external' in typed.attributes
                    src = None if external else cu_file
                    expand(typed.get_DIE_from_attribute('DW_AT_type'), variable_name, ops[0].args[0], False, 0, src)
        # Use load addresses: also check initial .data bytes stored in Flash.
        # Debug information and NOBITS (.bss) have no physical bytes to compare.
        immutable = [(segment['p_paddr'], segment.data()) for segment in elf.iter_segments()
                     if segment['p_type'] == 'PT_LOAD' and segment['p_filesz']]
        return result, immutable, digest


def select_parameters(symbols, watches):
    if not isinstance(watches, list) or not 1 <= len(watches) <= 64:
        raise ValueError('configure 1..64 SWD watch parameters')
    selected = []
    paths = set()
    for index, watch in enumerate(watches):
        if not isinstance(watch, dict) or not isinstance(watch.get('path'), str):
            raise ValueError('each watch requires a symbol path')
        path = watch['path']
        candidates = [s for s in symbols if s['path'] == path]
        if len(candidates) != 1:
            raise ValueError(f'{path}: symbol missing, unsupported, or ambiguous ({len(candidates)} matches)')
        if path in paths:
            raise ValueError('duplicate watch path: ' + path)
        paths.add(path)
        param = dict(candidates[0], id=index + 1)
        for key in ('min', 'max'):
            if key in watch:
                value = watch[key]
                if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                    raise ValueError('bounds must be finite numbers')
                param[key] = value
        if param.get('min', -math.inf) > param.get('max', math.inf):
            raise ValueError('min exceeds max')
        selected.append(param)
    return selected


def verify_firmware(target, sections):
    verified = 0
    for address, data in sections:
        region = target.memory_map.get_region_for_address(address)
        if not region or not region.is_flash:
            continue
        if address + len(data) - 1 > region.end or verified + len(data) > 16 * 1024 * 1024:
            raise ValueError('ELF flash section outside verification limits')
        for offset in range(0, len(data), 1024):
            block = data[offset:offset + 1024]
            if bytes(target.read_memory_block8(address + offset, len(block))) != block:
                raise ValueError('ELF does not match target flash; select the ELF used to flash this board')
        verified += len(data)
    if not verified:
        raise ValueError('no immutable flash section available to verify ELF against target')
    return verified


class Backend:
    def __init__(self):
        self.session = None
        self.params = {}

    def close(self):
        self.params = {}
        session, self.session = self.session, None
        if session:
            session.close()

    def dispatch(self, method, args):
        if method in ('probes', 'targets'):
            # Discovery uses pyOCD's structured listing; it never creates a Session.
            result = subprocess.run([sys.executable, '-m', 'pyocd', 'json', '--' + method],
                                    capture_output=True, text=True, check=True, timeout=25,
                                    creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            data = json.loads(result.stdout)
            if method == 'probes' and 'probes' not in data and isinstance(data.get('boards'), list):
                data['probes'] = [dict(p, description=p.get('info', p.get('unique_id', ''))) for p in data['boards']]
            if data.get('status', 0) != 0 or not isinstance(data.get(method), list):
                raise ValueError(data.get('error') or f"pyOCD {method} discovery failed: status={data.get('status')}, fields={list(data.keys())}, stderr={result.stderr[-1500:]}")
            return data
        if method == 'disconnect':
            self.close()
            return None
        if method == 'inspect':
            symbols, _, digest = load_elf(args['elf'])
            return dict(symbols=symbols, sha256=digest)
        if method == 'connect':
            if self.session:
                raise ValueError('already connected')
            from pyocd.core.helpers import ConnectHelper
            from pyocd.core.session import Session
            from pyocd.core.target import Target
            symbols, sections, digest = load_elf(args['elf'])
            params = select_parameters(symbols, args['watch'])
            if not args.get('target'):
                raise ValueError('SWD target ID is required (see pyocd list --targets)')
            frequency = args.get('frequency', 1000000)
            if isinstance(frequency, bool) or not isinstance(frequency, int) or not 10000 <= frequency <= 10000000:
                raise ValueError('SWD frequency must be 10000..10000000 Hz')
            probes = ConnectHelper.get_all_connected_probes(blocking=False)
            uid = args.get('probeId', '')
            probes = [p for p in probes if not uid or p.unique_id == uid]
            if len(probes) != 1:
                raise ValueError('connect exactly one probe or configure its full probeId')
            options = dict(target_override=args['target'], frequency=frequency, connect_mode='attach',
                           auto_unlock=False, resume_on_disconnect=False, no_config=True,
                           user_script=os.devnull, **{'cache.enable_memory': False, 'cache.enable_register': False})
            self.session = Session(probes[0], options=options)
            try:
                self.session.open()
                target = self.session.target
                if target.get_state() != Target.State.RUNNING:
                    raise ValueError('target is not running; start firmware before attaching')
                for param in params:
                    checked_parameter(target, param)
                verified = verify_firmware(target, sections)
                self.params = {p['id']: p for p in params}
                return dict(parameters=params, symbols=symbols, sha256=digest, verifiedBytes=verified, probeId=probes[0].unique_id)
            except Exception:
                self.close()
                raise
        if not self.session:
            raise ValueError('SWD is disconnected')
        target = self.session.target
        from pyocd.core.target import Target
        if target.get_state() != Target.State.RUNNING:
            raise ValueError('target stopped running; no access performed')
        if method == 'read':
            return [dict(id=p['id'], value=read_parameter(target, p)) for p in self.params.values()]
        if method == 'write':
            param = self.params.get(args.get('id'))
            if param is None:
                raise ValueError('unknown parameter ID')
            return write_parameter(target, param, args.get('value'))
        raise ValueError('unknown method')


def main():
    backend = Backend()
    output = sys.stdout
    try:
        for line in sys.stdin:
            request_id = None
            try:
                request = json.loads(line)
                request_id = request['id']
                with contextlib.redirect_stdout(sys.stderr):
                    result = backend.dispatch(request['method'], request.get('args', {}))
                response = dict(id=request_id, result=result)
            except Exception as exc:
                detail = str(exc)
                if isinstance(exc, ImportError) or 'USB backend' in detail:
                    detail += '; use a compatible Python (recommended 3.11) and install: python -m pip install -r scripts/requirements-swd.txt; set serialLab.swd.pythonPath to that interpreter'
                response = dict(id=request_id, error=detail)
            output.write(json.dumps(response, allow_nan=False) + '\n')
            output.flush()
    finally:
        with contextlib.redirect_stdout(sys.stderr):
            backend.close()


if __name__ == '__main__':
    main()
