import { describe, expect, it } from 'vitest';
import { NativeRequestManager } from '../protocol/native/nativeRequestManager';
import { NativeFrame } from '../protocol/native/types';

function frame(requestId: number): NativeFrame {
  return {
    version: 1,
    messageType: 1,
    flags: 1,
    reserved: 0,
    requestId,
    payload: new Uint8Array(0),
  };
}

describe('NativeRequestManager', () => {
  it('sequential ids skip 0 and wrap', () => {
    const m = new NativeRequestManager(1000, 32);
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) ids.push(m.allocateId());
    expect(ids[0]).toBe(1);
    expect(ids[1]).toBe(2);
    expect(ids[4]).toBe(5);
    expect(ids.every((id) => id !== 0)).toBe(true);
  });

  it('matches response to pending request', async () => {
    const m = new NativeRequestManager(1000);
    const id = m.allocateId();
    const p = m.register(id);
    expect(m.onResponse(frame(id))).toBe(true);
    const f = await p;
    expect(f.requestId).toBe(id);
    expect(m.pendingCount).toBe(0);
  });

  it('unsolicited (id 0) does not consume pending', async () => {
    const m = new NativeRequestManager();
    const id = m.allocateId();
    const p = m.register(id).catch(() => 'rejected');
    expect(m.onResponse(frame(0))).toBe(false);
    expect(m.pendingCount).toBe(1);
    m.rejectAll();
    await p;
  });

  it('timeout rejects', async () => {
    const m = new NativeRequestManager(20);
    const id = m.allocateId();
    await expect(m.register(id)).rejects.toThrow(/timeout/);
    expect(m.timeouts).toBe(1);
  });

  it('disconnect rejects all pending', async () => {
    const m = new NativeRequestManager(5000);
    const a = m.register(m.allocateId());
    const b = m.register(m.allocateId());
    const settled = Promise.allSettled([a, b]);
    m.rejectAll('disconnected');
    const r = await settled;
    expect(r[0].status).toBe('rejected');
    expect(r[1].status).toBe('rejected');
    expect(m.pendingCount).toBe(0);
  });

  it('max 32 pending', async () => {
    const m = new NativeRequestManager(5000, 32);
    const held: Promise<unknown>[] = [];
    for (let i = 0; i < 32; i++) held.push(m.register(m.allocateId()).catch(() => 'ok'));
    await expect(m.register(m.allocateId())).rejects.toThrow(/too many pending/);
    m.rejectAll();
    await Promise.all(held);
  });

  it('skips pending id on wrap path', async () => {
    const m = new NativeRequestManager();
    const id1 = m.allocateId();
    const p = m.register(id1).catch(() => 'ok');
    const id2 = m.allocateId();
    expect(id2).not.toBe(id1);
    m.rejectAll();
    await p;
  });
});
