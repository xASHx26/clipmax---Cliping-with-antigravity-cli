// Runs in a hidden Electron window. It never controls the user's desktop.
const { app, BrowserWindow } = require('electron');
const { createServer } = require('node:http');
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { resolve, join } = require('node:path');
const assert = require('node:assert/strict');
const root = resolve('.');
const job = JSON.parse(readFileSync(join(root, 'data/progress-verification/completed-job.json')));
job.id = '11111111-1111-4111-8111-111111111111';
job.clips = Array.from({ length: 3 }, (_, index) => ({ ...job.clips[0], id: `clip-${index + 1}`, title: `Review clip ${index + 1}`, url: '/sample.mp4' }));
job.clips.forEach((clip,index)=>Object.assign(clip,{mood:['awkward','sad','surprised'][index],momentType:['weird','sad','out_of_pocket'][index],moodConfidence:.9,moodReason:'Suggested from this clip’s dialogue',audio:{effects:['record_stop','none','pop'][index],background:['playful','melancholy','playful'][index],normalized:true,decision:'Matched to the suggested mood'}}));
const accounts = [{ id: 'youtube-api', platform: 'youtube', name: 'Test channel', active: true, mode: 'api' }, { id: 'tiktok-browser', platform: 'tiktok', name: 'Browser creator', active: true, mode: 'browser' }];
const status = { accounts: { accounts, oauthReady: {} }, connections: { youtube: true, tiktok: true }, downloader: true };
let lastCreate,lastEdit;
const server = createServer(async (req, res) => {
  if (req.url === '/api/status') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(status)); }
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
    assert.equal(lastCreate.focus,'weird_sad_unexpected');assert.equal(lastCreate.media.effects,'auto');assert.equal(lastCreate.media.background,'auto');
    assert.equal(await win.webContents.executeJavaScript(`document.querySelector('[name=auto-platform][value=tiktok]').disabled`), true);
    await win.webContents.executeJavaScript(`document.getElementById('auto-upload').click();document.getElementById('source-url').value='https://youtu.be/review-test';document.getElementById('create-form').requestSubmit()`);
    await new Promise(resolve => setTimeout(resolve, 200)); assert.equal(lastCreate.autoUpload.enabled, false);
    await win.webContents.executeJavaScript(`document.querySelector('[data-edit]').click()`);
    assert.equal(await win.webContents.executeJavaScript(`document.getElementById('edit-mood').value`),'awkward');
    const invalid=await win.webContents.executeJavaScript(`[...document.querySelectorAll('#edit-form :invalid')].map(input=>({id:input.id,reason:input.validationMessage}))`);assert.deepEqual(invalid,[]);
    await win.webContents.executeJavaScript(`document.getElementById('edit-mood').value='sad';document.getElementById('edit-form').requestSubmit()`);
    await new Promise(resolve=>setTimeout(resolve,200));assert.equal(lastEdit.mood,'sad');
    assert.deepEqual(errors, []);
    console.log('PASS: Vertical tree, playable previews, mood tags/overrides, weird/sad/unexpected focus, automatic sound defaults, opt-in upload and browser-account exclusion.');
  } catch (error) { console.error(error); exitCode = 1; }
  finally { win?.destroy(); server.close(); app.exit(exitCode); }
});
