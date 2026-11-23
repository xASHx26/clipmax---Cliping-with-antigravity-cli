import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vaultKey } from '../docker/vault.mjs';

test('container vault key survives restarts and concurrent first starts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clipmax-vault-'));
  try {
    const env = { CLIPMAX_SETTINGS_DIR: dir };
    const keys = await Promise.all([vaultKey(env), vaultKey(env)]);
    assert.equal(keys[0], keys[1]);
    assert.equal(await vaultKey(env), keys[0]);
    assert.equal(Buffer.from(keys[0], 'base64').length, 32);
    assert.equal(await readFile(join(dir, 'vault.key'), 'utf8'), keys[0]);
    await writeFile(join(dir, 'vault.key'), 'corrupt-key');
    await assert.rejects(vaultKey(env), /32 random bytes/);
    assert.equal(await readFile(join(dir, 'vault.key'), 'utf8'), 'corrupt-key');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('mounted keys are read without replacement and missing mounted secrets fail', async () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  assert.equal(await vaultKey({ CLIPMAX_VAULT_KEY: key }), key);
  const dir = await mkdtemp(join(tmpdir(), 'clipmax-secret-'));
  try {
    const file = join(dir, 'secret');
    await assert.rejects(vaultKey({ CLIPMAX_VAULT_KEY_FILE: file }), /ENOENT/);
    await writeFile(file, key + '\n');
    assert.equal(await vaultKey({ CLIPMAX_VAULT_KEY_FILE: file }), key);
    assert.equal(await readFile(file, 'utf8'), key + '\n');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
