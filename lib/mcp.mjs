import { randomBytes } from 'node:crypto';

export const MCP_SERVICES = Object.freeze({
  descript: { name: 'Descript', url: 'https://api.descript.com/v2/mcp', description: 'Transcript-based video editing and caption workflows.' },
  vidiq: { name: 'vidIQ', url: 'https://mcp.vidiq.com/mcp', description: 'Video research, transcripts and the editing/publishing tools enabled for your plan.' }
});
export class AppMcp {
  constructor(vault, origin, options = {}) { this.vault = vault; this.origin = origin; this.options=options; this.sessions = new Map(); this.clients = new Map(); this.pending=new Map();this.retryTimers=new Map();this.disabled=new Set();this.failures=new Map(); }
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
      // A refresh token belongs to its registered client, even when the app's
      // loopback port changed. Re-register only for a new authorization flow.
      clientInformation: () => data.tokens || data.redirect === redirect ? data.client : undefined,
      saveClientInformation: async value => { const same=data.client?.client_id===value.client_id;data.client=value;if(!same || !data.redirect || value.redirect_uris?.includes(redirect))data.redirect=redirect;await vault.save(); },
      tokens: () => data.tokens,
      saveTokens: async value => { data.tokens = { ...value, ...(value.refresh_token ? {} : data.tokens?.refresh_token ? {refresh_token:data.tokens.refresh_token} : {}) }; await vault.save(); },
      discoveryState: () => data.discovery,
      saveDiscoveryState: async value => { data.discovery=value;await vault.save(); },
      redirectToAuthorization: url => { session.authUrl = url.href; session.status = 'awaiting_sign_in'; },
      saveCodeVerifier: value => { session.verifier = value; },
      codeVerifier: () => { if (!session.verifier) throw new Error('Sign-in expired. Connect again.'); return session.verifier; },
      invalidateCredentials: async scope => {
        if (scope === 'all' || scope === 'client') delete data.client;
        if (scope === 'all' || scope === 'tokens') delete data.tokens;
        if (scope === 'all' || scope === 'verifier') delete session.verifier;
        if (scope === 'all' || scope === 'discovery') delete data.discovery;
        await vault.save();
      }
    };
  }
  async wire(id,session) {
    const provider=this.provider(id,session);
    if(this.options.createConnection)return await this.options.createConnection({id,session,provider});
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    return {client:new Client({name:'Clipmax Studio',version:'0.13.1'}),transport:new StreamableHTTPClientTransport(new URL(MCP_SERVICES[id].url),{authProvider:provider,fetch:async(url,init)=>{
      try{const response=await fetch(url,{...init,signal:init?.signal?AbortSignal.any([init.signal,AbortSignal.timeout(45000)]):AbortSignal.timeout(45000)});if(response.status===429||response.status>=500)session.transientError=true;return response;}
      catch(error){session.transientError=true;throw error;}
    }})};
  }
  async closeSession(session) { if(!session)return;session.closing=true;await session.client?.close().catch(()=>{});await session.transport?.close().catch(()=>{}); }
  retry(id) {
    if(this.disabled.has(id)||this.retryTimers.has(id)||!this.vault.state.mcp?.[id]?.tokens)return;
    const attempt=(this.failures.get(id)||0)+1;this.failures.set(id,attempt);
    const delays=[5000,15000,60000,300000],timer=setTimeout(()=>{this.retryTimers.delete(id);this.connect(id,{interactive:false}).catch(()=>{});},delays[Math.min(attempt-1,delays.length-1)]);
    timer.unref?.();this.retryTimers.set(id,timer);
  }
  async restore() { return await Promise.allSettled(Object.keys(MCP_SERVICES).filter(id=>this.vault.state.mcp?.[id]?.tokens).map(id=>this.connect(id,{interactive:false}))); }
  async connect(id, {interactive=true} = {}) {
    const service = MCP_SERVICES[id]; if (!service) throw new Error('Choose a supported MCP service.');
    if(interactive){this.disabled.delete(id);const active=this.sessions.get(id);if(active)active.interactive=true;}
    else if(this.disabled.has(id))return {status:'disconnected'};
    if (this.clients.has(id)) return { status: 'connected' };
    if(this.pending.has(id))return await this.pending.get(id);
    clearTimeout(this.retryTimers.get(id));this.retryTimers.delete(id);
    const attempt=this.connectOnce(id,interactive);this.pending.set(id,attempt);
    try{return await attempt;}finally{if(this.pending.get(id)===attempt)this.pending.delete(id);}
  }
  async connectOnce(id,interactive) {
    const service=MCP_SERVICES[id];await this.closeSession(this.sessions.get(id));
    const session = { state: randomBytes(24).toString('hex'), createdAt: Date.now(), status: interactive?'connecting':'reconnecting',interactive };
    this.sessions.set(id, session);
    try {
      Object.assign(session,await this.wire(id,session));
      session.client.onclose=()=>{if(session.closing||this.sessions.get(id)!==session||this.disabled.has(id))return;this.clients.delete(id);session.status='reconnecting';this.retry(id);};
      await session.client.connect(session.transport, { timeout: 45000 });
      if(this.disabled.has(id)||this.sessions.get(id)!==session){await this.closeSession(session);return {status:'disconnected'};}
      this.clients.set(id, session.client); session.status = 'connected';this.failures.delete(id); return { status: 'connected' };
    } catch (error) {
      if(this.disabled.has(id))return {status:'disconnected'};
      if(session.authUrl&&!session.transientError){
        session.status=session.interactive?'awaiting_sign_in':'requires_sign_in';
        if(session.interactive)return {status:'awaiting_sign_in',authUrl:session.authUrl};
        await this.closeSession(session);delete session.authUrl;return {status:'requires_sign_in'};
      }
      session.status='offline';session.error=`${service.name} could not reconnect. Saved authorization is kept; Clipmax will retry.`;
      await this.closeSession(session);this.retry(id);throw new Error(session.error);
    }
  }
  async callback(id, params) {
    const session = this.sessions.get(id);
    if (!session || session.status !== 'awaiting_sign_in' || params.get('state') !== session.state || Date.now() - session.createdAt > 600000) throw new Error('MCP sign-in state is invalid or expired.');
    session.status = 'connecting';
    try {
      if (!params.get('code') || params.get('error')) throw new Error('Service sign-in was cancelled.');
      await session.transport.finishAuth(params.get('code'));
      if(this.disabled.has(id)||this.sessions.get(id)!==session)throw new Error('This connection was removed.');
      await this.closeSession(session);session.closing=false;
      if(this.disabled.has(id)||this.sessions.get(id)!==session)throw new Error('This connection was removed.');
      Object.assign(session,await this.wire(id,session));
      session.client.onclose=()=>{if(session.closing||this.sessions.get(id)!==session||this.disabled.has(id))return;this.clients.delete(id);session.status='reconnecting';this.retry(id);};
      await session.client.connect(session.transport, { timeout: 45000 });
      if(this.disabled.has(id)||this.sessions.get(id)!==session){await this.closeSession(session);throw new Error('This connection was removed.');}
      this.clients.set(id, session.client); session.status = 'connected';
    } catch (error) { session.status = 'failed'; session.error = error.message; throw error; }
    finally { delete session.verifier; delete session.authUrl; }
  }
  status(id) { const session = this.sessions.get(id); return { status: session?.status || 'disconnected', error: session?.error }; }
  async tools(id) {
    let client = this.clients.get(id);
    if(!client&&this.vault.state.mcp?.[id]?.tokens){const state=await this.connect(id,{interactive:false});if(state.status==='requires_sign_in')throw new Error('This service needs renewed sign-in. Reconnect it in Plugins.');client=this.clients.get(id);}
    if (!client) throw new Error('Connect this service in MCP tools first.');
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
    this.disabled.add(id);clearTimeout(this.retryTimers.get(id));this.retryTimers.delete(id);this.failures.delete(id);
    this.clients.delete(id);await this.closeSession(this.sessions.get(id));this.sessions.delete(id);
    if (this.vault.state.mcp) delete this.vault.state.mcp[id]; await this.vault.save();
  }
}
