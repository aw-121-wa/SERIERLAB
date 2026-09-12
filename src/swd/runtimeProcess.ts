import { spawn } from 'child_process';

export function run(executable: string, args: string[], log: (text: string) => void,
  env: NodeJS.ProcessEnv = process.env, timeout = 600000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { env, windowsHide: true, shell: false });
    let stdout = ''; let stderr = ''; let expired = false;
    const timer = setTimeout(() => { expired = true; child.kill(); }, timeout);
    child.stdout.on('data', data => { stdout = (stdout + data).slice(-65536); log(String(data)); });
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-65536); log(String(data)); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); if (code === 0 && !expired) resolve(stdout); else reject(new Error(expired ? 'SWD environment operation timed out' : `SWD environment command failed (${code}): ${stderr.slice(-2000)}`)); });
  });
}
