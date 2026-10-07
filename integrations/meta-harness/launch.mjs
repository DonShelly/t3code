import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function launch({ python = process.env.META_HARNESS_PYTHON || 'python',
  home = process.env.META_HARNESS_HOME, port = 4317, spawnProcess = spawn } = {}) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid dashboard port');
  const args = ['-m', 'meta_harness'];
  if (home) args.push('--home', home);
  args.push('serve', '--port', String(port));
  const child = spawnProcess(python, args, { stdio: 'inherit', windowsHide: true, shell: false });
  child.on('error', (error) => { console.error(`Install the meta harness Python package first: ${error.message}`); process.exitCode = 1; });
  child.on('exit', (code) => { process.exitCode = code ?? 1; });
  return child;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) launch();
