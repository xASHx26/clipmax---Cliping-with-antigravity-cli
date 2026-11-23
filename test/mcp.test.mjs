import test from 'node:test';
import assert from 'node:assert/strict';
import { AppMcp } from '../lib/mcp.mjs';
test('app MCP OAuth credentials stay in the vault and callbacks require matching state', async () => {
  const vault = { state: {}, save: async () => {} }, app = new AppMcp(vault, 'http://127.0.0.1:4310');
  const session = { state: 'state' }, provider = app.provider('vidiq', session);
  await provider.saveClientInformation({ client_id: 'client', client_secret: 'private' });
  await provider.saveTokens({ access_token: 'private-token', token_type: 'Bearer' });
  provider.saveCodeVerifier('pkce');
  assert.equal(provider.codeVerifier(), 'pkce');
  assert.equal(provider.clientInformation().client_id, 'client');
  assert.equal(provider.tokens().access_token, 'private-token');
  assert.ok(!JSON.stringify(app.summary()).includes('private'));
  assert.equal(provider.redirectUrl, 'http://127.0.0.1:4310/oauth/mcp/vidiq');
  await assert.rejects(app.callback('vidiq', new URLSearchParams({ state: 'other', code: 'code' })), /invalid or expired/);
});
test('MCP tool runner calls the connected service and requires explicit confirmation', async () => {
  const app = new AppMcp({ state: {}, save: async () => {} }, 'http://127.0.0.1:4310');
  let received;
  app.clients.set('descript', { listTools: async () => ({ tools: [{ name: 'edit', inputSchema: { type: 'object' } }] }), callTool: async input => { received = input; return { content: [{ type: 'text', text: 'Edited' }] }; } });
  await assert.rejects(app.call('descript', { name: 'edit', arguments: {}, confirmed: false }), /confirm/);
  await assert.rejects(app.call('descript', { name: 'unknown', arguments: {}, confirmed: true }), /does not expose/);
  await app.call('descript', { name: 'edit', arguments: { media: 'https://media.example/video.mp4' }, confirmed: true });
  assert.deepEqual(received, { name: 'edit', arguments: { media: 'https://media.example/video.mp4' } });
});
