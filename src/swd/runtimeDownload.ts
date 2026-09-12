import { createHash } from 'crypto';
import * as https from 'https';
import { HttpsProxyAgent } from 'https-proxy-agent';

export function runtimeAsset(os: string, arch: string) {
  const assets: Record<string, [string, string]> = {
    'win32-x64': ['x86_64-pc-windows-msvc.zip','5049375aa2a5162f132b2c1cb992e25d42d47d934cab8c174dbe6f60973dcc12'],
    'darwin-x64': ['x86_64-apple-darwin.tar.gz','76638fdcfa91357858771551a1c88de1f7c3b270b33ab1866f8a0618d9e442d8'],
    'darwin-arm64': ['aarch64-apple-darwin.tar.gz','3f61099e261e449527141dbf125629fab33ad696468c8c90cebbac40185a306c'],
    'linux-x64': ['x86_64-unknown-linux-gnu.tar.gz','741ff1f5742c5a4a25d2f829e8395355e43f7a5ae2ebc6368e9ae2df0efb69cf'],
    'linux-arm64': ['aarch64-unknown-linux-gnu.tar.gz','726b72a137fda33565143325f7d31c42cd30ff9ccdf067e00d124d37b4081cb2'],
  };
  const asset = assets[`${os}-${arch}`];
  if (!asset) throw new Error('Unsupported platform; configure a custom Python using serialLab.swd.pythonPath.');
  return { name: `uv-${asset[0]}`, url: `https://github.com/astral-sh/uv/releases/download/0.8.22/uv-${asset[0]}`, sha256: asset[1] };
}
export function verifyDownload(data: Buffer, expected: string): void {
  if (createHash('sha256').update(data).digest('hex') !== expected) throw new Error('uv download checksum mismatch');
}
export async function download(url: string, proxy?: string, redirects = 0): Promise<Buffer> {
  if (redirects > 5 || new URL(url).protocol !== 'https:') throw new Error('Invalid download redirect');
  return new Promise((resolve, reject) => {
    const req = https.get(url, { agent: proxy ? new HttpsProxyAgent(proxy) : undefined }, res => {
      if (res.statusCode && [301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        res.resume(); resolve(download(new URL(res.headers.location, url).href, proxy, redirects + 1)); return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`Download HTTP ${res.statusCode}`)); return; }
      const chunks: Buffer[] = []; let size = 0;
      res.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 100 * 1024 * 1024) req.destroy(new Error('Download too large')); else chunks.push(chunk); });
      res.on('end', () => resolve(Buffer.concat(chunks))); res.on('error', reject);
    });
    const deadline = setTimeout(() => req.destroy(new Error('Download timed out')), 180000);
    req.on('close', () => clearTimeout(deadline)); req.on('error', reject);
  });
}
