import { spawn } from 'node:child_process';

export async function gitOutput(cwd: string, args: string[]) {
  return new Promise<string>((resolveOutput) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks: Buffer[] = [];
    child.stdout?.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
    child.on('error', () => resolveOutput(''));
    child.on('close', (code) => resolveOutput(code === 0 ? Buffer.concat(chunks).toString('utf8').trim() : ''));
  });
}

export async function gitStrict(cwd: string, args: string[]) {
  return new Promise<string>((resolveOutput, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on('data', (chunk) => stdout.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
    child.stderr?.on('data', (chunk) => stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
    child.on('error', reject);
    child.on('close', (code) => {
      const out = Buffer.concat(stdout).toString('utf8').trim();
      const err = Buffer.concat(stderr).toString('utf8').trim();
      if (code === 0) resolveOutput(out);
      else reject(new Error(`git ${args.join(' ')} failed in ${cwd}: ${err || out}`));
    });
  });
}
