import { spawn } from 'node:child_process';
import { vaultKey } from './vault.mjs';

process.env.CLIPMAX_VAULT_KEY = await vaultKey();
const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error('A command is required.');
// Keep terminal input available for interactive Antigravity sign-in.
const child = spawn(command, args, { stdio: 'inherit', env: process.env });
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => child.kill(signal));
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 143); });
