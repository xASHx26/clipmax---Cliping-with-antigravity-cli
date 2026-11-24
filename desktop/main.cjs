const { app, BrowserWindow, Menu, dialog, shell, safeStorage, ipcMain, clipboard } = require('electron');
const { PLATFORM_PAGES } = require('./browser-publishing.cjs');
const { fork, spawn } = require('node:child_process');
const aiUsage = require('../lib/ai-usage.cjs');
const { join } = require('node:path');
const { mkdirSync, existsSync, readFileSync, writeFileSync } = require('node:fs');
const { randomBytes } = require('node:crypto');
const net = require('node:net');
let win, backend, appUrl, configPath, dataPath;
const single = app.requestSingleInstanceLock();
if (!single) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
function availablePort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer(); socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); });
  });
}
async function start() {
  const home = app.getPath('userData'); mkdirSync(home, { recursive: true });
  dataPath = join(home, 'projects'); configPath = join(home, '.env');
  const resource = app.isPackaged ? process.resourcesPath : join(__dirname, '..');
  const legacyConfig = existsSync(configPath) ? require('node:util').parseEnv(readFileSync(configPath, 'utf8')) : {};
  const env = { ...process.env, ...legacyConfig };
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows credential encryption is unavailable. Unlock your Windows session and try again.');
  const vaultKeyPath = join(home, 'credentials.key');
  let vaultKey;
  if (existsSync(vaultKeyPath)) vaultKey = safeStorage.decryptString(readFileSync(vaultKeyPath));
  else { vaultKey = randomBytes(32).toString('base64'); writeFileSync(vaultKeyPath, safeStorage.encryptString(vaultKey)); }
  const port = await availablePort(); appUrl = `http://127.0.0.1:${port}`;
  Object.assign(env, { PORT: String(port), CLIPMAX_DATA_DIR: dataPath, CLIPMAX_SETTINGS_DIR: home, CLIPMAX_VAULT_KEY: vaultKey, ELECTRON_RUN_AS_NODE: '1' });
  if (app.isPackaged) {
    env.FACE_MODEL_DIR = join(resource, 'bin', 'face');
    env.FFMPEG_PATH = join(resource, 'bin', 'ffmpeg.exe');
    env.YTDLP_PATH = join(resource, 'bin', 'yt-dlp.exe');
    env.WHISPER_PATH = join(resource, 'bin', 'whisper', 'Release', 'whisper-cli.exe');
    env.WHISPER_MODEL_PATH = join(resource, 'bin', 'whisper', 'ggml-base-q5_1.bin');
  }
  backend = fork(join(__dirname, '..', 'server.mjs'), [], { execPath: process.execPath, env, silent: true, windowsHide: true, cwd: home });
  let ready;
  const loaded = new Promise((resolve, reject) => { ready = resolve; backend.once('error', reject); backend.once('exit', code => reject(new Error(`Video engine stopped (${code}). Check your configuration.`))); });
  backend.stdout.on('data', chunk => { if (chunk.toString().includes('Clipmax Studio:')) ready(); });
  backend.stderr.on('data', () => {});
  let timer;
  try { await Promise.race([loaded, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Video engine did not start within 30 seconds.')), 30000); })]); }
  finally { clearTimeout(timer); }
  win = new BrowserWindow({ width: 1460, height: 980, minWidth: 800, minHeight: 640, title: 'Clipmax Studio', backgroundColor: '#f7f8fa', show: true, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: join(__dirname, 'preload.cjs'), devTools: !app.isPackaged } });
  ipcMain.handle('open-auth', async (event, value) => {
    if (event.sender !== win.webContents || event.senderFrame.url.split('/').slice(0, 3).join('/') !== appUrl) throw new Error('Untrusted sign-in request.');
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || !(['accounts.google.com', 'www.tiktok.com', 'app.upload-post.com', 'www.upload-post.com'].includes(url.hostname) || ['descript.com', 'vidiq.com'].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`)))) throw new Error('Unsupported sign-in address.');
    await shell.openExternal(url.href);
  });
  const trustedRenderer = event => event.sender === win.webContents && new URL(event.senderFrame.url).origin === appUrl;
  ipcMain.handle('antigravity-usage', async event => {
    if(!trustedRenderer(event))throw new Error('Untrusted usage request.');
    const dir=join(home,'ai-usage');mkdirSync(dir,{recursive:true});
    const settings=aiUsage.captureSettings(dir);if(!settings)throw new Error('This installation path cannot be used for the usage helper.');
    const config=join(dir,'session-settings.json'),script=join(dir,'open-usage.ps1');
    writeFileSync(config,JSON.stringify(settings));writeFileSync(script,readFileSync(join(__dirname,'antigravity-usage.ps1')));
    const terminal=spawn('powershell.exe',['-NoLogo','-NoProfile','-NoExit','-File',script,'-SettingsFile',config,'-AgyPath',env.AGY_PATH||'agy'],{detached:true,stdio:'ignore',windowsHide:false});
    await new Promise((resolve,reject)=>{terminal.once('spawn',resolve);terminal.once('error',reject);});terminal.unref();return {opened:true};
  });
  ipcMain.handle('browser-sign-in', async (event, platform) => {
    if (!trustedRenderer(event) || !PLATFORM_PAGES[platform]) throw new Error('Invalid browser sign-in request.');
    await shell.openExternal(PLATFORM_PAGES[platform].signIn);
  });
  ipcMain.handle('browser-publish', async (event, input) => {
    if (!trustedRenderer(event) || !PLATFORM_PAGES[input?.platform] || !/^[a-f0-9-]{36}$/.test(input.jobId) || !/^clip-[1-6]$/.test(input.clipId)) throw new Error('Invalid browser publishing request.');
    const jobs = await (await fetch(`${appUrl}/api/jobs`)).json();
    const job = jobs.find(j => j.id === input.jobId && j.status === 'ready');
    const clip = job?.clips.find(c => c.id === input.clipId);
    const file = join(dataPath, input.jobId, `${input.clipId}.mp4`);
    if (!clip || !existsSync(file)) throw new Error('Export this clip before opening the browser upload.');
    clipboard.writeText(`${clip.title}\n\n${clip.description ?? clip.caption}`);
    shell.showItemInFolder(file);
    await shell.openExternal(PLATFORM_PAGES[input.platform].upload);
    return { status: 'awaiting_browser', fileName: `${input.clipId}.mp4` };
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\/((www\.)?youtube\.com|blog\.youtube|corporate\.wwe\.com)\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(`${appUrl}/`)) event.preventDefault(); });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; app.quit(); });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Clipmax', submenu: [
      { label: 'Add social connection…', click: () => win.webContents.send('show-connections') },
      { label: 'Open projects folder', click: () => { mkdirSync(dataPath, { recursive: true }); shell.openPath(dataPath); } },
      { type: 'separator' }, { role: 'quit' }
    ] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    { label: 'Help', submenu: [{ label: 'About Clipmax Studio', click: () => dialog.showMessageBox(win, { type: 'info', title: 'Clipmax Studio', message: `Clipmax Studio ${app.getVersion()}`, detail: 'AI clips powered by your Antigravity CLI account.\nAdd social accounts in Connections. No configuration file needed.\nProjects stay on this computer.' }) }] }
  ]));
  await win.loadURL(appUrl);
  win.show();
}
app.whenReady().then(() => { if (single) return start(); }).catch(error => { dialog.showErrorBox('Clipmax could not start', error.message); app.quit(); });
app.on('before-quit', () => { if (backend) { backend.kill(); backend = null; } });
app.on('window-all-closed', () => app.quit());
