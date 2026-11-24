import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { AppMcp } from '../lib/mcp.mjs';
const { availablePort } = createRequire(import.meta.url)('../desktop/port.cjs');

function fixture(createConnection) {
  const vault = { state: { mcp: { descript: { redirect: 'http://127.0.0.1:12345/oauth/mcp/descript', client: { client_id: 'registered-client' }, tokens: { access_token: 'test-access', refresh_token: 'test-refresh' } } } }, async save() {} };
  const manager = new AppMcp(vault, 'http://127.0.0.1:23456', { createConnection: createConnection || (async () => ({ client: { async connect() {}, async close() { this.onclose?.(); }, async listTools() { return { tools: [{ name: 'read_project' }] }; } }, transport: { async close() {} } })) });
  return { manager, vault };
}

test('restart restores saved plugin authorization without an interactive sign-in', async () => {
  const { manager, vault } = fixture();
  const results = await manager.restore();
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(manager.summary()[0].connected, true);
  const restarted = new AppMcp(vault, 'http://127.0.0.1:34567', manager.options);
  await restarted.restore();
  assert.equal(restarted.summary()[0].connected, true);
  assert.deepEqual(await restarted.tools('descript'), [{ name: 'read_project' }]);
  await manager.disconnect('descript');
  await restarted.disconnect('descript');
});

test('changed port retains the registered refresh client and a refresh response retains its refresh token', async () => {
  const { manager, vault } = fixture();
  const provider = manager.provider('descript', {});
  assert.equal(provider.clientInformation().client_id, 'registered-client');
  await provider.saveTokens({ access_token: 'refreshed-access', expires_in: 3600 });
  assert.equal(provider.tokens().refresh_token, 'test-refresh');
  await provider.saveClientInformation({ client_id: 'registered-client' });
  assert.equal(vault.state.mcp.descript.redirect, 'http://127.0.0.1:12345/oauth/mcp/descript');
  await provider.saveDiscoveryState({ authorizationServerUrl: 'https://example.com' });
  assert.deepEqual(manager.provider('descript', {}).discoveryState(), { authorizationServerUrl: 'https://example.com' });
  await provider.invalidateCredentials('tokens');
  assert.equal(provider.clientInformation(), undefined);
});

test('startup and manual connect share an in-flight transport', async () => {
  let calls = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const { manager } = fixture(async () => {
    calls++;
    return { client: { async connect() { await gate; }, async close() {} }, transport: { async close() {} } };
  });
  const startup = manager.restore();
  const manual = manager.connect('descript');
  release();
  await Promise.all([startup, manual]);
  assert.equal(calls, 1);
  assert.equal(manager.summary()[0].connected, true);
  await manager.disconnect('descript');
});

test('network failures keep authorization and retry; explicit disconnect clears retry and saved auth', async () => {
  const { manager, vault } = fixture(async () => ({ client: { async connect() { throw new Error('network offline'); }, async close() {} }, transport: { async close() {} } }));
  await manager.restore();
  assert.equal(manager.summary()[0].status, 'offline');
  assert.equal(vault.state.mcp.descript.tokens.refresh_token, 'test-refresh');
  assert.equal(manager.retryTimers.has('descript'), true);
  await manager.disconnect('descript');
  assert.equal(manager.retryTimers.size, 0);
  assert.equal(vault.state.mcp.descript, undefined);
  await manager.restore();
  assert.equal(manager.summary()[0].connected, false);
});

test('revoked authorization requests sign-in without returning a browser URL during startup', async () => {
  const { manager } = fixture(async ({ provider }) => ({ client: { async connect() { await provider.invalidateCredentials('tokens'); provider.redirectToAuthorization(new URL('https://example.com/authorize')); throw new Error('unauthorized'); }, async close() {} }, transport: { async close() {} } }));
  const results = await manager.restore();
  assert.deepEqual(results[0].value, { status: 'requires_sign_in' });
  assert.equal(manager.status('descript').status, 'requires_sign_in');
  assert.equal(manager.retryTimers.size, 0);
});

test('disconnect during restoration never resurrects the connected client', async () => {
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const connecting = new Promise(resolve => { started = resolve; });
  const { manager, vault } = fixture(async () => ({ client: { async connect() { started(); await gate; }, async close() {} }, transport: { async close() {} } }));
  const startup = manager.restore();
  await connecting;
  await manager.disconnect('descript');
  release();
  await startup;
  assert.equal(manager.clients.size, 0);
  assert.equal(vault.state.mcp.descript, undefined);
});

test('unexpected transport closure reconnects instead of forgetting the saved sign-in', async () => {
  const { manager, vault } = fixture();
  await manager.restore();
  manager.clients.get('descript').onclose();
  assert.equal(manager.summary()[0].status, 'reconnecting');
  assert.equal(manager.retryTimers.has('descript'), true);
  assert.ok(vault.state.mcp.descript.tokens);
  await manager.connect('descript', { interactive: false });
  assert.equal(manager.summary()[0].connected, true);
  assert.equal(manager.retryTimers.size, 0);
  await manager.disconnect('descript');
});

test('desktop reuses a free callback port and falls back when it is occupied', async () => {
  const first = await availablePort();
  assert.equal(await availablePort(first), first);
  const occupied = createServer();
  await new Promise(resolve => occupied.listen(first, '127.0.0.1', resolve));
  try { assert.notEqual(await availablePort(first), first); }
  finally { await new Promise(resolve => occupied.close(resolve)); }
});
