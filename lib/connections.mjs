import { randomBytes, randomUUID, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';

const platformKeys = {
  youtube: ['YOUTUBE_ACCESS_TOKEN'], tiktok: ['TIKTOK_ACCESS_TOKEN'],
  facebook: ['FACEBOOK_PAGE_ACCESS_TOKEN', 'FACEBOOK_PAGE_ID'],
  instagram: ['INSTAGRAM_ACCESS_TOKEN', 'INSTAGRAM_USER_ID', 'INSTAGRAM_LOGIN', 'PUBLIC_MEDIA_BASE_URL']
};
export class Connections {
  constructor(dir, key, fetcher = fetch) {
    this.dir = dir; this.key = key ? Buffer.from(key, 'base64') : null; this.fetch = fetcher;
    if (this.key && this.key.length !== 32) throw new Error('Invalid credential vault key.');
    this.state = { accounts: [], apps: {}, settings: {} }; this.pending = new Map(); this.writes = Promise.resolve();
  }
  async load() {
    if (!this.key) return; // Source-only mode keeps new connections in memory unless a key is provided.
    try {
      const payload = JSON.parse(await readFile(join(this.dir, 'connections.enc'), 'utf8'));
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(payload.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
      this.state = JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64')), decipher.final()]).toString('utf8'));
    } catch (e) { if (e.code !== 'ENOENT') throw new Error('Could not unlock saved social connections. Restore the Windows profile that saved them.'); }
  }
  async save() {
    if (!this.key) return;
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(this.state), 'utf8'), cipher.final()]);
    const payload = JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
    const file = join(this.dir, 'connections.enc');
    this.writes = this.writes.catch(() => {}).then(async () => { await mkdir(this.dir, { recursive: true }); await writeFile(`${file}.tmp`, payload, { mode: 0o600 }); await rename(`${file}.tmp`, file); });
    return this.writes;
  }
  summary() {
    return { persistent: Boolean(this.key), accounts: this.state.accounts.map(({ id, platform, name, active, expiresAt, mode, provider, profile, missing, reauthRequired, verifiedAt }) => ({ id, platform, name, active, mode: mode || 'api', provider, profile, missing:Boolean(missing), needsReconnect:Boolean(missing||reauthRequired), verifiedAt, expiresAt, expired: Boolean(missing || reauthRequired || expiresAt && expiresAt < Date.now()) })), oauthReady: Object.fromEntries(Object.entries(this.state.apps).map(([platform, app]) => [platform, Boolean(app.clientId)])), geminiConfigured: Boolean(this.config().GEMINI_API_KEY) };
  }
  config() {
    const config = { ...process.env, ...this.state.settings };
    const managed={};
    for (const account of this.state.accounts.filter(a => a.active)) {
      for (const key of platformKeys[account.platform] || []) delete config[key];
      if(account.provider==='upload-post'){
        if(!account.missing&&!account.reauthRequired&&this.state.publisher?.apiKey)managed[account.platform]={profile:account.profile,remoteId:account.remoteId,capabilities:account.capabilities||[]};
        continue;
      }
      Object.assign(config, account.credentials);
    }
    if(this.state.publisher?.apiKey){config.UPLOAD_POST_API_KEY=this.state.publisher.apiKey;config.UPLOAD_POST_TARGETS=managed;}
    return config;
  }
  async settings(input) {
    if (input.geminiApiKey !== undefined) this.state.settings.GEMINI_API_KEY = String(input.geminiApiKey).trim();
    await this.save(); return this.summary();
  }
  async json(url, { token, body, form, method = 'GET' } = {}) {
    const response = await this.fetch(url, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : body ? { 'Content-Type': 'application/json' } : {}) }, body: form ? new URLSearchParams(form) : body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
    const data = await response.json();
    if (!response.ok || data.error && data.error.code !== 'ok') throw new Error(`Account authorization failed (${response.status}). Check the token, granted permissions and app approval.`);
    return data;
  }
  async add(input, tokens = {}) {
    const platform = input.platform, token = String(tokens.access_token || input.accessToken || '').trim();
    if (!platformKeys[platform] || !token) throw new Error('Choose a platform and provide account authorization.');
    let name, remoteId, credentials;
    const version = process.env.META_API_VERSION || 'v27.0';
    if (platform === 'youtube') {
      const data = await this.json('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { token });
      const channel = data.items?.[0]; if (!channel) throw new Error('No YouTube channel was found. The token needs YouTube read and upload permissions.');
      remoteId = channel.id; name = channel.snippet.title; credentials = { YOUTUBE_ACCESS_TOKEN: token };
    } else if (platform === 'tiktok') {
      const data = await this.json('https://open.tiktokapis.com/v2/post/publish/creator_info/query/', { token, method: 'POST', body: {} });
      if (!data.data?.creator_username) throw new Error('TikTok did not return an authorized creator. Grant video.publish permission.');
      const identity=tokens.open_id?{data:{user:{open_id:tokens.open_id}}}:await this.json('https://open.tiktokapis.com/v2/user/info/?fields=open_id',{token});
      remoteId=identity.data?.user?.open_id;if(!remoteId)throw new Error('TikTok requires user.info.basic and video.publish permissions to verify this creator.');
      name = data.data.creator_nickname || data.data.creator_username; credentials = { TIKTOK_ACCESS_TOKEN: token };
    } else if (platform === 'facebook') {
      const pageId = String(input.accountId || '').trim(); if (!/^\d+$/.test(pageId)) throw new Error('Enter your Facebook Page ID.');
      const data = await this.json(`https://graph.facebook.com/${version}/${pageId}?fields=id,name`, { token });
      if (!data.id || !data.name) throw new Error('Facebook did not return the requested Page.');
      remoteId = data.id; name = data.name; credentials = { FACEBOOK_PAGE_ID: remoteId, FACEBOOK_PAGE_ACCESS_TOKEN: token };
    } else if(input.instagramLogin==='facebook') {
      const id=String(input.accountId||'').trim();if(!/^\d+$/.test(id))throw new Error('Enter the Instagram professional account ID linked to your Facebook Page.');
      const data=await this.json(`https://graph.facebook.com/${version}/${id}?fields=id,username`,{token});
      if(String(data.id)!==id||!data.username)throw new Error('The Meta token did not verify this Instagram professional account.');
      remoteId=id;name=data.username;credentials={INSTAGRAM_USER_ID:id,INSTAGRAM_ACCESS_TOKEN:token,INSTAGRAM_LOGIN:'facebook'};
    } else {
      const data = await this.json(`https://graph.instagram.com/${version}/me?fields=user_id,username`, { token });
      remoteId = String(data.user_id || data.id || ''); name = data.username;
      if (!remoteId || !name) throw new Error('Instagram did not return an authorized professional account.');
      const media = String(input.publicMediaUrl || '').trim();
      if (media && (new URL(media).protocol !== 'https:' || new URL(media).username || new URL(media).password)) throw new Error('Use an HTTPS media hosting URL.');
      credentials = { INSTAGRAM_USER_ID: remoteId, INSTAGRAM_ACCESS_TOKEN: token, INSTAGRAM_LOGIN:'instagram', PUBLIC_MEDIA_BASE_URL: media };
    }
    const prior = this.state.accounts.find(a => a.platform === platform && !a.provider && a.remoteId === remoteId);
    for (const account of this.state.accounts) if (account.platform === platform) account.active = false;
    const account = { id: prior?.id || randomUUID(), platform, name: String(name), remoteId, credentials, active: true, refreshToken: tokens.refresh_token || prior?.refreshToken, expiresAt: tokens.expires_in ? Date.now() + Number(tokens.expires_in) * 1000 : undefined };
    this.state.accounts = this.state.accounts.filter(a => a.id !== account.id); this.state.accounts.push(account);
    await this.save(); return this.summary();
  }
  async addBrowser(input) {
    if (!platformKeys[input.platform]) throw new Error('Choose a supported social platform.');
    if (input.confirmed !== true) throw new Error('Finish sign-in in your browser and confirm to save this browser connection.');
    const name = String(input.name || `${input.platform} in browser`).trim().slice(0, 100);
    if (!name) throw new Error('Give this browser connection a name.');
    for (const a of this.state.accounts) if (a.platform === input.platform) a.active = false;
    this.state.accounts.push({ id: randomUUID(), platform: input.platform, name, active: true, mode: 'browser', credentials: {} });
    await this.save(); return this.summary();
  }
  async activate(id) {
    const account = this.state.accounts.find(a => a.id === id); if (!account) throw new Error('Account not found.');
    if(account.missing||account.reauthRequired)throw new Error('Reconnect this account before selecting it.');
    for (const a of this.state.accounts) if (a.platform === account.platform) a.active = a.id === id;
    await this.save(); return this.summary();
  }
  async remove(id) {
    const account = this.state.accounts.find(a => a.id === id); if (!account) throw new Error('Account not found.');
    this.state.accounts = this.state.accounts.filter(a => a.id !== id);
    if (account.active) { const next = this.state.accounts.find(a => a.platform === account.platform&&!a.missing&&!a.reauthRequired); if (next) next.active = true; }
    await this.save(); return this.summary();
  }
  async beginOAuth(input, origin) {
    const { platform } = input;
    if (!['youtube', 'tiktok'].includes(platform)) throw new Error('Use an authorized access token to connect this platform.');
    const prior = this.state.apps[platform] || {};
    const clientId = String(input.clientId || prior.clientId || '').trim(), clientSecret = String(input.clientSecret || prior.clientSecret || '').trim();
    if (!clientId) throw new Error('Enter the platform application client ID once to enable sign-in.');
    if (platform === 'tiktok' && !clientSecret) throw new Error('TikTok requires your registered app’s client secret.');
    this.state.apps[platform] = { clientId, clientSecret }; await this.save();
    const state = randomBytes(24).toString('hex'), verifier = randomBytes(48).toString('base64url');
    const redirect = `${origin}/oauth/callback/${platform}`;
    const attempt = { platform, verifier, redirect, clientId, clientSecret, createdAt: Date.now(), status: 'waiting' };
    this.pending.set(state, attempt);
    for (const [id, value] of this.pending) if (value.createdAt < Date.now() - 600000) this.pending.delete(id);
    const url = new URL(platform === 'youtube' ? 'https://accounts.google.com/o/oauth2/v2/auth' : 'https://www.tiktok.com/v2/auth/authorize/');
    const challenge = createHash('sha256').update(verifier).digest(platform === 'youtube' ? 'base64url' : 'hex');
    const params = { response_type: 'code', redirect_uri: redirect, state, code_challenge: challenge, code_challenge_method: 'S256', scope: platform === 'youtube' ? 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly' : 'user.info.basic,video.publish' };
    params[platform === 'youtube' ? 'client_id' : 'client_key'] = clientId;
    if (platform === 'youtube') Object.assign(params, { access_type: 'offline', prompt: 'consent select_account' });
    url.search = new URLSearchParams(params).toString();
    return { url: url.href, attemptId: state, redirectUri: redirect };
  }
  oauthStatus(id) {
    const attempt = this.pending.get(id); if (!attempt || Date.now() - attempt.createdAt > 600000) throw new Error('Sign-in expired. Start again.');
    return { status: attempt.status, error: attempt.error };
  }
  async callback(platform, params) {
    const attempt = this.pending.get(params.get('state'));
    if (!attempt || attempt.platform !== platform || attempt.status !== 'waiting' || Date.now() - attempt.createdAt > 600000) throw new Error('Sign-in state is invalid or expired. Start again from Clipmax.');
    attempt.status = 'connecting';
    try {
      if (params.get('error') || !params.get('code')) throw new Error('Sign-in was cancelled or the platform did not grant authorization.');
      const form = { grant_type: 'authorization_code', code: params.get('code'), redirect_uri: attempt.redirect, code_verifier: attempt.verifier };
      form[platform === 'youtube' ? 'client_id' : 'client_key'] = attempt.clientId;
      if (attempt.clientSecret) form.client_secret = attempt.clientSecret;
      const tokens = await this.json(platform === 'youtube' ? 'https://oauth2.googleapis.com/token' : 'https://open.tiktokapis.com/v2/oauth/token/', { method: 'POST', form });
      await this.add({ platform }, tokens); attempt.status = 'connected';
    } catch (e) { attempt.status = 'failed'; attempt.error = e.message; throw e; }
    finally { delete attempt.verifier; delete attempt.clientSecret; }
  }
  async readyConfig(targets) {
    for (const account of this.state.accounts.filter(a => a.active && a.mode !== 'browser' && targets.includes(a.platform))) {
      if (!account.expiresAt || account.expiresAt > Date.now() + 60000) continue;
      const app = this.state.apps[account.platform];
      if (!account.refreshToken || !app) throw new Error(`${account.name} authorization expired. Reconnect it in Connections.`);
      const form = { grant_type: 'refresh_token', refresh_token: account.refreshToken };
      form[account.platform === 'youtube' ? 'client_id' : 'client_key'] = app.clientId;
      if (app.clientSecret) form.client_secret = app.clientSecret;
      const tokens = await this.json(account.platform === 'youtube' ? 'https://oauth2.googleapis.com/token' : 'https://open.tiktokapis.com/v2/oauth/token/', { method: 'POST', form });
      if (!tokens.access_token) throw new Error('Account refresh failed. Reconnect this account.');
      account.credentials[platformKeys[account.platform][0]] = tokens.access_token;
      account.refreshToken = tokens.refresh_token || account.refreshToken;
      account.expiresAt = Date.now() + Number(tokens.expires_in || 3600) * 1000; await this.save();
    }
    return this.config();
  }
}
