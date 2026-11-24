import http from 'node:http';
import aiUsage from './lib/ai-usage.cjs';
import { withCancellation, taskSignal, throwIfCancelled, cancellationError } from './lib/cancellation.mjs';
import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, writeFile, rename, readdir, stat, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSource, importWindow, run, parseVtt, validateClips, clipSrt, renderArgs } from './lib/core.mjs';
import { analyze } from './lib/ai.mjs';
import { generateMetadata, cleanStreamerName, streamerNameFor, creditStreamer } from './lib/metadata.mjs';
import { publish, platforms, connectionStatus, rejectedPublication } from './lib/publish.mjs';
import { Connections } from './lib/connections.mjs';
import { transcribe } from './lib/transcribe.mjs';
import { AppMcp } from './lib/mcp.mjs';
import { updateStage, mediaProgress, downloadProgress } from './lib/progress.mjs';
import { projectBusy, restoreProject, deleteProjectPermanently, DeletionConfirmations } from './lib/project-trash.mjs';
import { autoUploadSettings, maybeAutoUpload, publishOptions } from './lib/auto-publish.mjs';
import { mediaSettings, probeSource, prepareAudio, hookWave } from './lib/audio.mjs';
import { detectFraming } from './lib/framing.mjs';
import { completeClipEnd } from './lib/context.mjs';
import { FOCUSES, MOODS, MOMENTS, groundMood, resolveSound, planBatchSound, soundSeed } from './lib/mood.mjs';
import { effectWave, backgroundWave, EFFECT_LENGTHS, BACKGROUNDS } from './lib/sounds.mjs';
import { clipAss } from './lib/captions.mjs';
import { ManagedPublishing, managedStatus } from './lib/managed-publishing.mjs';
import { PLATFORM_NAMES } from './lib/social-platforms.mjs';

const root = fileURLToPath(new URL('.', import.meta.url)), dataDir = process.env.CLIPMAX_DATA_DIR || join(root, 'data');
const port = Number(process.env.PORT || 4310);
const bindHost = process.env.CLIPMAX_BIND_HOST || '127.0.0.1';
if (!['127.0.0.1', '0.0.0.0'].includes(bindHost)) throw new Error('CLIPMAX_BIND_HOST must be 127.0.0.1 or 0.0.0.0.');
const jobs = new Map();
await mkdir(dataDir, { recursive: true });
const connections = new Connections(process.env.CLIPMAX_SETTINGS_DIR || dataDir, process.env.CLIPMAX_VAULT_KEY);
await connections.load();
const managed = new ManagedPublishing(connections);
const mcp = new AppMcp(connections, `http://127.0.0.1:${port}`);
for (const name of await readdir(dataDir)) {
  if (!/^[a-f0-9-]{36}$/.test(name)) continue;
  try {
    const job = JSON.parse(await readFile(join(dataDir, name, 'job.json'), 'utf8'));
    let changed = false;
    if (['queued', 'importing', 'transcribing', 'analyzing', 'rendering'].includes(job.status)) {
      job.status = 'failed'; job.error = 'Processing stopped when the app closed. Retry this project to continue.'; changed = true;
      for (const stage of [...Object.values(job.workflow?.stages || {}), ...Object.values(job.workflow?.clips || {}).flatMap(c => Object.values(c))]) if (stage.state === 'running') stage.state = 'failed';
    }
    for (const clip of job.clips || []) for (const p of Object.values(clip.publications || {})) if (p.status === 'uploading') { p.status = 'unknown'; p.error = 'Interrupted. Check the platform before retrying to avoid duplicate posts.'; changed = true; }
    for (const entry of [...Object.values(job.workflow?.stages || {}), ...Object.values(job.workflow?.clips || {}).flatMap(c => Object.values(c))]) if (entry.state === 'running') { entry.state = 'failed'; entry.message = 'Interrupted · retry or check the platform'; changed = true; }
    if (job.canCancel || job.cancelling) changed = true;
    job.canCancel = false; job.cancelling = false;
    job.publishing = false; job.editing = false;
    if (job.autoUpload?.enabled && ['checking', 'uploading', 'pending'].includes(job.autoUpload.state)) {
      job.autoUpload.state = 'blocked'; job.autoUpload.message = 'App restarted. Review your clips and check the platforms before publishing manually.'; changed = true;
    }
    jobs.set(job.id, job);
    if (changed) await writeFile(join(dataDir, name, 'job.json'), JSON.stringify(job, null, 2));
  } catch { /* Ignore incomplete non-project directories. */ }
}
const writes = new Map(), progressSaves = new WeakMap();
function save(job) {
  const file = join(dataDir, job.id, 'job.json');
  const snapshot = JSON.stringify(job, null, 2);
  const pending = (writes.get(job.id) || Promise.resolve()).catch(() => {}).then(async () => { await writeFile(`${file}.tmp`, snapshot); await rename(`${file}.tmp`, file); });
  writes.set(job.id, pending); return pending;
}
function progress(job, key, patch, clipId) {
  if (taskSignal()?.aborted) return;
  updateStage(job, key, patch, clipId);
  if (Date.now() - (progressSaves.get(job) || 0) >= 750) { progressSaves.set(job, Date.now()); save(job).catch(console.error); }
}
async function stage(job, key, patch, clipId) {
  throwIfCancelled();
  updateStage(job, key, patch, clipId); await save(job);
}
let ffmpeg = process.env.FFMPEG_PATH;
if (!ffmpeg) { try { ffmpeg = (await import('ffmpeg-static')).default; } catch { ffmpeg = 'ffmpeg'; } }
const ytdlp = process.env.YTDLP_PATH || join(root, 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const whisper = process.env.WHISPER_PATH || join(root, 'bin', 'whisper', 'Release', 'whisper-cli.exe');
const speechModel = process.env.WHISPER_MODEL_PATH || join(root, 'bin', 'whisper', 'ggml-base-q5_1.bin');
let queue = Promise.resolve();
const tasks = new Map();
function beginTask(job, kind = 'pipeline') {
  if (tasks.has(job.id)) throw new Error('This project already has an active task.');
  const entry = { controller: new AbortController(), started: false, kind };
  tasks.set(job.id, entry); job.canCancel = true; job.cancelling = false;
  return entry;
}
async function pauseForQuota(job,error) {
  job.status='paused';job.pauseReason=sanitize(error.message);job.resumeStage='analysis';delete job.error;
  updateStage(job,'analysis',{state:'waiting',percent:null,message:'Waiting for AI quota · source and captions saved'});
  if(job.autoUpload?.enabled){job.autoUpload.state='blocked';job.autoUpload.message='AI paused before upload. Review and publish manually after resuming.';}
  await save(job);
}
async function cancelledJob(job, kind) {
  if (kind === 'pipeline') {
    job.status = 'cancelled'; job.cancelledAt = new Date().toISOString(); delete job.error;
    job.notice = 'Cancelled. Imported video and completed exports are kept. Retry or delete this project.';
    if (job.autoUpload?.enabled) { job.autoUpload.state = 'blocked'; job.autoUpload.message = 'Project cancelled. Nothing else will upload automatically.'; }
  }
  for (const entry of [...Object.values(job.workflow?.stages || {}), ...Object.values(job.workflow?.clips || {}).flatMap(c=>Object.values(c))]) {
    if (['running','pending'].includes(entry.state)) { entry.state='cancelled';entry.message='Cancelled by you';entry.updatedAt=Date.now(); }
  }
}
async function runTask(job, action, entry = beginTask(job)) {
  if (entry.controller.signal.aborted) return;
  entry.started = true;
  try { return await withCancellation(entry.controller.signal, async()=>{ throwIfCancelled(); const result=await action(); throwIfCancelled(); return result; }); }
  catch (error) { if (entry.controller.signal.aborted) { await cancelledJob(job, entry.kind); throw entry.controller.signal.reason; } throw error; }
  finally { if (tasks.get(job.id) === entry) { tasks.delete(job.id);job.canCancel=false;job.cancelling=false;if(jobs.has(job.id))await save(job); } }
}
function scheduleProject(job, action) {
  const entry=beginTask(job);
  queue=queue.then(()=>runTask(job,action,entry)).catch(error=>{if(error.code!=='PROJECT_CANCELLED')console.error(error);});
}
let supportsSubtitles;
async function canBurn() {
  if (supportsSubtitles === undefined) supportsSubtitles = (await run(ffmpeg, ['-filters'])).includes(' subtitles ');
  return supportsSubtitles;
}
function editingPercent(job) {
  const seconds = job.clips.reduce((sum, clip) => sum + (job.workflow?.clips?.[clip.id]?.editing?.state === 'done' ? clip.end - clip.start : Math.min(clip.end - clip.start, job.workflow?.clips?.[clip.id]?.editing?.mediaSeconds || 0)), 0);
  const total = job.clips.reduce((sum, clip) => sum + clip.end - clip.start, 0);
  return total ? seconds / total * 100 : 0;
}
async function render(job, clip) {
  const dir = join(dataDir, job.id), source = join(dir, 'source.mp4');
  const rawSettings=mediaSettings(clip.media || job.media);
  if(!rawSettings.soundSeed)rawSettings.soundSeed=clip.soundPlan?.soundSeed||soundSeed(`${job.id}:${clip.id}:${clip.start}`);
  const settings=resolveSound(rawSettings,clip);
  if(rawSettings.effects==='auto' && clip.soundPlan){settings.effects=clip.soundPlan.effects;settings.effectAt=clip.soundPlan.effectAt;settings.soundReason=clip.soundPlan.soundReason;}
  if(rawSettings.background==='auto' && clip.soundPlan)settings.background=clip.soundPlan.background;
  job.mediaInfo ||= await probeSource(ffmpeg, source);
  await stage(job, 'audio', { state: 'running', percent: 0, message: 'Preparing speech and background audio' }, clip.id);
  await stage(job, 'audio', { state: 'running', percent: null, message: `Mixing audio for ${clip.id}` });
  const mixed = await prepareAudio({ ffmpeg, source, dir, clip, settings, hasAudio: job.mediaInfo.hasAudio, customMusic: job.customMusic ? join(dir,'background-audio') : null, customEffect:job.customEffect?join(dir,'effect-audio'):null, onProgress: value => {
    progress(job,'audio',{ ...value,state:'running' },clip.id);
    progress(job,'audio',{ state:'running',percent:null,message:`${clip.id}: ${value.message}` });
  } });
  clip.audio = { ...mixed, file: undefined, normalized: settings.normalize };
  await stage(job, 'audio', { state: 'done', message: 'Speech, background and effects mixed' }, clip.id);
  const allAudioDone = job.clips.every(c => c.id === clip.id || job.workflow.clips[c.id]?.audio?.state === 'done');
  if (allAudioDone) await stage(job,'audio',{state:'done',message:'All clip audio mixed'});
  await stage(job, 'editing', { state: 'running', percent: 0, mediaSeconds: 0, mediaTotal: clip.end - clip.start, message: job.captions ? 'Reframing and applying captions' : 'Reframing and encoding' }, clip.id);
  await stage(job, 'editing', { state: 'running', percent: editingPercent(job), message: 'Editing clip exports' });
  const cues = JSON.parse(await readFile(join(dir, 'cues.json'), 'utf8'));
  const srt = clipSrt(cues, clip.start, clip.end);
  await writeFile(join(dir, `${clip.id}.srt`), srt);
  const ass = clipAss(cues, clip.start, clip.end, { aspect: job.aspect, style: settings.captionStyle });
  await writeFile(join(dir, `${clip.id}.ass`), ass);
  clip.burnedCaptions = Boolean(job.captions && srt && await canBurn());
  if (job.captions && !clip.burnedCaptions) job.notice = srt ? 'This FFmpeg build cannot burn captions. Download the included SRT file.' : 'Source has no captions. Clips export without subtitles.';
  const framing = { mode: settings.framing === 'auto' ? clip.framing?.mode || 'preserve' : settings.framing, webcam: settings.webcam || clip.framing?.webcam, contentWidth:settings.contentWidth };
  clip.captionStyle = settings.captionStyle;
  clip.captionTiming = cues.some(cue => cue.words?.length) ? 'word timestamps where available' : 'estimated from caption segments';
  await run(ffmpeg, renderArgs(source, clip, { aspect: job.aspect, captions: job.captions, subtitleFilter: clip.burnedCaptions, animatedCaptions: Boolean(ass), framing, audioFile: mixed.file }), { cwd: dir, onLine: mediaProgress(clip.end - clip.start, value => {
    progress(job, 'editing', { ...value, state: 'running', message: clip.burnedCaptions ? 'Encoding video with captions' : 'Encoding video' }, clip.id);
    progress(job, 'editing', { state: 'running', percent: editingPercent(job), message: 'Editing and exporting clips' });
  }) });
  clip.url = `/media/${job.id}/${clip.id}.mp4`;
  clip.subtitles = srt ? `/media/${job.id}/${clip.id}.srt` : null;
  await stage(job, 'editing', { state: 'done', message: clip.burnedCaptions ? 'MP4 and captions ready' : 'MP4 ready' }, clip.id);
  if (job.status === 'ready' && job.clips.every(item => job.workflow.clips[item.id]?.editing?.state === 'done')) await stage(job, 'editing', { state: 'done', message: 'All clips exported' });
}
async function processJob(job) {
  const dir = join(dataDir, job.id);
  try {
    job.status = 'importing'; await stage(job, 'import', { state: 'running', percent: null, message: 'Checking source video' });
    const basic = ['--no-playlist', '--no-progress', '--socket-timeout', '30', '--retries', '2'];
    const info = JSON.parse(await run(ytdlp, [...basic, '--skip-download', '--dump-single-json', '--', job.url], { cwd: dir }));
    if (info.is_live) throw new Error('Use a completed Twitch VOD or recorded video; live streams are not supported.');
    job.sourceCreator = { name: cleanStreamerName(info.uploader || info.channel), handle: cleanStreamerName(info.uploader_id || info.channel_id) };
    job.title = String(info.title || 'Untitled video'); job.sourceDuration = Number(info.duration);
    const window = importWindow(job.sourceDuration, job.scanStart || 0, job.scanMinutes || 30);
    job.duration = window.duration;
    const languages = ['en.*', 'bn.*', info.language ? `${info.language.split('-')[0]}.*` : 'en'].join(',');
    if (Object.keys(info.subtitles || {}).length || Object.keys(info.automatic_captions || {}).length) {
      await run(ytdlp, [...basic, '--skip-download', '--write-subs', '--write-auto-subs', '--sub-langs', languages, '--sub-format', 'vtt', '-o', 'source.%(ext)s', '--', job.url], { cwd: dir });
    }
    const subtitles = (await readdir(dir)).filter(x => x.endsWith('.vtt'));
    const original = info.language?.split('-')[0];
    const chosen = subtitles.find(x => original && x.startsWith(`source.${original}.`)) || subtitles.find(x => x.includes('.en.')) || subtitles[0];
    let cues = chosen ? parseVtt(await readFile(join(dir, chosen), 'utf8')).filter(c => c.end > window.start && c.start < window.end).map(c => ({ ...c, start: Math.max(0, c.start - window.start), end: Math.min(window.duration, c.end - window.start) })) : [];
    const config = connections.config();
    if (job.provider === 'gemini' && !config.GEMINI_API_KEY) throw new Error('Open AI settings and add a Gemini API key, or use Antigravity with a captioned video.');
    let cached = false;
    if (job.importedSource?.url === job.url && job.importedSource.start === window.start && job.importedSource.end === window.end) {
      try { const media=await probeSource(ffmpeg,join(dir,'source.mp4')); cached = Math.abs(media.duration-job.duration)<3; if(cached)job.mediaInfo=media; } catch {}
    }
    if (!cached) {
      await stage(job, 'import', { state: 'running', percent: null, message: 'Downloading selected section' });
      await run(ytdlp, [...basic, '--progress', '--newline', '--progress-delta', '1', '--progress-template', 'download:CLIPMAX_DOWNLOAD:%(progress.downloaded_bytes)s:%(progress.total_bytes)s:%(progress.total_bytes_estimate)s:%(progress.eta)s:%(progress.speed)s', '--force-overwrites', '--max-filesize', '8G', '--ffmpeg-location', ffmpeg, '-f', 'bv*[height<=720]+ba/b[height<=720]', '--download-sections', `*${window.start}-${window.end}`, ...(window.start>0?['--force-keyframes-at-cuts']:[]), '--merge-output-format', 'mp4', '--remux-video', 'mp4', '-o', 'source.%(ext)s', '--', job.url], { cwd: dir, timeout: Math.max(900000,job.duration*1500+120000), onLine: downloadProgress(job.duration, value => progress(job, 'import', { ...value, state: 'running', message: value.mediaSeconds !== undefined ? 'Importing video section' : 'Downloading video stream' })) });
      job.importedSource = { url: job.url, start: window.start, end: window.end };
    }
    await stage(job, 'import', { state: 'done', message: cached ? 'Reusing previously imported video' : 'Video imported' });
    if (!cues.length) {
      job.status = 'transcribing'; job.notice = 'Generating AI captions from speech locally. No Gemini API key is needed.';
      await stage(job, 'captions', { state: 'running', percent: null, message: 'Starting local speech recognition' });
      const speech = await transcribe({ source: join(dir, 'source.mp4'), dir, duration: job.duration, ffmpeg, whisper, model: speechModel, onProgress: value => progress(job, 'captions', { ...value, state: 'running' }) });
      cues = speech.cues; job.captionSource = 'ai'; job.speechLanguage = speech.language;
      job.notice = 'AI-generated captions are included. Review names and timing before publishing.';
    } else job.captionSource = 'source';
    await writeFile(join(dir, 'cues.json'), JSON.stringify(cues));
    await stage(job, 'captions', { state: 'done', message: `${cues.length} timed captions ready` });
    await finishJob(job, dir, cues, config);
  } catch (e) {
    throwIfCancelled();
    if(e.code==='AI_QUOTA_PAUSED'){await pauseForQuota(job,e);return;}
    job.status = 'failed'; job.error = sanitize(e.message);
    for (const entry of [...Object.values(job.workflow?.stages || {}), ...Object.values(job.workflow?.clips || {}).flatMap(c => Object.values(c))]) if (entry.state === 'running') { entry.state = 'failed'; entry.message = 'Stopped · see error below'; }
    await save(job);
  }
}
async function finishJob(job, dir, cues, config) {
    for(const key of ['framing','audio','editing'])updateStage(job,key,{state:'pending',percent:0,message:'Waiting for the new clip plan'});
    job.status = 'analyzing'; await stage(job, 'analysis', { state: 'running', percent: null, message: 'AI is selecting moments' });
    job.clips = validateClips(await analyze({ job, dir, cues, ffmpeg, source: join(dir, 'source.mp4'), config, onProgress: value => progress(job, 'analysis', { ...value, state: 'running' }) }), job.duration, job.count, job.maxSeconds);
    for (const clip of job.clips) {
      if (!clip.description || !clip.tags.length) throw new Error('AI returned incomplete publication details. Retry this project.');
      Object.assign(clip, creditStreamer(clip, job));
      clip.publicationMetadata = { streamerName: streamerNameFor(job), provider: job.provider === 'antigravity' ? 'Gemini CLI via Antigravity' : 'Gemini API', generatedAt: new Date().toISOString() };
    }
    job.clips = job.clips.map(clip => completeClipEnd(clip,cues,job.duration,job.maxSeconds));
    job.clips=planBatchSound(job.clips.map(clip=>groundMood(clip,cues)),mediaSettings(job.media),job.id);
    job.workflow.clips={};
    await stage(job, 'analysis', { state: 'done', message: `${job.clips.length} clips selected` });
    await stage(job,'framing',{state:'running',percent:null,message:'Finding streamer-safe layouts'});
    if (mediaSettings(job.media).framing === 'auto') {
      try {
        const layouts = await detectFraming({job,dir,source:join(dir,'source.mp4'),ffmpeg,onProgress:value=>progress(job,'framing',{...value,state:'running'})});
        for (const clip of job.clips) clip.framing = layouts[clip.id];
      } catch (error) { throwIfCancelled(); job.framingNotice = 'Full source preserved. Automatic webcam detection was unavailable; adjust the webcam region in Edit clip.'; }
    }
    await stage(job,'framing',{state:'done',message:'Streamer-safe layouts ready; full-source fallback enabled'});
    job.status = 'rendering'; await stage(job, 'editing', { state: 'running', percent: 0, message: 'Preparing clip exports' });
    for (const clip of job.clips) updateStage(job, 'editing', { state: 'pending', percent: 0, message: 'Waiting to encode' }, clip.id);
    for (const clip of job.clips) {
      await render(job, clip);
      await stage(job, 'editing', { state: 'running', percent: editingPercent(job), message: `${job.clips.filter(c => c.url).length}/${job.clips.length} clips exported` });
    }
    await stage(job, 'editing', { state: 'done', message: 'All clips exported' });
    job.status = 'ready'; await save(job);
    throwIfCancelled();
    await maybeAutoUpload(job, { accounts: connections.summary().accounts, save, start: (clips, targets, options) => startPublishing(job, clips, targets, options, true) });
}
async function startPublishing(job, clips, targets, options, automatic = false) {
  if (job.status !== 'ready' || job.publishing || job.editing) throw new Error('Wait until this project is ready.');
  job.publishing = true;
  let publishConfig;
  try {
    const missing = clips.filter(clip => !clip.publicationMetadata || !clip.description || !clip.tags?.length || clip.publicationMetadata.streamerName !== streamerNameFor(job));
    if (missing.length) {
      await stage(job, 'metadata', { state: 'running', percent: null, message: 'Gemini CLI is writing publishing details before upload' });
      try {
        const dir = join(dataDir, job.id), cues = JSON.parse(await readFile(join(dir, 'cues.json'), 'utf8'));
        const details = await generateMetadata({ job, clips: missing, cues, dir });
        for (const value of details) Object.assign(missing.find(c => c.id === value.id), value);
        await stage(job, 'metadata', { state: 'done', message: 'AI publishing details ready' });
      } catch (error) { await stage(job, 'metadata', { state: error.code==='AI_QUOTA_PAUSED'?'waiting':'failed', message: 'Publishing paused: AI details could not be generated' }); throw error; }
    }
    await managed.verify(targets,options);
    publishConfig = await connections.readyConfig(targets);
    if (automatic && targets.some(platform => !connections.summary().accounts.some(account => account.id === job.autoUpload.accountIds[platform] && account.platform === platform && account.active && account.mode !== 'browser'))) throw new Error('An auto-upload account changed. Review your clips and publish manually.');
    if (targets.some(p => !connectionStatus(publishConfig)[p])) throw new Error('Add a verified automatic connection for every selected platform. Instagram Login mode also needs a public media URL; Facebook Login mode supports direct file upload.');
    if (automatic) job.autoUpload.state = 'uploading';
    for (const clip of clips) for (const platform of targets) {
      if(rejectedPublication(clip.publications[platform]))delete clip.publications[platform];
      if (!clip.publications[platform]) updateStage(job, `upload:${platform}`, { state: 'pending', percent: null, bytes:0, totalBytes:null, message: 'Waiting for upload slot' }, clip.id);
    }
    await save(job);
  } catch (error) { job.publishing = false; await save(job); throw error; }
  (async () => {
    try {
      for (const clip of clips) for (const platform of targets) {
        if (clip.publications[platform]) continue;
        clip.publications[platform] = { status: 'uploading', at: new Date().toISOString() };
        await stage(job, `upload:${platform}`, { state: 'running', percent: null, message: 'Connecting to platform' }, clip.id);
        try {
          clip.publications[platform] = { ...await publish(platform, job, clip, join(dataDir, job.id, `${clip.id}.mp4`), options, publishConfig, value => progress(job, `upload:${platform}`, { ...value, state: 'running' }, clip.id)), at: new Date().toISOString() };
          const result=clip.publications[platform];
          await stage(job, `upload:${platform}`, { state: result.status==='failed'?'failed':result.status==='action_required'?'waiting':'done', message: result.status==='failed'?result.error:result.status==='action_required'?'Finish posting on the platform':result.status==='published'?'Published':'Upload accepted · platform may still process' }, clip.id);
        } catch (error) {
          clip.publications[platform] = { status: error.uploadRejected?'failed':'unknown', error: sanitize(error.message), ...(error.reason?{reason:error.reason}:{}), at: new Date().toISOString() };
          await stage(job, `upload:${platform}`, { state: 'failed', message: error.uploadRejected?'Platform rejected upload':'Outcome unknown · check platform' }, clip.id);
        }
        await save(job);
      }
    } finally {
      job.publishing = false;
      if (automatic) {
        const attention = clips.some(c => targets.some(p => !['uploaded', 'processing', 'published'].includes(c.publications[p]?.status)));
        job.autoUpload.state = attention ? 'attention' : 'complete';
        job.autoUpload.message = attention ? 'Check the upload results before posting again.' : 'Uploads accepted. Platforms may still be processing.';
      }
      await save(job);
    }
  })().catch(console.error);
}
function sanitize(message) {
  let result = String(message);
  for (const [key, value] of Object.entries(process.env)) if (/TOKEN|SECRET|KEY/.test(key) && value && value.length > 5) result = result.replaceAll(value, '[redacted]');
  for (const [key, value] of Object.entries(connections.config())) if (/TOKEN|SECRET|KEY/.test(key) && value && value.length > 5) result = result.replaceAll(value, '[redacted]');
  return result.slice(-2000);
}
function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
async function body(req) {
  let data = '';
  for await (const chunk of req) { data += chunk; if (data.length > 32000) throw new Error('Request is too large.'); }
  return JSON.parse(data || '{}');
}
function getJob(id) { const job = jobs.get(id); if (!job || job.deleting) throw new Error('Project not found.'); return job; }
async function serveFile(req, res, file) {
  const size = (await stat(file)).size;
  const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mp4': 'video/mp4', '.srt': 'application/x-subrip' }[extname(file)] || 'application/octet-stream';
  const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
  const headers = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
  if (range) {
    const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || end < start) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return; }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
  } else { res.writeHead(200, { ...headers, 'Content-Length': size }); createReadStream(file).on('error', () => res.destroy()).pipe(res); }
}
const deletionConfirmations=new DeletionConfirmations();
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(req.headers.host)) return json(res, 403, { error: 'Use the local app address.' });
    if (req.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin)) return json(res, 403, { error: 'Cross-origin requests are blocked.' });
    const path = new URL(req.url, `http://127.0.0.1:${port}`).pathname;
    if (req.method === 'GET' && path === '/healthz') return json(res, 200, { status: 'ok' });
    const preview=path.match(/^\/api\/audio-preview\/(?:background\/([a-z_]+)|([a-z_]+))$/);
    if(req.method==='GET' && preview){if(preview[1]?!BACKGROUNDS.includes(preview[1]):!EFFECT_LENGTHS[preview[2]]&&preview[2]!=='fahh')return json(res,404,{error:'Unknown sound.'});const seed=Number(new URL(req.url,`http://127.0.0.1:${port}`).searchParams.get('seed'))>>>0;const demo=preview[1]?backgroundWave(preview[1],seed):effectWave(preview[2]);res.writeHead(200,{'Content-Type':'audio/wav','Content-Length':demo.length});res.end(demo);return;}
    const audioUpload = path.match(/^\/api\/jobs\/([a-f0-9-]{36})\/audio(?:\/(effect))?$/);
    if (req.method !== 'GET' && req.headers['content-type'] !== 'application/json' && !(req.method === 'POST' && audioUpload && req.headers['content-type'] === 'application/octet-stream')) return json(res, 415, { error: 'Expected application/json.' });
    if (req.method === 'POST' && audioUpload) {
      const job = getJob(audioUpload[1]);
      if (job.status !== 'ready' || job.publishing || job.editing) throw new Error('Wait until this project is ready.');
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 24 * 1024 * 1024) throw new Error('Background audio must be under 24 MB.'); chunks.push(chunk); }
      const isEffect=Boolean(audioUpload[2]),temporary = join(dataDir,job.id,isEffect?'effect-upload.tmp':'background-upload.tmp');
      await writeFile(temporary,Buffer.concat(chunks));
      try {
        const info = await probeSource(ffmpeg,temporary);
        if (!info.hasAudio) throw new Error('Choose a supported audio file.');
        if(isEffect && (!info.duration || info.duration>3))throw new Error('Use a hook sound effect up to 3 seconds long.');
        await rename(temporary,join(dataDir,job.id,isEffect?'effect-audio':'background-audio'));
        if(isEffect)job.customEffect=true;else job.customMusic=true;
        await save(job);
      } catch(error) { await unlink(temporary).catch(()=>{}); throw error; }
      return json(res,200,{uploaded:true});
    }
    if (req.method === 'GET' && path === '/api/mcp') return json(res, 200, mcp.summary());
    const mcpAction = path.match(/^\/api\/mcp\/(descript|vidiq)\/(connect|status|tools|call|disconnect)$/);
    if (mcpAction) {
      const [, id, action] = mcpAction;
      if (req.method === 'POST' && action === 'connect') return json(res, 200, await mcp.connect(id));
      if (req.method === 'GET' && action === 'status') return json(res, 200, mcp.status(id));
      if (req.method === 'GET' && action === 'tools') return json(res, 200, await mcp.tools(id));
      if (req.method === 'POST' && action === 'call') return json(res, 200, await mcp.call(id, await body(req)));
      if (req.method === 'POST' && action === 'disconnect') { await mcp.disconnect(id); return json(res, 200, { disconnected: true }); }
    }
    const mcpCallback = path.match(/^\/oauth\/mcp\/(descript|vidiq)$/);
    if (req.method === 'GET' && mcpCallback) {
      try { await mcp.callback(mcpCallback[1], new URL(req.url, `http://127.0.0.1:${port}`).searchParams); }
      catch { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', 'Referrer-Policy': 'no-referrer' }); res.end('MCP sign-in did not complete. Return to Clipmax and connect again.'); return; }
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Referrer-Policy': 'no-referrer' }); res.end('MCP service connected directly to Clipmax. Return to the app to use its editing tools.'); return;
    }
    if (req.method === 'GET' && path === '/api/ai/profile') return json(res,200,await aiUsage.readUsageStore(join(process.env.CLIPMAX_SETTINGS_DIR || dataDir,'ai-usage')));
    if (req.method === 'GET' && path === '/api/status') {
      let downloader = true; try { await access(ytdlp); } catch { downloader = Boolean(process.env.YTDLP_PATH); }
      const connected = connectionStatus(connections.config());
      for (const account of connections.summary().accounts) if (account.active && account.mode === 'browser') connected[account.platform] = true;
      return json(res, 200, { connections: connected, accounts: connections.summary(), publisher:managed.summary(), platformNames:PLATFORM_NAMES, downloader, provider: process.env.AI_PROVIDER || 'antigravity', model: process.env.AI_MODEL || '', geminiConfigured: connections.summary().geminiConfigured });
    }
    if (req.method === 'GET' && path === '/api/connections') return json(res, 200, connections.summary());
    if(req.method==='POST'&&path==='/api/publisher/configure')return json(res,200,await managed.configure(await body(req)));
    if(req.method==='POST'&&path==='/api/publisher/profile')return json(res,201,await managed.createProfile(await body(req)));
    if(req.method==='POST'&&path==='/api/publisher/connect')return json(res,200,await managed.connect(await body(req)));
    if(req.method==='POST'&&path==='/api/publisher/sync')return json(res,200,await managed.sync(await body(req)));
    if (req.method === 'POST' && path === '/api/connections') return json(res, 201, await connections.add(await body(req)));
    if (req.method === 'POST' && path === '/api/connections/browser') return json(res, 201, await connections.addBrowser(await body(req)));
    if (req.method === 'POST' && path === '/api/settings/ai') return json(res, 200, await connections.settings(await body(req)));
    const accountAction = path.match(/^\/api\/connections\/([a-f0-9-]{36})(?:\/(activate))?$/);
    if (accountAction && req.method === 'POST' && accountAction[2]) return json(res, 200, await connections.activate(accountAction[1]));
    if (accountAction && req.method === 'DELETE') return json(res, 200, await connections.remove(accountAction[1]));
    if (req.method === 'POST' && path === '/api/oauth/start') return json(res, 200, await connections.beginOAuth(await body(req), `http://127.0.0.1:${port}`));
    const oauthStatus = path.match(/^\/api\/oauth\/([a-f0-9]{48})$/);
    if (req.method === 'GET' && oauthStatus) return json(res, 200, connections.oauthStatus(oauthStatus[1]));
    const callback = path.match(/^\/oauth\/callback\/(youtube|tiktok)$/);
    if (req.method === 'GET' && callback) {
      try { await connections.callback(callback[1], new URL(req.url, `http://127.0.0.1:${port}`).searchParams); }
      catch { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); res.end('Sign-in did not complete. Return to Clipmax to see the error and try again.'); return; }
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); res.end('Account connected. You can close this tab and return to Clipmax Studio.'); return;
    }
    if (req.method === 'GET' && path === '/api/jobs') return json(res, 200, [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    const deletion = path.match(/^\/api\/jobs\/([a-f0-9-]{36})$/);
    const deletionStart=path.match(/^\/api\/jobs\/([a-f0-9-]{36})\/delete-confirmation$/);
    if(req.method==='POST'&&deletionStart){
      const job=getJob(deletionStart[1]);if(projectBusy(job))throw new Error('Wait for processing, editing or publishing to finish before deleting this project.');
      const input=await body(req);return json(res,200,{confirmation:deletionConfirmations.begin(job.id,input.confirmed),expiresInSeconds:120});
    }
    if (req.method === 'DELETE' && deletion) {
      const job = getJob(deletion[1]);
      if (projectBusy(job)) throw new Error('Wait for processing, editing or publishing to finish before deleting this project.');
      const input=await body(req);if(projectBusy(job))throw new Error('Wait for the active project task to finish before deleting.');
      deletionConfirmations.consume(job.id,input);
      job.deleting = true;
      try {
        await writes.get(job.id);
        await deleteProjectPermanently(dataDir, job.id); jobs.delete(job.id); writes.delete(job.id);
        return json(res, 200, { deleted: true, permanent:true });
      } catch (error) { delete job.deleting; throw error; }
    }
    const restore = path.match(/^\/api\/trash\/([a-f0-9-]{36}--\d{13})\/restore$/);
    if (req.method === 'POST' && restore) {
      const job = await restoreProject(dataDir, restore[1]); jobs.set(job.id, job); return json(res, 200, job);
    }
    const cancel = path.match(/^\/api\/jobs\/([a-f0-9-]{36})\/cancel$/);
    if (req.method === 'POST' && cancel) {
      const job = getJob(cancel[1]), entry = tasks.get(job.id);
      if (job.status === 'cancelled' || job.cancelling) return json(res, 200, job);
      if (!entry || job.publishing) throw new Error('This project has no cancellable processing task.');
      job.cancelling = true; entry.controller.abort(cancellationError());
      if (!entry.started) { await cancelledJob(job,entry.kind);tasks.delete(job.id);job.canCancel=false;job.cancelling=false; }
      await save(job); return json(res, 202, job);
    }
    const retry = path.match(/^\/api\/jobs\/([a-f0-9-]{36})\/retry$/);
    if (req.method === 'POST' && retry) {
      const job = getJob(retry[1]);
      if (!['failed','cancelled','paused'].includes(job.status) || job.cancelling) throw new Error('Only stopped projects can be retried.');
      if ([...jobs.values()].filter(x => ['queued', 'importing', 'transcribing', 'analyzing', 'rendering'].includes(x.status)).length >= 5) throw new Error('Queue is full. Wait for a project to finish.');
      if(job.status==='paused'&&job.resumeStage==='analysis'){
        const dir=join(dataDir,job.id),cues=JSON.parse(await readFile(join(dir,'cues.json'),'utf8'));await access(join(dir,'source.mp4'));
        job.status='queued';delete job.pauseReason;delete job.resumeStage;await save(job);
        scheduleProject(job,async()=>{try{await finishJob(job,dir,cues,connections.config());}catch(error){throwIfCancelled();if(error.code==='AI_QUOTA_PAUSED')await pauseForQuota(job,error);else{job.status='failed';job.error=sanitize(error.message);await save(job);}}});
        return json(res,202,job);
      }
      if (job.workflow?.stages?.import?.state === 'done') job.importedSource = { url: job.url, start: job.scanStart || 0, end: (job.scanStart || 0) + job.duration };
      if (!job.importedSource && job.duration) {
        try { const media=await probeSource(ffmpeg,join(dataDir,job.id,'source.mp4')); if(Math.abs(media.duration-job.duration)<3){job.importedSource={url:job.url,start:job.scanStart||0,end:(job.scanStart||0)+job.duration};job.mediaInfo=media;} } catch {}
      }
      job.status = 'queued'; job.clips = []; delete job.cancelledAt; delete job.error; delete job.notice; delete job.workflow;
      await save(job); scheduleProject(job, () => processJob(job));
      return json(res, 202, job);
    }
    if (req.method === 'POST' && path === '/api/jobs') {
      const input = await body(req);
      const autoUpload = autoUploadSettings(input.autoUpload, connections.summary().accounts, connectionStatus(connections.config()));
      if ([...jobs.values()].filter(x => ['queued', 'importing', 'transcribing', 'analyzing', 'rendering'].includes(x.status)).length >= 5) throw new Error('Queue is full. Wait for a project to finish.');
      const scanStart = Number(input.scanStart || 0), scanMinutes = Number(input.scanMinutes || 30);
      if (!Number.isFinite(scanStart) || scanStart < 0 || !Number.isFinite(scanMinutes) || scanMinutes < 1 || scanMinutes > 120) throw new Error('Choose a valid scan start and a scan length of 1–120 minutes.');
      const job = { id: randomUUID(), url: validateSource(input.url), title: 'New project', createdAt: new Date().toISOString(), status: 'queued', scanStart, scanMinutes, count: Math.min(6, Math.max(1, Number(input.count) || 3)), maxSeconds: Math.min(90, Math.max(15, Number(input.maxSeconds) || 45)), aspect: ['9:16', '1:1', '16:9'].includes(input.aspect) ? input.aspect : '9:16', captions: input.captions !== false, provider: input.provider === 'gemini' ? 'gemini' : 'antigravity', model: String(input.model || '').slice(0, 100), clips: [] };
      job.streamerName = cleanStreamerName(input.streamerName);
      job.autoUpload = autoUpload;
      job.media = mediaSettings(input.media);
      job.focus=FOCUSES.includes(input.focus)?input.focus:'weird_sad_unexpected';
      await mkdir(join(dataDir, job.id)); jobs.set(job.id, job); await save(job);
      scheduleProject(job, () => processJob(job));
      return json(res, 201, job);
    }
    const refine = path.match(/^\/api\/jobs\/([a-f0-9-]{36})\/refine$/);
    if (req.method === 'POST' && refine) {
      const job = getJob(refine[1]), input = await body(req);
      if (job.status !== 'ready' || job.publishing || job.editing || job.clips.some(c=>Object.keys(c.publications || {}).length)) throw new Error('Choose a ready project with no existing uploads.');
      job.media = mediaSettings(input.media || job.media); job.focus=FOCUSES.includes(input.focus)?input.focus:job.focus||'weird_sad_unexpected'; job.status = 'analyzing'; delete job.error;
      await save(job);
      scheduleProject(job, async()=>{try { const dir=join(dataDir,job.id), cues=JSON.parse(await readFile(join(dir,'cues.json'),'utf8')); await finishJob(job,dir,cues,connections.config()); } catch(error) { throwIfCancelled(); if(error.code==='AI_QUOTA_PAUSED'){await pauseForQuota(job,error);return;} job.status='failed';job.error=sanitize(error.message);await save(job); }});
      return json(res,202,job);
    }
    const metadata = path.match(/^\/api\/jobs\/([a-f0-9-]{36})\/metadata$/);
    if (req.method === 'POST' && metadata) {
      const job = getJob(metadata[1]), input = await body(req);
      if (job.status !== 'ready' || job.publishing || job.editing) throw new Error('Wait until this project is ready.');
      const ids = input.clipIds;
      if (ids !== undefined && (!Array.isArray(ids) || !ids.length || ids.some(id => !job.clips.some(c => c.id === id)))) throw new Error('Choose valid clips for AI details.');
      const clips = job.clips.filter(c => !ids || ids.includes(c.id));
      if (!clips.length) throw new Error('No clips are available.');
      const nextStreamer = Object.hasOwn(input, 'streamerName') ? cleanStreamerName(input.streamerName) : job.streamerName;
      const metadataJob = { ...job, streamerName: nextStreamer };
      job.editing = true; delete job.metadataError;
      try {
        await stage(job, 'metadata', { state: 'running', percent: null, message: 'Gemini CLI is writing titles, descriptions and tags' });
        const dir = join(dataDir, job.id), cues = JSON.parse(await readFile(join(dir, 'cues.json'), 'utf8'));
        const details = await runTask(job, () => generateMetadata({ job: metadataJob, clips, cues, dir, onProgress: () => progress(job, 'metadata', { state: 'running', percent: null, message: 'Gemini CLI is writing titles, descriptions and tags' }) }), beginTask(job, 'metadata'));
        job.streamerName = nextStreamer;
        for (const value of details) Object.assign(clips.find(c => c.id === value.id), value);
        await stage(job, 'metadata', { state: 'done', message: 'AI publishing details ready to review' });
      } catch (error) {
        job.metadataError = sanitize(error.message);
        await stage(job, 'metadata', { state: error.code==='PROJECT_CANCELLED'?'cancelled':error.code==='AI_QUOTA_PAUSED'?'waiting':'failed', message: error.code==='PROJECT_CANCELLED'?'AI details cancelled; existing copy kept':error.code==='AI_QUOTA_PAUSED'?'Waiting for quota; existing copy kept':'AI details failed; existing copy kept' });
      } finally { job.editing = false; await save(job); }
      return json(res, job.metadataError ? 400 : 200, job.metadataError ? { error: job.metadataError } : job);
    }
    const edit = path.match(/^\/api\/jobs\/([a-f0-9-]{36})\/clips\/(clip-[1-6])$/);
    if (req.method === 'PATCH' && edit) {
      const job = getJob(edit[1]), clip = job.clips.find(c => c.id === edit[2]);
      if (!clip || job.status !== 'ready' || job.publishing || job.editing) throw new Error('Wait until this project is ready.');
      const input = await body(req), next = { ...clip, ...validateClips({ clips: [{ ...clip, start: input.start ?? clip.start, end: input.end ?? clip.end, title: input.title ?? clip.title, caption: input.description ?? input.caption ?? clip.caption, description: input.description ?? input.caption ?? clip.description, tags: input.tags ?? clip.tags }] }, job.duration, 1, job.maxSeconds)[0], id: clip.id, publications: clip.publications };
      if (input.media !== undefined) next.media = mediaSettings(input.media);
      if(input.mood!==undefined){if(!MOODS.includes(input.mood))throw new Error('Choose a supported mood.');next.mood=input.mood;next.moodConfidence=1;next.moodReason='Mood chosen in the clip editor';delete next.soundPlan;
        const suggested=resolveSound({...mediaSettings(next.media||job.media),effects:'auto'},{...next,soundDesign:{...next.soundDesign,effect:undefined}});next.soundDesign={...next.soundDesign,effect:suggested.effects,reason:'Matched to the mood chosen in the editor'};
      }
      if(input.momentType!==undefined){if(!MOMENTS.includes(input.momentType))throw new Error('Choose a supported moment type.');next.momentType=input.momentType;}
      if (next.start !== clip.start || next.end !== clip.end) delete next.publicationMetadata;
      const needsRender = next.start !== clip.start || next.end !== clip.end || input.media !== undefined || input.mood!==undefined || input.refreshFraming===true || input.refreshStyle===true;
      if (needsRender && Object.keys(clip.publications).length) throw new Error('Published clips cannot be retrimmed. Create a new project.');
      job.editing = true;
      try { if (needsRender) { const dir=join(dataDir,job.id),cues=JSON.parse(await readFile(join(dir,'cues.json'),'utf8')); next.contextReviewNeeded=completeClipEnd(next,cues,job.duration,job.maxSeconds).contextReviewNeeded;
        if((input.refreshFraming===true||next.start!==clip.start||next.end!==clip.end||mediaSettings(clip.media||job.media).framing!=='auto')&&mediaSettings(next.media||job.media).framing==='auto'){
          await stage(job,'framing',{state:'running',percent:0,message:'Rechecking the full head and camera position'});
          try{next.framing=(await detectFraming({job:{clips:[next]},dir,source:join(dir,'source.mp4'),ffmpeg,onProgress:value=>progress(job,'framing',{...value,state:'running'})}))[next.id];}catch{next.framing={mode:'preserve',webcam:null};}
          await stage(job,'framing',{state:'done',message:next.framing.mode==='streamer'?'Full-head camera layout checked':'Full source preserved to keep the head visible'});
        }
        await render(job, next); } Object.assign(clip, next); }
      catch(error) { for (const entry of [...Object.values(job.workflow?.stages || {}),...Object.values(job.workflow?.clips?.[clip.id] || {})]) if(entry.state==='running'){entry.state='failed';entry.message='Edit failed; adjust settings and retry';} throw error; }
      finally { job.editing = false; await save(job); }
      return json(res, 200, job);
    }
    const post = path.match(/^\/api\/jobs\/([a-f0-9-]{36})\/publish$/);
    const publicationStatus=path.match(/^\/api\/jobs\/([a-f0-9-]{36})\/publication-status$/);
    if(req.method==='POST'&&publicationStatus){
      const job=getJob(publicationStatus[1]);if(job.publishing||job.editing)throw new Error('Wait for the current operation to finish.');
      for(const clip of job.clips||[])for(const [platform,result]of Object.entries(clip.publications||{}))if(result.provider==='upload-post'&&result.requestId&&result.status==='processing'){
        const next=await managedStatus(platform,result.requestId,managed.key());clip.publications[platform]={...next,at:result.at};updateStage(job,`upload:${platform}`,{state:next.status==='failed'?'failed':next.status==='action_required'?'waiting':'done',message:next.status==='published'?'Published':next.status==='processing'?'Platform still processing':next.error||'Upload accepted'},clip.id);
      }
      await save(job);return json(res,200,job);
    }
    const browserHandoff = path.match(/^\/api\/jobs\/([a-f0-9-]{36})\/browser-handoff$/);
    if (req.method === 'POST' && browserHandoff) {
      const job = getJob(browserHandoff[1]), input = await body(req), clip = job.clips.find(c => c.id === input.clipId);
      if (job.status !== 'ready' || !clip || !platforms.includes(input.platform)) throw new Error('Choose a ready clip and supported platform.');
      clip.browserHandoffs ||= {}; clip.browserHandoffs[input.platform] = { status: 'awaiting_browser', at: new Date().toISOString() };
      updateStage(job, `upload:${input.platform}`, { state: 'waiting', percent: null, message: 'Finish uploading and posting in your browser' }, clip.id);
      await save(job); return json(res, 200, { status: 'awaiting_browser' });
    }
    if (req.method === 'POST' && post) {
      const job = getJob(post[1]), input = await body(req);
      if (job.status !== 'ready' || job.publishing || job.editing) throw new Error('Wait until this project is ready.');
      if (input.consent !== true) throw new Error('Confirm publishing consent.');
      const targets = [...new Set(input.platforms || [])], clips = job.clips.filter(c => input.clipIds?.includes(c.id));
      if (!targets.length || !clips.length || targets.some(p => !platforms.includes(p))) throw new Error('Choose clips and at least one platform.');
      const options = publishOptions(input);
      await startPublishing(job, clips, targets, options);
      return json(res, 202, job);
    }
    if (req.method === 'GET' && /^\/media\/[a-f0-9-]{36}\/clip-[1-6]\.(mp4|srt)$/.test(path)) return await serveFile(req, res, join(dataDir, ...path.split('/').slice(2)));
    const pages = { '/': 'index.html', '/app.js': 'app.js', '/workflow.js': 'workflow.js', '/workflow.css': 'workflow.css', '/style.css': 'style.css' };
    if (req.method === 'GET' && pages[path]) return await serveFile(req, res, join(root, 'public', pages[path]));
    json(res, 404, { error: 'Not found.' });
  } catch (e) { if (!res.headersSent) json(res, e.code === 'ENOENT' ? 404 : 400, { error: sanitize(e.message) }); else res.destroy(); }
});
server.listen(port, bindHost, () => {console.log(`Clipmax Studio: http://127.0.0.1:${port}`);mcp.restore().catch(()=>{});});
