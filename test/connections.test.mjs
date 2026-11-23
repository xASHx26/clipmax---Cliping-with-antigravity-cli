import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { Connections } from '../lib/connections.mjs';

function response(data, status = 200) { return { ok: status < 400, status, json: async () => data }; }
test('browser publishing connections record user confirmation without pretending to have API access', async () => {
  const vault = new Connections('.', null);
  await assert.rejects(vault.addBrowser({ platform: 'youtube', confirmed: false }), /confirm/);
  await vault.addBrowser({ platform: 'youtube', name: 'My browser channel', confirmed: true });
  const account = vault.summary().accounts[0];
  assert.equal(account.mode, 'browser');
  assert.equal(account.active, true);
  assert.equal(vault.config().YOUTUBE_ACCESS_TOKEN, undefined);
});
test('verified accounts persist encrypted; summaries never return tokens; account switching is explicit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clipmax-vault-test-')), key = randomBytes(32).toString('base64');
  const vault = new Connections(dir, key, async (_url, options) => response({ items: [{ id: options.headers.Authorization.endsWith('first-secret') ? 'channel1' : 'channel2', snippet: { title: 'Test channel' } }] }));
  try {
    await vault.add({ platform: 'youtube', accessToken: 'first-secret' });
    await vault.add({ platform: 'youtube', accessToken: 'second-secret' });
    assert.equal(vault.summary().accounts.length, 2);
    assert.equal(vault.config().YOUTUBE_ACCESS_TOKEN, 'second-secret');
    await vault.activate(vault.summary().accounts[0].id);
    assert.equal(vault.config().YOUTUBE_ACCESS_TOKEN, 'first-secret');
    assert.ok(!JSON.stringify(vault.summary()).includes('secret'));
    assert.ok(!(await readFile(join(dir, 'connections.enc'), 'utf8')).includes('first-secret'));
    const restored = new Connections(dir, key); await restored.load();
    assert.equal(restored.config().YOUTUBE_ACCESS_TOKEN, 'first-secret');
    await restored.remove(restored.summary().accounts[0].id);
    assert.equal(restored.config().YOUTUBE_ACCESS_TOKEN, 'second-secret');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('failed token verification does not create a connected account', async () => {
  const vault = new Connections('.', null, async () => response({ error: 'invalid_token' }, 401));
  await assert.rejects(vault.add({ platform: 'youtube', accessToken: 'bad-secret' }), /authorization failed/);
  assert.equal(vault.summary().accounts.length, 0);
});
test('OAuth validates state and platform, uses PKCE, and consumes callbacks once', async () => {
  const calls = [];
  const vault = new Connections('.', null, async (url, options) => {
    calls.push({ url, options });
    return url.includes('/token') ? response({ access_token: 'new-token', refresh_token: 'refresh', expires_in: 3600 }) : response({ items: [{ id: 'channel', snippet: { title: 'My Channel' } }] });
  });
  const begin = await vault.beginOAuth({ platform: 'youtube', clientId: 'desktop-client' }, 'http://127.0.0.1:4310');
  const url = new URL(begin.url);
  assert.equal(url.hostname, 'accounts.google.com');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:4310/oauth/callback/youtube');
  await assert.rejects(vault.callback('youtube', new URLSearchParams({ state: 'fake', code: 'code' })), /state is invalid/);
  await assert.rejects(vault.callback('tiktok', new URLSearchParams({ state: begin.attemptId, code: 'code' })), /state is invalid/);
  await vault.callback('youtube', new URLSearchParams({ state: begin.attemptId, code: 'code' }));
  const verifier = calls[0].options.body.get('code_verifier');
  assert.equal(createHash('sha256').update(verifier).digest('base64url'), url.searchParams.get('code_challenge'));
  assert.equal(vault.oauthStatus(begin.attemptId).status, 'connected');
  assert.equal(vault.config().YOUTUBE_ACCESS_TOKEN, 'new-token');
  await assert.rejects(vault.callback('youtube', new URLSearchParams({ state: begin.attemptId, code: 'code' })), /state is invalid/);
});
test('TikTok desktop PKCE is hex SHA256 and refresh replaces rotated refresh tokens', async () => {
  let captured;
  const vault = new Connections('.', null, async (url, options) => {
    if (url.endsWith('/token/')) { captured = options.body; return response({ access_token: 'token2', refresh_token: 'rotated', expires_in: 7200 }); }
    return response({ data: { creator_username: 'test', creator_nickname: 'Test Creator' }, error: { code: 'ok' } });
  });
  const begin = await vault.beginOAuth({ platform: 'tiktok', clientId: 'client', clientSecret: 'secret' }, 'http://127.0.0.1:4310');
  const url = new URL(begin.url);
  await vault.callback('tiktok', new URLSearchParams({ state: begin.attemptId, code: 'code' }));
  assert.equal(createHash('sha256').update(captured.get('code_verifier')).digest('hex'), url.searchParams.get('code_challenge'));
  vault.state.accounts[0].expiresAt = Date.now() - 1;
  await vault.readyConfig(['tiktok']);
  assert.equal(captured.get('grant_type'), 'refresh_token');
  assert.equal(vault.state.accounts[0].refreshToken, 'rotated');
});
