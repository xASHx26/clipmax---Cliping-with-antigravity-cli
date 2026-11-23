import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, link, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export async function vaultKey(env = process.env) {
  let key = env.CLIPMAX_VAULT_KEY;
  if (!key) {
    const file = env.CLIPMAX_VAULT_KEY_FILE || join(env.CLIPMAX_SETTINGS_DIR || '/var/lib/clipmax/settings', 'vault.key');
    if (!env.CLIPMAX_VAULT_KEY_FILE) {
      await mkdir(join(file, '..'), { recursive: true, mode: 0o700 });
      const temporary = `${file}.${randomBytes(12).toString('hex')}.tmp`;
      await writeFile(temporary, randomBytes(32).toString('base64'), { flag: 'wx', mode: 0o600 });
      try { await link(temporary, file); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      finally { await unlink(temporary); }
    }
    key = (await readFile(file, 'utf8')).trim();
  }
  if (!/^[A-Za-z0-9+/]{43}=$/.test(key) || Buffer.from(key, 'base64').length !== 32) throw new Error('Vault key must be 32 random bytes encoded as base64.');
  return key;
}
