import { describe, it, expect } from 'vitest';
import { SwdClient } from '../swd/client';

const fixture = `const r=require('readline').createInterface({input:process.stdin}); r.on('line', l=>{const q=JSON.parse(l); if(q.method==='exit')process.exit(2); if(q.method==='hang')return; const s=JSON.stringify(q.method==='fail'?{id:q.id,error:'rejected'}:{id:q.id,result:q.args})+'\\n'; process.stdout.write(s.slice(0,4));setTimeout(()=>process.stdout.write(s.slice(4)),5);});`;
describe('SWD helper RPC', () => {
  it('frames partial responses and serializes requests', async () => {
    const c = new SwdClient(process.execPath, ['-e', fixture]);
    try {
      expect(await Promise.all([c.request('read', { n: 1 }), c.request('read', { n: 2 })])).toEqual([{ n: 1 }, { n: 2 }]);
      await expect(c.request('fail')).rejects.toThrow('rejected');
    } finally { c.dispose(); }
  });
  it('rejects pending operations on helper exit', async () => {
    const c = new SwdClient(process.execPath, ['-e', fixture]);
    await expect(c.request('exit')).rejects.toThrow(/exited/);
    c.dispose();
  });
  it('kills a timed-out session instead of retrying writes', async () => {
    const c = new SwdClient(process.execPath, ['-e', fixture], 100);
    await expect(c.request('hang')).rejects.toThrow(/timed out/);
    await expect(c.request('read')).rejects.toThrow(/closed/);
    c.dispose();
  });
});
