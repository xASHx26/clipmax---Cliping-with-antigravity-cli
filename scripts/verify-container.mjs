import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, renderArgs } from '../lib/core.mjs';
import { prepareAudio, mediaSettings, probeSource } from '../lib/audio.mjs';
import { detectFraming } from '../lib/framing.mjs';

const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const dir = await mkdtemp(join(tmpdir(), 'clipmax-container-'));
try {
  await run(process.env.YTDLP_PATH || 'yt-dlp', ['--version']);
  await run(process.env.AGY_PATH || 'agy', ['--version'], { timeout: 60000 });
  const source = join(dir, 'source.mp4');
  await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source]);
  const clip = { id: 'clip-1', start: 0, end: 2 };
  const framing = await detectFraming({ job: { clips: [clip] }, dir, source, ffmpeg });
  assert.ok(framing['clip-1']);
  const audio = await prepareAudio({ ffmpeg, source, dir, clip, settings: mediaSettings({ background: 'ambient', effects: 'pop' }), hasAudio: true });
  await writeFile(join(dir, 'clip-1.srt'), '1\n00:00:00,000 --> 00:00:02,000\nClipmax container check\n');
  await run(ffmpeg, renderArgs(source, clip, { framing: { mode: 'preserve' }, audioFile: audio.file, subtitleFilter: true }), { cwd: dir });
  const output = join(dir, 'clip-1.mp4');
  assert.ok((await stat(output)).size > 1000);
  assert.equal((await probeSource(ffmpeg, output)).hasAudio, true);
  await run(ffmpeg, ['-v', 'error', '-i', output, '-f', 'null', '-']);
  await run(process.env.WHISPER_PATH, ['-m', process.env.WHISPER_MODEL_PATH, '-f', '/opt/models/speech-check.wav', '-l', 'en', '-t', '2', '-otxt', '-of', join(dir, 'speech')]);
  assert.match(await readFile(join(dir, 'speech.txt'), 'utf8'), /ask.*country/is);
  console.log('PASS: Linux tools, local face model, speech recognition, sound mix, and captioned H.264/AAC export.');
} finally { await rm(dir, { recursive: true, force: true }); }
