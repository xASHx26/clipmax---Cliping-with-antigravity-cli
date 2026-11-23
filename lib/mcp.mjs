import { randomBytes } from 'node:crypto';

export const MCP_SERVICES = Object.freeze({
  descript: { name: 'Descript', url: 'https://api.descript.com/v2/mcp', description: 'Transcript-based video editing and caption workflows.' },
  vidiq: { name: 'vidIQ', url: 'https://mcp.vidiq.com/mcp', description: 'Video research, transcripts and the editing/publishing tools enabled for your plan.' }
});
export class AppMcp {
  constructor(vault, origin) { this.vault = vault; this.origin = origin; this.sessions = new Map(); this.clients = new Map(); }
  summary() {
    return Object.entries(MCP_SERVICES).map(([id, service]) => ({ id, name: service.name, description: service.description, connected: this.clients.has(id), saved: Boolean(this.vault.state.mcp?.[id]?.tokens), status: this.sessions.get(id)?.status || (this.clients.has(id) ? 'connected' : 'disconnected') }));
  }
  provider(id, session) {
    const vault = this.vault; vault.state.mcp ||= {}; vault.state.mcp[id] ||= {};
    const data = vault.state.mcp[id], redirect = `${this.origin}/oauth/mcp/${id}`;
    return {
      redirectUrl: redirect,
      clientMetadata: { client_name: 'Clipmax Studio', redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' },
      state: () => session.state,
      clientInformation: () => data.redirect === redirect ? data.client : undefined,
      saveClientInformation: async value => { data.client = value; data.redirect = redirect; await vault.save(); },
      tokens: () => data.tokens,
      saveTokens: async value => { data.tokens = value; await vault.save(); },
      redirectToAuthorization: url => { session.authUrl = url.href; session.status = 'awaiting_sign_in'; },
      saveCodeVerifier: value => { session.verifier = value; },
      codeVerifier: () => { if (!session.verifier) throw new Error('Sign-in expired. Connect again.'); return session.verifier; },
      invalidateCredentials: async scope => {
        if (scope === 'all' || scope === 'client') delete data.client;
        if (scope === 'all' || scope === 'tokens') delete data.tokens;
        if (scope === 'all' || scope === 'verifier') delete session.verifier;
        await vault.save();
      }
    };
  }
  async connect(id) {
    const service = MCP_SERVICES[id]; if (!service) throw new Error('Choose a supported MCP service.');
    if (this.clients.has(id)) return { status: 'connected' };
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const session = { state: randomBytes(24).toString('hex'), createdAt: Date.now(), status: 'connecting' };
    this.sessions.set(id, session);
    session.transport = new StreamableHTTPClientTransport(new URL(service.url), { authProvider: this.provider(id, session), fetch: (url, init) => fetch(url, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000) }) });
    session.client = new Client({ name: 'Clipmax Studio', version: '0.8.0' });
    try {
      await session.client.connect(session.transport, { timeout: 45000 });
      this.clients.set(id, session.client); session.status = 'connected'; return { status: 'connected' };
    } catch (error) {
      if (session.authUrl) return { status: 'awaiting_sign_in', authUrl: session.authUrl };
      session.status = 'failed'; session.error = error.message; throw new Error(`Could not connect to ${service.name}: ${error.message}`);
    }
  }
  async callback(id, params) {
    const session = this.sessions.get(id);
    if (!session || session.status !== 'awaiting_sign_in' || params.get('state') !== session.state || Date.now() - session.createdAt > 600000) throw new Error('MCP sign-in state is invalid or expired.');
    session.status = 'connecting';
    try {
      if (!params.get('code') || params.get('error')) throw new Error('Service sign-in was cancelled.');
      await session.transport.finishAuth(params.get('code'));
      const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
      const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
      session.client = new Client({ name: 'Clipmax Studio', version: '0.8.0' });
      session.transport = new StreamableHTTPClientTransport(new URL(MCP_SERVICES[id].url), { authProvider: this.provider(id, session) });
      await session.client.connect(session.transport, { timeout: 45000 });
      this.clients.set(id, session.client); session.status = 'connected';
    } catch (error) { session.status = 'failed'; session.error = error.message; throw error; }
    finally { delete session.verifier; delete session.authUrl; }
  }
  status(id) { const session = this.sessions.get(id); return { status: session?.status || 'disconnected', error: session?.error }; }
  async tools(id) {
    const client = this.clients.get(id); if (!client) throw new Error('Connect this service in MCP tools first.');
    let cursor, all = [];
    do { const result = await client.listTools(cursor ? { cursor } : {}); all.push(...result.tools); cursor = result.nextCursor; } while (cursor && all.length < 500);
    return all;
  }
  async call(id, input) {
    if (input.confirmed !== true) throw new Error('Review the tool input and confirm before running it.');
    const tools = await this.tools(id);
    if (!tools.some(t => t.name === input.name)) throw new Error('The selected service does not expose this tool.');
    if (!input.arguments || typeof input.arguments !== 'object' || Array.isArray(input.arguments)) throw new Error('Tool arguments must be a JSON object.');
    return this.clients.get(id).callTool({ name: input.name, arguments: input.arguments }, undefined, { timeout: 240000 });
  }
  async disconnect(id) {
    await this.clients.get(id)?.close(); this.clients.delete(id);
    const session = this.sessions.get(id); if (session) { await session.transport?.close().catch(() => {}); this.sessions.delete(id); }
    if (this.vault.state.mcp) delete this.vault.state.mcp[id]; await this.vault.save();
  }
}
