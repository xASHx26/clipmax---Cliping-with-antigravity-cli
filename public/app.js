const $ = id => document.getElementById(id);
let jobs = [], status = { connections: {}, accounts: { accounts: [], oauthReady: {} } }, filter = 'all', editing, publishing;
const selections = new Map();
const labels = { youtube: 'YouTube', tiktok: 'TikTok', facebook: 'Facebook', instagram: 'Instagram', linkedin:'LinkedIn', x:'X', threads:'Threads', bluesky:'Bluesky' };
const directPlatforms=['youtube','tiktok','facebook','instagram'];
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const working = job => ['queued', 'importing', 'transcribing', 'analyzing', 'rendering'].includes(job.status);
function notify(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(notify.timer); notify.timer = setTimeout(() => $('toast').hidden = true, 7000); }
async function api(path, method = 'GET', body) {
  const response = await fetch(path, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed.');
  return result;
}
function time(seconds) { return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`; }
function mediaInputs(prefix) {
  const webcam = prefix === 'edit' && ['x','y','w','h'].every(key => $('edit-cam-'+key).value !== '') ? Object.fromEntries(['x','y','w','h'].map(key => [key,Number($('edit-cam-'+key).value)/100])) : null;
  return { captionStyle:$(prefix+'-caption-style').value, soundSeed:Number($(prefix+'-sound-seed').value), framing: $(prefix+'-framing').value, webcam, contentWidth:Number($(prefix+'-content-width').value)/100, background: $(prefix+'-background').value, musicVolume: Number($(prefix+'-music-volume').value)/100, sourceVolume: Number($(prefix+'-source-volume').value)/100, normalize: $(prefix+'-normalize').checked, effects: $(prefix+'-effects').value, effectVolume:Number($(prefix+'-effect-volume').value)/100, effectAt: Number($(prefix+'-effect-at').value) };
}
function fillMediaInputs(settings) {
  for (const [key,fallback] of [['framing','auto'],['background','auto'],['effects','auto']]) $('edit-'+key).value = settings[key] || fallback;
  $('edit-caption-style').value=settings.captionStyle||'kinetic'; $('edit-sound-seed').value=settings.soundSeed||editing.clip.audio?.soundSeed||0;
  $('edit-mood').value=editing.clip.mood || 'neutral'; $('edit-mood-reason').textContent=editing.clip.moodReason || 'Mood not analyzed yet. Use Improve story & mix to find unusual or emotional moments.'; editing.initialMood=$('edit-mood').value;
  $('edit-music-volume').value = (settings.musicVolume ?? .18)*100; $('edit-source-volume').value = (settings.sourceVolume ?? 1)*100;
  $('edit-content-width').value=(settings.contentWidth ?? .6)*100;
  $('edit-effect-volume').value=(settings.effectVolume ?? .4)*100; $('edit-effect-file').value='';
  $('edit-effect-at').value = settings.effectAt ?? .08; $('edit-normalize').checked = settings.normalize !== false; $('edit-music-file').value = '';
  const box = settings.webcam || editing.clip.framing?.webcam;
  for (const key of ['x','y','w','h']) $('edit-cam-'+key).value = box ? Math.round(box[key]*1000)/10 : '';
}
$('preview-sound').addEventListener('click', () => { const video = $('preview-video'); video.muted=false; video.volume=1; video.play().catch(error=>notify(error.message)); });
$('edit-music-file').addEventListener('change', () => { if ($('edit-music-file').files.length) $('edit-background').value='custom'; });
$('edit-effect-file').addEventListener('change',()=>{if($('edit-effect-file').files.length)$('edit-effects').value='custom';});
let effectDemo;
document.addEventListener('click',event=>{const remix=event.target.closest('[data-remix]');if(!remix)return;const prefix=remix.dataset.remix;const values=new Uint32Array(1);crypto.getRandomValues(values);$(prefix+'-sound-seed').value=values[0]||1;notify(prefix==='edit'?'Fresh arrangement selected. Preview the background, then save the clip.':'Fresh arrangement selected for the next project.');});
document.addEventListener('click',event=>{
 const button=event.target.closest('[data-effect-demo],[data-background-demo]');if(!button)return;
 const p=button.dataset.effectDemo || button.dataset.backgroundDemo,bg=Boolean(button.dataset.backgroundDemo);
 let sound=$(p+(bg?'-background':'-effects')).value;
 if(sound==='auto'){
  if(p!=='edit'||!editing)return notify('Auto chooses after each clip is analyzed. Select a specific sound to audition it.');
  const mood=$('edit-mood').value;
  sound=bg?({sad:'cinematic',awkward:'mischief',surprised:'bounce',hype:'bounce',tense:'suspense',warm:'lofi'}[mood]||'ambient'):({sad:'none',awkward:'record_stop',surprised:'pop',playful:'tick',hype:'impact',tense:'tick',warm:'chime',neutral:'none'}[mood]||'none');
  if(mood===editing.clip.mood)sound=bg?(editing.clip.audio?.background||sound):(editing.clip.audio?.effects||sound);
 }
 if(sound==='none')return notify('No added sound for this choice.');
 effectDemo?.pause();
 const file=p==='edit'?$(bg?'edit-music-file':'edit-effect-file').files[0]:null;
 if(sound==='custom'&&!file)return notify('Choose an audio file to preview it.');
 effectDemo=new Audio(sound==='custom'?URL.createObjectURL(file):'/api/audio-preview/'+(bg?'background/':'')+sound+'?seed='+$(p+'-sound-seed').value);effectDemo.volume=bg?.35:.65;effectDemo.play().catch(error=>notify(error.message));
});
function autoUploadLabel(setting) {
  const messages = { pending: 'Auto-upload on · starts after export', checking: 'Checking auto-upload accounts', uploading: 'Auto-upload in progress', complete: 'Auto-upload accepted · check platform processing', attention: 'Auto-upload needs attention', blocked: 'Auto-upload paused · publish manually after review' };
  return `${messages[setting.state] || 'Auto-upload enabled'}${setting.message ? ' · ' + setting.message : ''}`;
}
function renderAutoTargets() {
  const selected = new Set([...document.querySelectorAll('[name=auto-platform]:checked')].map(input => input.value));
  $('auto-upload-targets').innerHTML = Object.entries(labels).map(([platform, name]) => {
    const account = status.accounts?.accounts?.find(a => a.platform === platform && a.active);
    const ready = account && !account.needsReconnect && account.mode !== 'browser' && status.connections[platform];
    return `<label><input type="checkbox" name="auto-platform" value="${platform}" ${ready ? '' : 'disabled'} ${ready && selected.has(platform) ? 'checked' : ''}><span>${name}<small>${escape(ready ? account.name : account?.mode === 'browser' ? 'Manual browser posting' : 'Connect API account')}</small></span></label>`;
  }).join('');
}
function autoUploadInput() {
  if (!$('auto-upload').checked) return { enabled: false };
  return { enabled: true, platforms: [...document.querySelectorAll('[name=auto-platform]:checked')].map(input => input.value), consent: $('auto-upload-consent').checked, youtubePrivacy: $('auto-youtube-privacy').value, tiktokPrivacy: $('auto-tiktok-privacy').value, madeForKids: $('auto-made-for-kids').checked };
}
$('auto-upload').addEventListener('change', () => {
  $('auto-upload-options').hidden = !$('auto-upload').checked;
  $('review-mode-note').textContent = $('auto-upload').checked ? 'On: selected accounts receive the generated clips automatically.' : 'Off: watch your clips first, then choose Publish selected.';
});
document.addEventListener('click', event => {
  const button = event.target.closest('[data-preview]'); if (!button) return;
  const clip = jobs.find(job => job.id === button.dataset.preview)?.clips.find(clip => clip.id === button.dataset.clip);
  if (!clip?.url) return;
  document.querySelectorAll('video').forEach(video => video.pause());
  $('preview-title').textContent = clip.title; $('preview-caption').textContent = clip.caption || '';
  $('preview-video').muted = false; $('preview-video').volume = 1; $('preview-video').src = clip.url; $('preview-dialog').showModal();
});
document.addEventListener('close', event => event.target.querySelectorAll?.('video').forEach(video => video.pause()), true);
function clipHtml(job, clip) {
  const chosen = selections.get(job.id)?.has(clip.id) ?? true;
  const browserStates = Object.entries(clip.browserHandoffs || {}).map(([p]) => '<div class="publication">' + labels[p] + ' · Upload opened in browser · Finish posting there</div>').join('');
  const publications = Object.entries(clip.publications || {}).map(([p, result]) => `<div class="publication">${labels[p]} · ${escape(result.status)}${result.url ? ` · <a href="${escape(result.url)}" target="_blank" rel="noopener">View post</a>` : ''}${result.error ? `<br>${escape(result.error)}<br>Check the platform before posting again.` : ''}</div>`).join('');
  return `<article class="clip"><div class="video-wrap"><video src="${escape(clip.url)}" controls preload="metadata" playsinline></video><label class="clip-select"><input type="checkbox" data-select="${job.id}" value="${clip.id}" ${chosen ? 'checked' : ''}> Select</label></div><div class="clip-content"><div class="clip-heading"><h3>${escape(clip.title)}</h3><span class="score" title="AI editorial estimate, not a prediction of views">✦ ${clip.score}</span></div>${clip.mood ? `<div class="mood-tag">${escape(clip.momentType?.replaceAll('_',' ') || 'moment')} · ${escape(clip.mood)}${clip.moodConfidence<.6?' · review mood':''}</div>` : ''}<div class="clip-time">${time(clip.start)} – ${time(clip.end)} &nbsp;·&nbsp; ${Math.round(clip.end - clip.start)}s &nbsp;·&nbsp; ${escape(job.aspect)}</div><p class="clip-reason">${escape(clip.reason)}</p><div class="clip-actions"><button class="button secondary" data-preview="${job.id}" data-clip="${clip.id}">▷ Watch clip</button><button class="button secondary" data-edit="${job.id}" data-clip="${clip.id}" ${job.editing || job.publishing ? 'disabled' : ''}>Edit clip</button><a class="button secondary" href="${escape(clip.url)}" download="${clip.id}.mp4">Download</a>${clip.subtitles ? `<a class="button secondary" href="${escape(clip.subtitles)}" download="${clip.id}.srt">SRT</a>` : ''}</div>${clip.audio ? `<p class="clip-audio-note">♫ Original audio ${clip.audio.normalized ? 'balanced' : 'included'} · ${escape(clip.audio.background)} background · ${escape(clip.audio.effects)} opening · ${escape(clip.captionStyle||'classic')} captions</p>${clip.audio.decision ? `<p class="sound-reason">${escape(clip.audio.decision)}</p>` : ''}` : ''}${clip.contextReviewNeeded ? '<p class="error">Review the ending: a finished sentence could not be confirmed.</p>' : ''}${publications}${browserStates}</div></article>`;
}
function render() {
  $('project-count').textContent = jobs.length;
  const visible = jobs.filter(j => filter === 'all' || (filter === 'ready' ? j.status === 'ready' : working(j)));
  const element = $('project-list');
  // Keep video playback and focused inputs intact across background polls.
  const signature = JSON.stringify(visible.map(({ workflow, ...job }) => job));
  if (element.dataset.signature === signature) { renderProjectTree(); return; }
  element.dataset.signature = signature;
  if (!visible.length) { renderProjectTree(); element.innerHTML = `<div class="empty-state"><span class="empty-icon">▥</span><h3>${jobs.length ? 'Nothing here just yet.' : 'Every great clip starts somewhere.'}</h3><p>${jobs.length ? 'Choose another filter to see your projects.' : 'Paste your first video link above. We’ll help you find the moments that deserve a bigger audience.'}</p><button class="button secondary small" id="first-project">Create your first clips</button></div>`; return; }
  const steps = ['queued', 'importing', 'transcribing', 'analyzing', 'rendering'];
  const descriptions = { queued: 'Waiting in the local processing queue…', importing: 'Importing your video and source captions…', transcribing: 'Generating AI speech captions on this computer…', analyzing: 'Looking for strong hooks and self-contained moments…', rendering: 'Reframing your clips and preparing the final edits…' };
  element.innerHTML = visible.map(job => `<article class="project"><div class="project-top"><div><h3 class="project-title">${escape(job.title)}</h3><div class="project-meta">${new Date(job.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} &nbsp;·&nbsp; ${job.provider === 'antigravity' ? 'Antigravity' : 'Gemini API'} &nbsp;·&nbsp; ${job.duration ? `${time(job.duration)} source` : 'Video import'}</div><p class="project-source-url">${escape(job.url)}</p></div><div class="project-controls"><button class="button secondary small" data-tree="${job.id}">Project tree</button>${job.status === 'ready' && !job.clips.some(c=>Object.keys(c.publications || {}).length) ? `<button class="button secondary small" data-refine="${job.id}" ${job.publishing || job.editing ? 'disabled' : ''}>Improve story & mix</button>` : ''}<button class="button secondary small delete-project" data-delete="${job.id}" ${working(job) || job.publishing || job.editing ? 'disabled title="Finish the active task before deleting"' : ''}>Delete</button><span class="status ${job.status === 'failed' ? 'failed' : working(job) ? 'working' : ''}">${job.publishing ? 'Publishing' : job.editing ? 'Saving edit' : job.status === 'ready' ? 'Ready to share' : escape(job.status)}</span></div></div><div class="project-body">${working(job) ? `<p class="working-copy">${descriptions[job.status]}</p>` : job.status === 'failed' ? `<p class="error">${escape(job.error)}</p><button class="button secondary small" data-retry="${job.id}">Retry with AI captions</button>` : `<div class="clips">${job.clips.map(c => clipHtml(job, c)).join('')}</div>`}</div>${job.notice ? `<p class="notice">${escape(job.notice)}</p>` : ''}${job.framingNotice ? `<p class="notice">${escape(job.framingNotice)}</p>` : ''}${job.autoUpload?.enabled ? `<p class="auto-upload-status">${escape(autoUploadLabel(job.autoUpload))}</p>` : ''}${job.status === 'ready' ? `<div class="project-bottom">${job.clips.some(c=>Object.values(c.publications||{}).some(r=>r.provider==='upload-post'&&r.status==='processing'))?`<button class="button secondary small" data-check-posts="${job.id}">↻ Check upload status</button>`:''}<p>${job.clips.length} clips · Download or publish your selected edits.</p><button class="button primary small" data-publish="${job.id}" ${job.publishing || job.editing ? 'disabled' : ''}>◎ &nbsp; Publish selected</button></div>` : ''}</article>`).join('');
  renderProjectTree();
}
let treeProjectId = null, treeScale = 'large', lastDeleted = null;
function renderProjectTree() {
  const select = $('tree-project');
  const options = jobs.map(job => '<option value="' + job.id + '">' + escape(job.title) + '</option>').join('');
  if (select._options !== options) { select.innerHTML = options; select._options = options; }
  if (!jobs.some(job => job.id === treeProjectId)) treeProjectId = jobs[0]?.id || null;
  select.value = treeProjectId || ''; select.disabled = !jobs.length;
  const job = jobs.find(job => job.id === treeProjectId), host = $('tree-canvas');
  if (!job) { host.innerHTML = '<div class="empty-state"><h3>No projects yet</h3><p>Add a video link in Clip studio to see its tree here.</p></div>'; $('tree-project-meta').textContent = ''; host._lastHtml = ''; return; }
  const meta = '<strong>' + escape(job.title) + '</strong><span>' + escape(job.url) + '</span>';
  if ($('tree-project-meta').innerHTML !== meta) $('tree-project-meta').innerHTML = meta;
  const html = window.ClipmaxWorkflow.html(job);
  host.dataset.scale = treeScale;
  if (host._lastHtml === html) return;
  const scroll = host.querySelector('.wf-scroll');
  const left = scroll?.scrollLeft || 0, top = scroll?.scrollTop || 0;
  host.innerHTML = html; host._lastHtml = html;
  const next = host.querySelector('.wf-scroll'); if(next) { next.scrollLeft = left; next.scrollTop = top; }
}
$('tree-project').addEventListener('change', () => { treeProjectId = $('tree-project').value; $('tree-canvas')._lastHtml = ''; renderProjectTree(); });
$('tree-studio').addEventListener('click', () => showPage('studio'));
$('tree-zoom-in').addEventListener('click', () => { treeScale = 'extra-large'; $('tree-size').textContent = 'Extra large'; renderProjectTree(); });
$('tree-zoom-out').addEventListener('click', () => { treeScale = treeScale === 'extra-large' ? 'large' : 'compact'; $('tree-size').textContent = treeScale === 'large' ? 'Large' : 'Compact'; renderProjectTree(); });
$('dismiss-delete').addEventListener('click', () => $('delete-feedback').hidden = true);
$('undo-delete').addEventListener('click', async () => {
  if (!lastDeleted) return;
  $('undo-delete').disabled = true;
  try { await api('/api/trash/' + lastDeleted + '/restore', 'POST', {}); lastDeleted = null; $('delete-feedback').hidden = true; await refresh(); notify('Project restored.'); }
  catch(error) { notify(error.message); } finally { $('undo-delete').disabled = false; }
});
async function refresh() {
  jobs = await api('/api/jobs');
  for (const job of jobs) if (!selections.has(job.id) && job.clips.length) selections.set(job.id, new Set(job.clips.map(c => c.id)));
  render();
}
async function loadStatus() {
  status = await api('/api/status');
  const count = status.accounts?.accounts?.length || Object.values(status.connections).filter(Boolean).length;
  $('connection-count').textContent = count;
  const accounts = status.accounts?.accounts || [];
  $('connection-list').innerHTML = accounts.length ? accounts.map(a => `<div class="connection account-row"><div><strong>${escape(a.name)}</strong><small>${labels[a.platform]} · ${a.mode === 'browser' ? 'Manual browser · ' : a.mode==='managed'?'Automatic · Upload-Post · ':'Direct API · '}${a.expired ? 'Refresh needed' : a.active ? 'Active account' : 'Saved account'}</small></div><div>${a.needsReconnect?'<span>Reconnect needed</span>':!a.active ? `<button class="button secondary small" data-activate="${a.id}">Use account</button>` : '<span class="account-active">Active</span>'}<button class="icon-button" data-remove="${a.id}" aria-label="Remove ${escape(a.name)} connection">×</button></div></div>`).join('') : '<div class="connections-empty"><span>◎</span><h3>Bring your channels together.</h3><p>Add an account to publish clips from this workspace.</p></div>';
  $('vault-status').textContent = status.accounts?.persistent ? 'Connection keys are saved in your encrypted local vault. Managed social authorizations are held by Upload-Post.' : 'Connections last for this session. Use the desktop app or a persistent container vault to save keys securely.';
  renderPublisher();
  renderAutoTargets();
  $('gemini-status').textContent = status.geminiConfigured ? 'A Gemini API key is saved. Leave the field blank to keep it.' : 'No Gemini API key saved. Antigravity caption analysis is available.';
  $('dependency-notice').hidden = status.downloader;
  $('dependency-notice').textContent = 'Finish local setup: run npm run setup to install the video downloader. Open Setup guide for details.';
}
$('create-form').addEventListener('submit', async e => {
  e.preventDefault(); const button = $('create-button'); button.disabled = true;
  try {
    await api('/api/jobs', 'POST', { url: $('source-url').value.trim(), provider: $('provider').value, model: $('model').value.trim(), count: Number($('count').value), maxSeconds: Number($('length').value), aspect: $('aspect').value, captions: $('captions').checked, scanStart: Number($('scan-start').value) * 60, scanMinutes: Number($('scan-length').value), focus:$('moment-focus').value, autoUpload: autoUploadInput(), media: mediaInputs('create') });
    $('source-url').value = ''; filter = 'all'; document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.filter === filter));
    await refresh(); notify('Project added. Your video is being prepared.');
  } catch (e) { notify(e.message); } finally { button.disabled = false; }
});
$('provider').addEventListener('change', () => { $('model').value = $('provider').value === 'antigravity' ? 'gemini-3.8-flash-high' : 'gemini-3.8-flash'; });
$('setup-button').addEventListener('click', async () => { try { await loadStatus(); $('setup-dialog').showModal(); } catch (e) { notify(e.message); } });
async function showConnections() { try { await loadStatus(); if (!$('connections-dialog').open) $('connections-dialog').showModal(); } catch (e) { notify(e.message); } }
$('connections-nav').addEventListener('click', showConnections);
window.clipmaxDesktop?.onConnections(showConnections);
function connectionFields() {
  const p = $('connection-platform').value, oauth = ['youtube', 'tiktok'].includes(p), browser = $('connection-method').value === 'browser', managed=$('connection-method').value==='managed';
  $('connection-methods').hidden = false;
  $('connection-method').querySelector('[value=oauth]').disabled = !oauth;
  $('connection-method').querySelector('[value=browser]').disabled=!directPlatforms.includes(p);
  $('connection-method').querySelector('[value=token]').disabled=!directPlatforms.includes(p);
  if ((!oauth && $('connection-method').value === 'oauth')||(!directPlatforms.includes(p)&&['browser','token'].includes($('connection-method').value))) {$('connection-method').value='managed';return connectionFields();}
  const signIn = oauth && $('connection-method').value === 'oauth';
  $('browser-fields').hidden = !browser; $('oauth-fields').hidden = !signIn; $('token-fields').hidden = signIn || browser || managed; $('managed-fields').hidden=!managed;
  $('google-client-file-field').hidden=p!=='youtube'; $('instagram-login-field').hidden=p!=='instagram';const metaUpload=p==='instagram'&&$('instagram-login').value==='facebook';$('page-id-field').hidden=p!=='facebook'&&!metaUpload;$('connection-id-label').textContent=metaUpload?'Instagram professional account ID':'Facebook Page ID';$('media-url-field').hidden=p!=='instagram'||metaUpload;
  $('oauth-help').textContent = p === 'youtube' ? 'Sign in on Google’s official website and choose your YouTube channel. A registered Google Desktop OAuth client is required once; Clipmax cannot create platform credentials for you.' : 'Sign in on TikTok’s official website. Your registered desktop app needs Login Kit and approved video.publish access. Unaudited clients publish privately.';
  $('oauth-redirect').textContent = p === 'tiktok' ? 'Register http://127.0.0.1:*/oauth/callback/tiktok in your TikTok desktop Login Kit redirect URLs.' : 'Use a Google OAuth client with application type Desktop app. The local callback is handled automatically.';
  $('token-help').textContent = p === 'facebook' ? 'Use a Facebook Page access token with Page publishing permission. Personal profiles are not supported.' : p === 'instagram' ? 'For direct file uploads, use a Meta Page token with Instagram publishing permissions and the linked professional account ID. Instagram Login instead requires publicly hosted exports.' : p === 'youtube' ? 'Use a token with youtube.upload and youtube.readonly permissions so Clipmax can verify the channel.' : 'Use a token with approved video.publish permission. Clipmax checks the authorized creator before saving.';
  $('oauth-app-details').open = !status.accounts?.oauthReady?.[p];
  $('connect-submit').textContent = managed?'Open account sign-in':browser ? ($('browser-signin-confirmed').checked ? 'Save browser connection' : 'Continue to sign in') : signIn ? 'Continue to sign in' : 'Verify & add connection';
  $('connection-error').hidden = true; $('connection-progress').textContent = '';
}
function renderPublisher(){
  const p=status.publisher||{},selected=$('publisher-profile').value;
  $('publisher-state').textContent=p.configured?`Provider key verified${p.plan?' · '+p.plan+' plan':''}. Select your publishing profile.`:'Add your provider API key once, then connect your channels in the browser.';
  $('publisher-profile').innerHTML=(p.profiles||[]).map(profile=>`<option value="${escape(profile.username)}">${escape(profile.name)} · ${escape(profile.username)}</option>`).join('');
  if((p.profiles||[]).some(profile=>profile.username===selected))$('publisher-profile').value=selected;
}
async function openPublisherPage(url){if(window.clipmaxDesktop)await window.clipmaxDesktop.openAuth(url);else window.open(url,'_blank','noopener');}
async function publisherAction(action){
  $('connection-error').hidden=true;
  try{await action()}catch(error){$('connection-error').textContent=error.message;$('connection-error').hidden=false;}
}
async function savePublisherKey(){
  const apiKey=$('publisher-key').value.trim();if(!apiKey)throw new Error('Enter your Upload-Post API key.');
  await api('/api/publisher/configure','POST',{apiKey});$('publisher-key').value='';await loadStatus();renderPublisher();
}
$('publisher-save').addEventListener('click',()=>publisherAction(savePublisherKey));
$('publisher-create-profile').addEventListener('click',()=>publisherAction(async()=>{
  if($('publisher-key').value.trim())await savePublisherKey();
  const username=$('publisher-new-profile').value.trim();await api('/api/publisher/profile','POST',{username,name:'Clipmax workspace'});await loadStatus();$('publisher-profile').value=username;
}));
$('publisher-sync').addEventListener('click',()=>publisherAction(async()=>{
  await api('/api/publisher/sync','POST',{profile:$('publisher-profile').value});await loadStatus();
  $('add-connection-dialog').close();await showConnections();notify('Connected accounts verified. Choose these accounts under Auto-upload after export.');
}));
$('publisher-dashboard').addEventListener('click',()=>publisherAction(()=>openPublisherPage('https://app.upload-post.com/')));
$('publisher-key-page').addEventListener('click',()=>publisherAction(()=>openPublisherPage('https://app.upload-post.com/api-keys')));
$('publisher-pricing').addEventListener('click',()=>publisherAction(()=>openPublisherPage('https://www.upload-post.com/pricing/')));
async function showAddConnection() {
  try { await loadStatus(); $('connection-form').reset(); renderPublisher(); connectionFields(); $('add-connection-dialog').showModal(); } catch (e) { notify(e.message); }
}
for (const id of ['add-connection-button', 'new-connection']) $(id).addEventListener('click', showAddConnection);
$('connection-platform').addEventListener('change', () => { const platform=$('connection-platform').value;$('connection-method').value=['youtube','tiktok'].includes(platform)?'oauth':directPlatforms.includes(platform)?'token':'managed';connectionFields(); });
$('connection-method').addEventListener('change', connectionFields);$('instagram-login').addEventListener('change',connectionFields);
$('google-client-file').addEventListener('change',()=>publisherAction(async()=>{const file=$('google-client-file').files[0];if(!file)return;if(file.size>65536)throw new Error('Choose the small Google OAuth client JSON file.');const data=JSON.parse(await file.text());if(!data.installed?.client_id)throw new Error('Choose a Google Desktop OAuth client JSON file.');$('oauth-client-id').value=data.installed.client_id;$('oauth-client-secret').value=data.installed.client_secret||'';$('connection-progress').textContent='Desktop OAuth client loaded locally. Continue to Google sign-in.';}));
$('connection-list').addEventListener('click', async e => {
  const activate = e.target.closest('[data-activate]'), remove = e.target.closest('[data-remove]');
  if (!activate && !remove) return;
  try { if (activate) await api(`/api/connections/${activate.dataset.activate}/activate`, 'POST', {}); else await api(`/api/connections/${remove.dataset.remove}`, 'DELETE', {}); await loadStatus(); } catch (e) { notify(e.message); }
});
$('connection-form').addEventListener('submit', async e => {
  e.preventDefault(); const button = $('connect-submit'); button.disabled = true; $('connection-error').hidden = true;
  const platform = $('connection-platform').value;
  try {
    if($('connection-method').value==='managed'){
      if($('publisher-key').value.trim())await savePublisherKey();
      if(!status.publisher?.configured)throw new Error('Verify your Upload-Post API key first.');
      const profile=$('publisher-profile').value;if(!profile)throw new Error('Choose or create a publishing profile first.');
      const result=await api('/api/publisher/connect','POST',{profile});await openPublisherPage(result.url);
      $('connection-progress').textContent='Finish account sign-in, return here, then select Refresh connected accounts.';return;
    }else if ($('connection-method').value === 'browser') {
      if (!window.clipmaxDesktop) throw new Error('Open the desktop app to use browser publishing.');
      if (!$('browser-signin-confirmed').checked) { await window.clipmaxDesktop.browserSignIn(platform); $('connection-progress').textContent = 'Sign in in your browser, then check the confirmation above and save this connection.'; return; }
      await api('/api/connections/browser', 'POST', { platform, confirmed: true, name: $('browser-account-name').value.trim() || `${labels[platform]} in browser` });
    } else if ($('connection-method').value === 'oauth' && ['youtube', 'tiktok'].includes(platform)) {
      const attempt = await api('/api/oauth/start', 'POST', { platform, clientId: $('oauth-client-id').value.trim(), clientSecret: $('oauth-client-secret').value.trim() });
      $('oauth-client-secret').value = '';
      if (window.clipmaxDesktop) await window.clipmaxDesktop.openAuth(attempt.url); else window.open(attempt.url, '_blank', 'noopener');
      $('connection-progress').textContent = 'Finish sign-in in your browser. This window will update when the account is connected.';
      let connected = false;
      for (let i = 0; i < 300 && $('add-connection-dialog').open; i++) {
        await new Promise(r => setTimeout(r, 1800));
        const result = await api(`/api/oauth/${attempt.attemptId}`);
        if (result.status === 'failed') throw new Error(result.error);
        if (result.status === 'connected') { connected = true; break; }
      }
      if (!connected) { if ($('add-connection-dialog').open) throw new Error('Sign-in timed out. Try again.'); return; }
    } else {
      $('connection-progress').textContent = 'Checking the authorized account with the platform…';
      await api('/api/connections', 'POST', { platform, accessToken: $('connection-token').value.trim(), accountId: $('connection-account-id').value.trim(), publicMediaUrl: $('connection-media-url').value.trim(), instagramLogin:$('instagram-login').value });
    }
    $('connection-form').reset(); $('add-connection-dialog').close(); await showConnections(); notify('Connection saved. Browser connections finish posting in your browser; API accounts publish from the app.');
  } catch (error) { $('connection-error').textContent = error.message; $('connection-error').hidden = false; $('connection-progress').textContent = ''; }
  finally { button.disabled = false; }
});
$('ai-form').addEventListener('submit', async e => {
  e.preventDefault();
  try { if ($('gemini-key').value.trim()) await api('/api/settings/ai', 'POST', { geminiApiKey: $('gemini-key').value.trim() }); $('gemini-key').value = ''; await loadStatus(); $('setup-dialog').close(); notify('AI settings saved. No restart needed.'); } catch (e) { notify(e.message); }
});
$('remove-gemini').addEventListener('click', async () => { try { await api('/api/settings/ai', 'POST', { geminiApiKey: '' }); await loadStatus(); notify('Saved Gemini API key removed.'); } catch (e) { notify(e.message); } });
$('studio-nav').addEventListener('click', () => showPage('studio'));
$('plugins-nav').addEventListener('click', () => showPage('plugins'));
$('tree-nav').addEventListener('click', () => showPage('tree'));
window.addEventListener('hashchange', () => showPage(['#plugins','#tree'].includes(location.hash) ? location.hash.slice(1) : 'studio'));
async function showPage(page) {
  const plugins = page === 'plugins';
  $('studio-page').hidden = page !== 'studio'; $('plugins-page').hidden = !plugins; $('tree-page').hidden = page !== 'tree';
  for (const [id, active] of [['studio-nav', page === 'studio'], ['plugins-nav', plugins], ['tree-nav', page === 'tree']]) { $(id).classList.toggle('active', active); if (active) $(id).setAttribute('aria-current', 'page'); else $(id).removeAttribute('aria-current'); }
  $('breadcrumb-title').textContent = plugins ? 'Plugins' : page === 'tree' ? 'Project tree' : 'Clip studio';
  history.replaceState(null, '', '#' + page);
  if (page === 'tree') renderProjectTree();
  window.scrollTo({ top: 0 });
  if (plugins) { try { await loadMcp(); } catch (error) { $('mcp-progress').textContent = error.message; } }
}
document.querySelectorAll('.close-dialog').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => { filter = tab.dataset.filter; document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab)); $('project-list').dataset.signature = ''; render(); }));
$('project-list').addEventListener('change', e => { if (e.target.dataset.select) { const selected = selections.get(e.target.dataset.select); if (e.target.checked) selected.add(e.target.value); else selected.delete(e.target.value); } });
$('project-list').addEventListener('click', e => {
  if (e.target.closest('#first-project')) { $('source-url').focus(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  const check=e.target.closest('[data-check-posts]');if(check){check.disabled=true;api('/api/jobs/'+check.dataset.checkPosts+'/publication-status','POST',{}).then(refresh).catch(error=>notify(error.message)).finally(()=>check.disabled=false);return;}
  const tree = e.target.closest('[data-tree]');
  if (tree) { treeProjectId = tree.dataset.tree; $('tree-canvas')._lastHtml = ''; showPage('tree'); }
  const refine = e.target.closest('[data-refine]');
  if (refine) { refine.disabled=true; api('/api/jobs/'+refine.dataset.refine+'/refine','POST',{media:mediaInputs('create'),focus:$('moment-focus').value}).then(refresh).then(()=>notify('Rebuilding complete stories with audio and streamer-safe framing.')).catch(error=>notify(error.message)).finally(()=>refine.disabled=false); }
  const deletion = e.target.closest('[data-delete]');
  if (deletion) {
    deletion.disabled = true;
    api('/api/jobs/' + deletion.dataset.delete, 'DELETE', {}).then(async result => { lastDeleted = result.undoId; selections.delete(deletion.dataset.delete); $('delete-feedback').hidden = false; await refresh(); }).catch(error => notify(error.message)).finally(() => deletion.disabled = false);
  }
  const retry = e.target.closest('[data-retry]');
  if (retry) { retry.disabled = true; api(`/api/jobs/${retry.dataset.retry}/retry`, 'POST', {}).then(refresh).catch(error => notify(error.message)).finally(() => retry.disabled = false); }
  const edit = e.target.closest('[data-edit]');
  if (edit) {
    const job = jobs.find(j => j.id === edit.dataset.edit), clip = job.clips.find(c => c.id === edit.dataset.clip);
    editing = { job, clip }; fillMediaInputs(clip.media || job.media || {}); editing.initialMedia = JSON.stringify(mediaInputs('edit'));  $('edit-title').value = clip.title; $('edit-start').value = clip.start; $('edit-end').value = clip.end; $('edit-caption').value = clip.caption; $('edit-dialog').showModal();
  }
  const post = e.target.closest('[data-publish]');
  if (post) {
    const selected = [...(selections.get(post.dataset.publish) || [])];
    if (!selected.length) return notify('Select at least one clip first.');
    publishing = { jobId: post.dataset.publish, clipIds: selected };
    $('publish-previews').innerHTML = jobs.find(j => j.id === post.dataset.publish).clips.filter(c => selected.includes(c.id)).map(c => `<article><video src="${escape(c.url)}" controls playsinline preload="metadata"></video><strong>${escape(c.title)}</strong></article>`).join('');
    $('publish-summary').textContent = `${selected.length} selected clip${selected.length === 1 ? '' : 's'}. Choose where to share them.`;
    $('publish-targets').innerHTML = Object.entries(labels).map(([id, name]) => `<label><input type="checkbox" name="platform" value="${id}" ${status.connections[id] ? '' : 'disabled'}>${name}<small>${status.connections[id] ? (status.accounts?.accounts?.some(a => a.platform === id && a.active && a.mode === 'browser') ? 'Finish in browser' : 'Automatic upload ready') : 'Connect account'}</small></label>`).join('');
    $('publish-consent').checked = false; $('publish-dialog').showModal();
  }
});
$('refresh-style').addEventListener('click',()=>{editing.refreshStyle=true;$('edit-form').requestSubmit();});
$('recheck-framing').addEventListener('click',()=>{editing.refreshFraming=true;$('edit-framing').value='auto';$('edit-form').requestSubmit();});
$('edit-form').addEventListener('submit', async e => {
  e.preventDefault(); $('save-edit').disabled = true; $('save-edit').textContent = 'Saving…';
  try {
    const file = $('edit-music-file').files[0];
    if (file) { const upload = await fetch(`/api/jobs/${editing.job.id}/audio`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file }); if (!upload.ok) throw new Error((await upload.json()).error); $('edit-background').value = 'custom'; }
    const effectFile=$('edit-effect-file').files[0];
    if(effectFile){const upload=await fetch(`/api/jobs/${editing.job.id}/audio/effect`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:effectFile});if(!upload.ok)throw new Error((await upload.json()).error);$('edit-effects').value='custom';}
    const media = mediaInputs('edit'), changedMedia = Boolean(file) || Boolean(effectFile) || JSON.stringify(media) !== editing.initialMedia;
    await api(`/api/jobs/${editing.job.id}/clips/${editing.clip.id}`, 'PATCH', { title: $('edit-title').value, caption: $('edit-caption').value, start: Number($('edit-start').value), end: Number($('edit-end').value), refreshFraming:editing.refreshFraming===true, refreshStyle:editing.refreshStyle===true, ...(changedMedia ? {media} : {}), ...($('edit-mood').value!==editing.initialMood?{mood:$('edit-mood').value}:{}) });
    $('edit-dialog').close(); await refresh(); notify('Clip saved.');
  } catch (e) { notify(e.message); } finally { $('save-edit').disabled = false; $('save-edit').textContent = 'Save clip'; }
});
$('publish-form').addEventListener('submit', async e => {
  e.preventDefault(); const targets = [...document.querySelectorAll('[name=platform]:checked')].map(x => x.value);
  if (!targets.length) return notify('Choose a connected platform. Use + Add connection to connect an account.');
  const button = e.submitter; button.disabled = true;
  try {
    const browserTargets = targets.filter(p => status.accounts?.accounts?.some(a => a.platform === p && a.active && a.mode === 'browser'));
    const apiTargets = targets.filter(p => !browserTargets.includes(p));
    if (apiTargets.length) await api(`/api/jobs/${publishing.jobId}/publish`, 'POST', { clipIds: publishing.clipIds, platforms: apiTargets, consent: $('publish-consent').checked, youtubePrivacy: $('youtube-privacy').value, tiktokPrivacy: $('tiktok-privacy').value, madeForKids: $('made-for-kids').checked });
    $('publish-dialog').close();
    if (browserTargets.length) { browserQueue = publishing.clipIds.flatMap(clipId => browserTargets.map(platform => ({ jobId: publishing.jobId, clipId, platform }))); $('browser-handoff-dialog').showModal(); await nextBrowserUpload(); }
    await refresh(); notify(apiTargets.length ? 'API publishing started. Browser uploads must be finished in the browser.' : 'Upload opened in your browser. Finish posting there.');
  } catch (e) { notify(e.message); } finally { button.disabled = false; }
});
Promise.all([loadStatus(), refresh()]).catch(e => notify(e.message));
let refreshing = false;
setInterval(async () => { if (refreshing) return; refreshing = true; try { await refresh(); } catch {} finally { refreshing = false; } }, 1000);

$('browser-signin-confirmed').addEventListener('change', connectionFields);
let browserQueue = [];
async function nextBrowserUpload() {
  const item = browserQueue.shift();
  if (!item) { $('browser-handoff-dialog').close(); return; }
  const job = jobs.find(j => j.id === item.jobId), clip = job?.clips.find(c => c.id === item.clipId);
  if (!window.clipmaxDesktop) throw new Error('Browser publishing requires the desktop app.');
  await window.clipmaxDesktop.browserPublish(item);
  await api('/api/jobs/' + item.jobId + '/browser-handoff', 'POST', item);
  $('handoff-title').textContent = labels[item.platform] + ' · ' + (clip?.title || item.clipId) + '. ' + browserQueue.length + ' more uploads after this one.';
  $('handoff-next').textContent = browserQueue.length ? 'I finished this one · Open next upload' : 'Done';
}
$('handoff-next').addEventListener('click', () => nextBrowserUpload().catch(e => notify(e.message)));
let mcpTools = [];
async function loadMcp() {
  const services = await api('/api/mcp');
  $('plugin-count').textContent = services.filter(s => s.connected).length;
  $('mcp-services').innerHTML = services.map(s => '<article class="plugin-card"><div class="plugin-card-top"><span class="plugin-logo ' + s.id + '">' + (s.id === 'descript' ? 'D' : 'v') + '</span><span class="plugin-state ' + (s.connected ? 'is-connected' : '') + '">' + (s.connected ? 'Connected' : s.saved ? 'Saved · reconnect' : s.status === 'awaiting_sign_in' ? 'Waiting for sign-in' : 'Not connected') + '</span></div><h3>' + escape(s.name) + '</h3><span class="plugin-category">MCP · ' + (s.id === 'descript' ? 'Video editing & captions' : 'Creator tools & video research') + '</span><p>' + escape(s.description) + '</p><div class="plugin-card-actions"><button class="button ' + (s.connected ? 'secondary' : 'primary') + '" data-mcp-connect="' + s.id + '">' + (s.connected ? 'Refresh tools' : 'Connect plugin') + '</button>' + (s.saved || s.connected ? '<button class="button secondary" data-mcp-disconnect="' + s.id + '">Disconnect</button>' : '') + '</div></article>').join('');
  const connected = services.filter(s => s.connected);
  const previous = $('mcp-service').value;
  $('mcp-service').innerHTML = connected.map(s => '<option value="' + s.id + '">' + escape(s.name) + '</option>').join('');
  if (connected.some(s => s.id === previous)) $('mcp-service').value = previous;
  $('mcp-tool-form').hidden = !connected.length;
  if (connected.length) await loadMcpTools();
}
async function loadMcpTools() {
  mcpTools = await api('/api/mcp/' + $('mcp-service').value + '/tools');
  $('mcp-tool').innerHTML = mcpTools.map(t => '<option value="' + escape(t.name) + '">' + escape(t.title || t.name) + '</option>').join('');
  mcpToolFields();
}
function mcpToolFields() {
  const tool = mcpTools.find(t => t.name === $('mcp-tool').value);
  $('mcp-description').textContent = tool?.description || '';
  $('mcp-schema').textContent = JSON.stringify(tool?.inputSchema || {}, null, 2);
  const args = {};
  for (const key of tool?.inputSchema?.required || []) {
    const type = tool.inputSchema.properties?.[key]?.type;
    args[key] = type === 'number' || type === 'integer' ? 0 : type === 'boolean' ? false : type === 'array' ? [] : type === 'object' ? {} : '';
  }
  $('mcp-arguments').value = JSON.stringify(args, null, 2); $('mcp-consent').checked = false; $('mcp-json-mode').checked = false;
  const properties = tool?.inputSchema?.properties || {};
  $('mcp-input-fields').innerHTML = Object.entries(properties).map(([key, property]) => {
    const required = tool.inputSchema.required?.includes(key), label = property.title || key.replaceAll('_', ' ');
    const attr = ' data-mcp-arg="' + escape(key) + '" data-kind="' + escape(property.type || 'string') + '" ' + (required ? 'required' : '');
    let field;
    if (property.enum) field = '<select' + attr + '>' + property.enum.map(value => '<option value="' + escape(value) + '">' + escape(value) + '</option>').join('') + '</select>';
    else if (property.type === 'boolean') field = '<input type="checkbox"' + attr + '>';
    else if (['object', 'array'].includes(property.type)) field = '<textarea rows="3"' + attr + ' placeholder="' + (property.type === 'array' ? '[]' : '{}') + '"></textarea>';
    else field = '<input ' + attr + ' type="' + (['number', 'integer'].includes(property.type) ? 'number' : 'text') + '" placeholder="' + escape(property.description || '') + '">';
    return '<label>' + escape(label) + (required ? ' *' : '') + field + '</label>';
  }).join('');
}
$('mcp-button').addEventListener('click', () => showPage('plugins'));
if (['#plugins','#tree'].includes(location.hash)) showPage(location.hash.slice(1));
$('mcp-service').addEventListener('change', () => loadMcpTools().catch(e => $('mcp-progress').textContent = e.message));
$('mcp-tool').addEventListener('change', mcpToolFields);
$('mcp-services').addEventListener('click', async e => {
  const button = e.target.closest('[data-mcp-connect]'), disconnect = e.target.closest('[data-mcp-disconnect]');
  if (disconnect) { await api('/api/mcp/' + disconnect.dataset.mcpDisconnect + '/disconnect', 'POST', {}); await loadMcp(); return; }
  if (!button) return;
  button.disabled = true; const id = button.dataset.mcpConnect; $('mcp-progress').textContent = 'Connecting this app to the service…';
  try {
    const result = await api('/api/mcp/' + id + '/connect', 'POST', {});
    if (result.authUrl) {
      if (window.clipmaxDesktop) await window.clipmaxDesktop.openAuth(result.authUrl); else window.open(result.authUrl, '_blank', 'noopener');
      $('mcp-progress').textContent = 'Finish service sign-in in your browser. Clipmax is waiting for authorization.';
      let connected = false;
      for (let i=0; i<300 && !$('plugins-page').hidden; i++) {
        await new Promise(r => setTimeout(r, 1800));
        const state = await api('/api/mcp/' + id + '/status');
        if (state.status === 'failed') throw new Error(state.error || 'Connection failed.');
        if (state.status === 'connected') { connected = true; break; }
      }
      if (!connected) throw new Error('Sign-in is not complete. Connect again when ready.');
    }
    $('mcp-progress').textContent = 'Connected directly to Clipmax. Choose a tool below.'; await loadMcp();
  } catch(error) { $('mcp-progress').textContent = error.message; } finally { button.disabled = false; }
});
$('mcp-tool-form').addEventListener('submit', async e => {
  e.preventDefault(); $('mcp-run').disabled = true; $('mcp-result').hidden = false; $('mcp-result').textContent = 'Running the selected tool…';
  try {
    const result = await api('/api/mcp/' + $('mcp-service').value + '/call', 'POST', { name: $('mcp-tool').value, arguments: mcpArguments(), confirmed: $('mcp-consent').checked });
    $('mcp-result').textContent = JSON.stringify(result, null, 2).slice(0, 60000);
  } catch(error) { $('mcp-result').textContent = error.message; } finally { $('mcp-run').disabled = false; $('mcp-consent').checked = false; }
});

function mcpArguments() {
  if ($('mcp-json-mode').checked) return JSON.parse($('mcp-arguments').value);
  const args = {};
  for (const field of document.querySelectorAll('[data-mcp-arg]')) {
    const key = field.dataset.mcpArg, type = field.dataset.kind;
    if (type === 'boolean') args[key] = field.checked;
    else if (field.value !== '') args[key] = ['number','integer'].includes(type) ? Number(field.value) : ['object','array'].includes(type) ? JSON.parse(field.value) : field.value;
  }
  return args;
}

let treeDrag = null;
$('tree-canvas').addEventListener('pointerdown', event => {
  if (event.button !== 0 || event.target.closest('button,input,select,textarea,a')) return;
  const viewport = event.target.closest('.wf-scroll'); if (!viewport) return;
  treeDrag = { x:event.clientX, y:event.clientY, left:viewport.scrollLeft, top:viewport.scrollTop };
  $('tree-canvas').setPointerCapture(event.pointerId); event.preventDefault();
});
$('tree-canvas').addEventListener('pointermove', event => {
  if (!treeDrag) return; const viewport = $('tree-canvas').querySelector('.wf-scroll'); if (!viewport) return;
  viewport.scrollLeft = treeDrag.left - (event.clientX-treeDrag.x); viewport.scrollTop = treeDrag.top - (event.clientY-treeDrag.y);
});
for (const event of ['pointerup','pointercancel','lostpointercapture']) $('tree-canvas').addEventListener(event, () => treeDrag=null);

$('tree-canvas').addEventListener('click', async e => { const button=e.target.closest('[data-tree-retry]');if(!button)return;button.disabled=true;try{await api('/api/jobs/'+button.dataset.treeRetry+'/retry','POST',{});await refresh();notify('Retry started. Completed video import will be reused.');}catch(error){notify(error.message);}finally{button.disabled=false;}});
