// Runs in a hidden Electron window. It never controls the user's desktop.
const { app, BrowserWindow } = require('electron');
const { createServer } = require('node:http');
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { resolve, join } = require('node:path');
const assert = require('node:assert/strict');
const root = resolve('.');
const job = JSON.parse(readFileSync(join(root, 'data/progress-verification/completed-job.json')));
job.id = '11111111-1111-4111-8111-111111111111'; job.sourceCreator={name:'KaiCenat'};
job.clips = Array.from({ length: 3 }, (_, index) => ({ ...job.clips[0], id: `clip-${index + 1}`, title: `Review clip ${index + 1}`, url: '/sample.mp4' }));
job.clips.forEach((clip,index)=>Object.assign(clip,{mood:['awkward','sad','surprised'][index],momentType:['weird','sad','out_of_pocket'][index],moodConfidence:.9,moodReason:'Suggested from this clip’s dialogue',audio:{effects:['record_stop','none','pop'][index],background:['playful','melancholy','playful'][index],normalized:true,decision:'Matched to the suggested mood'}}));
const accounts = [{ id: 'youtube-api', platform: 'youtube', name: 'Test channel', active: true, mode: 'api' }, { id: 'tiktok-browser', platform: 'tiktok', name: 'Browser creator', active: true, mode: 'browser' }];
const status = { accounts: { accounts, oauthReady: {} }, connections: { youtube: true, tiktok: true }, downloader: true };
let lastCreate,lastEdit,lastMetadata;
let pluginState='reconnecting';
const server = createServer(async (req, res) => {
  if(req.method==='POST'&&req.url.endsWith('/publish')){for await(const part of req){}job.publishing=true;job.workflow.stages.metadata={state:'running',percent:null,message:'Preparing AI copy'};await new Promise(resolve=>setTimeout(resolve,800));job.workflow.stages.metadata.state='done';job.workflow.clips['clip-1']={'upload:youtube':{state:'running',percent:37,bytes:370000,totalBytes:1000000,message:'Sending video bytes'}};res.writeHead(202,{'Content-Type':'application/json'});return res.end(JSON.stringify(job));}
  if(req.url==='/api/mcp'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify([{id:'descript',name:'Descript',description:'Test editing plugin',saved:true,connected:pluginState==='connected',status:pluginState}]));}
  if(req.url==='/api/mcp/descript/tools'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify([{name:'read_project',description:'Test tool',inputSchema:{type:'object',properties:{project_id:{type:'string'}},required:['project_id']}}]));}
  if(req.url==='/api/ai/profile'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({lastObservedAccount:'creator@example.com',automaticSwitchSupported:false,accounts:[{email:'creator@example.com',quota:{'gemini-weekly':{remaining_fraction:.36,remaining_amount:null,reset_time:new Date(Date.now()+3600000).toISOString()}},context_window:{total_input_tokens:1200,total_output_tokens:200},model:{display_name:'Gemini test model'},plan_tier:'Test plan',observedAt:new Date().toISOString(),stale:false}]}));}
  if (req.url === '/api/status') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(status)); }
  if(req.method==='POST' && req.url.endsWith('/cancel')){job.status='cancelled';job.canCancel=false;job.cancelling=false;job.editing=false;for(const entry of Object.values(job.workflow.stages))if(entry.state==='running')entry.state='cancelled';res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(job));}
  if(req.method==='POST' && req.url.endsWith('/metadata')){let input='';for await(const part of req)input+=part;lastMetadata=JSON.parse(input);job.streamerName=lastMetadata.streamerName;job.clips[0].title='AI generated title';job.clips[0].description='A grounded description #reaction';job.clips[0].tags=['reaction','story'];job.clips[0].publicationMetadata={provider:'Gemini CLI via Antigravity'};res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(job));}
  if(req.method==='PATCH' && req.url.includes('/clips/')){let body='';for await(const chunk of req)body+=chunk;lastEdit=JSON.parse(body);res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(job));}
  if (req.url === '/api/jobs') {
    if (req.method === 'POST') { let body = ''; for await (const chunk of req) body += chunk; lastCreate = JSON.parse(body); }
    res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(req.method === 'POST' ? job : [job]));
  }
  const files = { '/': 'public/index.html', '/app.js': 'public/app.js', '/workflow.js': 'public/workflow.js', '/style.css': 'public/style.css', '/workflow.css': 'public/workflow.css', '/sample.mp4': 'data/verification/clip-1.mp4' };
  const file = files[req.url]; if (!file) { res.writeHead(404); return res.end(); }
  res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.mp4') ? 'video/mp4' : 'text/html');
  const bytes = readFileSync(join(root, file));
  res.setHeader('Accept-Ranges', 'bytes');
  const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
  if (range) {
    const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    res.writeHead(206, { 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${bytes.length}` });
    return res.end(bytes.subarray(start, end + 1));
  }
  res.setHeader('Content-Length', bytes.length); res.end(bytes);
});
app.whenReady().then(async () => {
  let win, exitCode = 0;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    win = new BrowserWindow({ width: 1600, height: 1100, show: false, webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, sandbox: true } });
    const errors = []; win.webContents.on('console-message', (event) => { if (event.level === 'error') errors.push(event.message); });
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    await win.webContents.executeJavaScript(`new Promise(resolve => { const timer=setInterval(()=>{if(document.querySelector('[data-preview]')){clearInterval(timer);resolve()}},50) })`);
    assert.equal(await win.webContents.executeJavaScript(`autoUploadInput().enabled`), false);
    await win.webContents.executeJavaScript(`document.getElementById('tree-nav').click()`);
    const positions = await win.webContents.executeJavaScript(`[...document.querySelectorAll('.wf-tree .wf-node')].slice(0,4).map(node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y}})`);
    assert.ok(positions.every((r, i) => !i || r.y > positions[i - 1].y));
    assert.ok(positions.every(r => Math.abs(r.x - positions[0].x) < 2));
    await new Promise(resolve => setTimeout(resolve, 200));
    mkdirSync(join(root, 'data/review-ui-verification'), { recursive: true });
    writeFileSync(join(root, 'data/review-ui-verification/vertical-tree.png'), (await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript(`document.querySelector('#tree-canvas [data-preview]').click()`);
    assert.equal(await win.webContents.executeJavaScript(`document.getElementById('preview-dialog').open`), true);
    await win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const v=document.getElementById('preview-video');if(v.readyState>=1)return resolve();v.onloadedmetadata=resolve;v.onerror=()=>reject(Error('Preview media failed: '+JSON.stringify({code:v.error?.code,message:v.error?.message,src:v.currentSrc,support:v.canPlayType('video/mp4; codecs=\"avc1.42E01E, mp4a.40.2\"')})));setTimeout(()=>reject(Error('Preview timeout')),8000)})`);
    await win.webContents.executeJavaScript(`(async()=>{const v=document.getElementById('preview-video');v.muted=true;await v.play();await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Video playback did not advance')),6000);v.ontimeupdate=()=>{if(v.currentTime>0.2){clearTimeout(timer);resolve()}}});v.pause()})()`);
    await new Promise(resolve => setTimeout(resolve, 200));
    writeFileSync(join(root, 'data/review-ui-verification/watch-clip.png'), (await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript(`document.getElementById('preview-dialog').close();document.getElementById('studio-nav').click();document.querySelector('[data-publish]').click()`);
    assert.equal(await win.webContents.executeJavaScript(`document.querySelectorAll('#publish-previews video[controls]').length`), 3);
    await win.webContents.executeJavaScript(`document.getElementById('publish-dialog').close();document.getElementById('auto-upload').click();document.querySelector('[name=auto-platform][value=youtube]').checked=true;document.getElementById('auto-upload-consent').checked=true;document.getElementById('source-url').value='https://youtu.be/review-test';document.getElementById('create-form').requestSubmit()`);
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.deepEqual(lastCreate.autoUpload.platforms, ['youtube']); assert.equal(lastCreate.autoUpload.enabled, true); assert.equal(lastCreate.autoUpload.consent, true);
    assert.equal(lastCreate.streamerName,'');assert.equal(lastCreate.focus,'weird_sad_unexpected');assert.equal(lastCreate.media.effects,'auto');assert.equal(lastCreate.media.background,'auto');
    assert.equal(await win.webContents.executeJavaScript(`document.querySelector('[name=auto-platform][value=tiktok]').disabled`), true);
    await win.webContents.executeJavaScript(`document.getElementById('auto-upload').click();document.getElementById('source-url').value='https://youtu.be/review-test';document.getElementById('create-form').requestSubmit()`);
    await new Promise(resolve => setTimeout(resolve, 200)); assert.equal(lastCreate.autoUpload.enabled, false);
    await win.webContents.executeJavaScript(`document.querySelector('[data-edit]').click()`);
    assert.equal(await win.webContents.executeJavaScript(`document.getElementById('edit-mood').value`),'awkward');
    assert.equal(await win.webContents.executeJavaScript(`document.getElementById('edit-streamer-name').value`),'KaiCenat');
    await win.webContents.executeJavaScript(`document.getElementById('generate-edit-metadata').click();new Promise((resolve,reject)=>{const stop=setTimeout(()=>reject(Error('AI details UI timeout')),3000);const t=setInterval(()=>{if(document.getElementById('edit-title').value==='AI generated title'){clearTimeout(stop);clearInterval(t);resolve()}},25)})`);
    assert.equal(await win.webContents.executeJavaScript(`document.getElementById('edit-caption').value`),'A grounded description #reaction');
    assert.equal(await win.webContents.executeJavaScript(`document.getElementById('edit-tags').value`),'reaction, story');assert.equal(lastMetadata.streamerName,'KaiCenat');
    writeFileSync(join(root,'data/review-ui-verification/ai-publishing-details.png'),(await win.webContents.capturePage()).toPNG());
    const invalid=await win.webContents.executeJavaScript(`[...document.querySelectorAll('#edit-form :invalid')].map(input=>({id:input.id,reason:input.validationMessage}))`);assert.deepEqual(invalid,[]);
    await win.webContents.executeJavaScript(`document.getElementById('edit-mood').value='sad';document.getElementById('edit-form').requestSubmit()`);
    await new Promise(resolve=>setTimeout(resolve,200));assert.equal(lastEdit.mood,'sad'); assert.equal(lastEdit.description,'A grounded description #reaction');assert.equal(lastEdit.tags,'reaction, story');
    job.editing=true;job.workflow.stages.metadata={state:'running',percent:null,message:'Gemini CLI is writing publishing details'};
    await win.webContents.executeJavaScript('refresh()');
    assert.equal(await win.webContents.executeJavaScript(`document.querySelector('[data-project-activity] progress').hasAttribute('value')`),false);
    await win.webContents.executeJavaScript("document.querySelector('[data-project-activity]').scrollIntoView({block:'center'})");
    await new Promise(resolve=>setTimeout(resolve,400));
    writeFileSync(join(root,'data/review-ui-verification/ai-work-progress.png'),(await win.webContents.capturePage()).toPNG());
    job.editing=false;job.publishing=true;job.workflow.stages.metadata.state='done';job.workflow.clips['clip-1']={'upload:youtube':{state:'running',percent:31,bytes:310000,totalBytes:1000000,message:'Sending video bytes'}};
    await win.webContents.executeJavaScript('refresh()');
    assert.equal(await win.webContents.executeJavaScript(`document.querySelector('[data-project-activity] progress').value`),31);
    await win.webContents.executeJavaScript('window.progressPlaybackElement=document.querySelector(".clip video")');
    job.workflow.clips['clip-1']['upload:youtube'].percent=64;job.workflow.clips['clip-1']['upload:youtube'].bytes=640000;
    await win.webContents.executeJavaScript('refresh()');
    assert.equal(await win.webContents.executeJavaScript(`document.querySelector('[data-project-activity] progress').value`),64);
    assert.equal(await win.webContents.executeJavaScript('window.progressPlaybackElement===document.querySelector(".clip video")'),true);
    await win.webContents.executeJavaScript("document.querySelector('[data-project-activity]').scrollIntoView({block:'center'})");
    await new Promise(resolve=>setTimeout(resolve,400));
    writeFileSync(join(root,'data/review-ui-verification/upload-progress.png'),(await win.webContents.capturePage()).toPNG());
    job.publishing=false;job.status='importing';job.canCancel=true;job.workflow.stages.import={state:'running',percent:42,message:'Downloading source'};
    await win.webContents.executeJavaScript('refresh()');
    assert.equal(await win.webContents.executeJavaScript(`document.querySelector('[data-cancel]').textContent`),'Cancel');
    await win.webContents.executeJavaScript(`document.querySelector('[data-cancel]').click();new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Cancel UI timeout')),3000);const timer=setInterval(()=>{if(document.querySelector('[data-retry]')?.textContent==='Retry project'){clearTimeout(timeout);clearInterval(timer);resolve();}},25);})`);
    assert.equal(await win.webContents.executeJavaScript(`document.querySelector('[data-delete]').disabled`),false);
    await win.webContents.executeJavaScript(`document.getElementById('tree-nav').click()`);
    assert.ok(await win.webContents.executeJavaScript(`document.getElementById('tree-canvas').textContent.includes('Cancelled')`));
    await new Promise(resolve=>setTimeout(resolve,200));writeFileSync(join(root,'data/review-ui-verification/cancelled-project.png'),(await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript(`document.getElementById('profile-button').click();new Promise((resolve,reject)=>{const stop=setTimeout(()=>reject(Error('Profile UI timeout')),3000);const timer=setInterval(()=>{if(document.querySelector('.quota-bucket progress')){clearTimeout(stop);clearInterval(timer);resolve();}},25);})`);
    assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.quota-bucket progress').value`),36);
    assert.ok(await win.webContents.executeJavaScript(`document.getElementById('profile-page').textContent.includes('creator@example.com')`));
    assert.ok(await win.webContents.executeJavaScript(`document.getElementById('profile-page').textContent.includes('Automatic account handoff is unavailable')`));
    await new Promise(resolve=>setTimeout(resolve,200));writeFileSync(join(root,'data/review-ui-verification/ai-profile.png'),(await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript(`document.getElementById('plugins-nav').click();new Promise((resolve,reject)=>{const stop=setTimeout(()=>reject(Error('Plugin restoration UI timeout')),3000);const timer=setInterval(()=>{if(!mcpLoading){clearTimeout(stop);clearInterval(timer);resolve()}},25)})`);
    assert.ok(await win.webContents.executeJavaScript(`document.getElementById('mcp-services').textContent.includes('Reconnecting')`));
    pluginState='connected';
    await win.webContents.executeJavaScript('loadMcp(true)');
    assert.ok(await win.webContents.executeJavaScript(`document.getElementById('mcp-services').textContent.includes('Connected')`));
    await win.webContents.executeJavaScript(`document.querySelector('[data-mcp-arg="project_id"]').value='keep-this-draft';loadMcp()`);
    assert.equal(await win.webContents.executeJavaScript(`document.querySelector('[data-mcp-arg="project_id"]').value`),'keep-this-draft');
    job.status='ready';job.publishing=false;job.clips.forEach(clip=>clip.publications={});job.workflow.clips={};
    await win.webContents.executeJavaScript(`document.getElementById('studio-nav').click();refresh()`);
    await win.webContents.executeJavaScript(`document.querySelector('[data-publish]').click();document.querySelector('[name=platform][value=youtube]').checked=true;document.getElementById('publish-consent').checked=true;document.getElementById('publish-form').requestSubmit()`);
    assert.equal(await win.webContents.executeJavaScript(`document.getElementById('upload-progress-dialog').open`),true);
    assert.equal(await win.webContents.executeJavaScript(`document.querySelector('#upload-progress-content .upload-overall progress').hasAttribute('value')`),false);
    await win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const stop=setTimeout(()=>reject(Error('Publishing progress UI timeout')),3000);const timer=setInterval(()=>{if(!uploadWatch.requestPending){clearTimeout(stop);clearInterval(timer);resolve()}},25)})`);
    assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.upload-progress-row progress').value`),37);
    job.workflow.clips['clip-1']['upload:youtube'].percent=68;await win.webContents.executeJavaScript('refresh()');
    assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.upload-progress-row progress').value`),68);
    writeFileSync(join(root,'data/review-ui-verification/publish-selected-progress.png'),(await win.webContents.capturePage()).toPNG());
    job.publishing=false;job.clips[0].publications.youtube={status:'uploaded'};job.clips[1].publications.youtube={status:'unknown',error:'Platform request failed (400): The user has exceeded the number of videos they may upload.'};job.clips[2].publications.youtube={status:'processing'};
    await win.webContents.executeJavaScript('refresh()');
    assert.ok(await win.webContents.executeJavaScript(`document.getElementById('upload-progress-content').textContent.includes('24 hours')`));
    assert.ok(await win.webContents.executeJavaScript(`document.getElementById('upload-progress-content').textContent.includes('2 of 3 uploads accepted')`));
    await new Promise(resolve=>setTimeout(resolve,200));
    writeFileSync(join(root,'data/review-ui-verification/publish-selected-failure.png'),(await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript(`document.getElementById('upload-progress-dialog').close();document.querySelector('[data-upload-progress]').click()`);
    assert.equal(await win.webContents.executeJavaScript(`document.getElementById('upload-progress-dialog').open`),true);
    assert.deepEqual(errors, []);
    console.log('PASS: Cancel controls, cancelled state, retry/delete availability, real upload progress, indeterminate AI progress, preserved playback, AI publishing fields, vertical tree, playable previews, mood tags/overrides, weird/sad/unexpected focus, automatic sound defaults, opt-in upload and browser-account exclusion.');
  } catch (error) { console.error(error); exitCode = 1; }
  finally { win?.destroy(); server.close(); app.exit(exitCode); }
});
