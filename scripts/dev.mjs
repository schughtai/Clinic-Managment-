// Starts the API and the web app together for development. Press Ctrl+C to stop both.
import { spawn } from 'node:child_process';

const children = [
  { name: 'api', args: ['run', 'dev', '--workspace', 'apps/api'] },
  { name: 'web', args: ['run', 'dev', '--workspace', 'apps/web'] },
].map(({ name, args }) => {
  const child = spawn('npm', args, { stdio: ['ignore', 'pipe', 'pipe'], shell: true });
  const prefix = (stream, target) =>
    stream.on('data', (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) if (line.trim() !== '') target.write(`[${name}] ${line}\n`);
    });
  prefix(child.stdout, process.stdout);
  prefix(child.stderr, process.stderr);
  return child;
});

const stop = () => {
  for (const child of children) child.kill('SIGINT');
  setTimeout(() => process.exit(0), 4000);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children) child.on('exit', (code) => code !== 0 && code !== null && stop());
