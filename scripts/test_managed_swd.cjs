// Real download/install smoke test; no probe connection.
const Module = require('module');
const path = require('path');
const original = Module._load;
let prompts = 0;
const vscode = {
  workspace: { isTrusted: true, getConfiguration: () => ({ get: (_key, fallback) => fallback }) },
  window: {
    showInformationMessage: async () => { prompts++; return '安装'; },
    createOutputChannel: () => ({ append: s => process.stdout.write(s), appendLine: s => console.log(s), show() {}, dispose() {} }),
    withProgress: async (_options, task) => task({ report: p => console.log(p.message) }),
  }, ProgressLocation: { Notification: 15 },
};
Module._load = function(id, ...args) { return id === 'vscode' ? vscode : original.call(this, id, ...args); };
const { resolvePython } = require('../out/swd/runtime');
const context = { globalStorageUri: { fsPath: path.resolve('.tmp_managed_swd') }, subscriptions: [] };
(async () => {
  const [a,b] = await Promise.all([resolvePython(context), resolvePython(context)]);
  if (a !== b) throw Error('Concurrent installs differed');
  const before = prompts;
  if (await resolvePython(context) !== a || prompts !== before) throw Error('Environment reuse failed');
  console.log('PASS: managed installation, imports, coalescing and reuse', a);
})().catch(e => { console.error(e); process.exitCode = 1; });
