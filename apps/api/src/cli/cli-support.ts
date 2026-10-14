import { Writable } from 'node:stream';
import { createInterface } from 'node:readline';

/** Reads `--name value` style arguments. */
export function parseArgs(argv: readonly string[]): Map<string, string | true> {
  const args = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (!arg.startsWith('--')) continue;
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      args.set(arg.slice(2), next);
      index += 1;
    } else {
      args.set(arg.slice(2), true);
    }
  }
  return args;
}

/** Asks for a value without echoing it to the terminal. */
export async function promptHidden(question: string): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stdout.write(chunk);
      callback();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  process.stdout.write(question);
  muted = true;
  const answer = await new Promise<string>((resolve) => rl.question('', resolve));
  muted = false;
  rl.close();
  process.stdout.write('\n');
  return answer;
}

export function adminUrl(): string {
  const url = process.env.ADMIN_DATABASE_URL;
  if (url === undefined || url.trim() === '') {
    throw new Error('Set ADMIN_DATABASE_URL to an administrator connection string.');
  }
  return url;
}

export function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
