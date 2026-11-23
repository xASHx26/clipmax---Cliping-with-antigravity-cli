import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSource, importWindow, run, parseVtt, clipSrt, validateClips, parseJson, renderArgs } from '../lib/core.mjs';

test('source validation accepts services and rejects local URLs and lookalikes', () => {
  assert.equal(validateSource('https://youtu.be/example'), 'https://youtu.be/example');
  assert.equal(validateSource('https://m.twitch.tv/videos/2936683310'), 'https://www.twitch.tv/videos/2936683310');
  assert.equal(validateSource('https://clips.twitch.tv/example'), 'https://clips.twitch.tv/example');
  for (const url of ['http://youtube.com/a', 'https://127.0.0.1/a', 'https://youtube.com.evil.test/a', 'https://twitch.tv.evil.test/a', 'https://user:pass@youtube.com/a', 'https://youtube.com:8080/a', 'file:///etc/passwd']) assert.throws(() => validateSource(url));
});
test('long VOD imports bound the selected window without rejecting the whole video', () => {
  assert.deepEqual(importWindow(24289, 3600, 15), { start: 3600, end: 4500, duration: 900 });
  assert.deepEqual(importWindow(70, 60, 30), { start: 60, end: 70, duration: 10 });
  assert.throws(() => importWindow(70, 68));
  assert.throws(() => importWindow(24289, 0, 300));
});
test('VTT cue parsing strips tags and SRT export trims/rebases timestamps', () => {
  const cues = parseVtt('WEBVTT\n\n00:00:09.500 --> 00:00:12.000 align:start\n<v Speaker>Hello &amp; welcome</v>\n\n00:00:12.000 --> 00:00:16.000\nNext line\n');
  assert.deepEqual(cues, [{ start: 9.5, end: 12, text: 'Hello & welcome' }, { start: 12, end: 16, text: 'Next line' }]);
  assert.equal(clipSrt(cues, 10, 15), '1\n00:00:00,000 --> 00:00:02,000\nHello & welcome\n\n2\n00:00:02,000 --> 00:00:05,000\nNext line\n');
});
test('AI timestamps must fit the original duration and selected maximum', () => {
  const valid = { start: 10, end: 40, title: 'Hook', score: 900 };
  assert.equal(validateClips({ clips: [valid] }, 100, 3, 45)[0].score, 100);
  for (const change of [{ start: -1 }, { end: 101 }, { end: 11 }, { end: 80 }, { start: 'bad' }]) assert.throws(() => validateClips({ clips: [{ ...valid, ...change }] }, 100, 3, 45));
});
test('AI JSON can be fenced but malformed plans fail', () => {
  assert.deepEqual(parseJson('```json\n{"clips":[]}\n```'), { clips: [] });
  assert.throws(() => parseJson('no plan'));
});
test('FFmpeg render has explicit stream mapping, crop, duration and relative subtitles', () => {
  const args = renderArgs('source.mp4', { id: 'clip-2', start: 15, end: 45 }, { subtitleFilter: true });
  assert.ok(args.includes('0:a:0?'));
  assert.ok(args[args.indexOf('-vf') + 1].includes('crop=1080:1920'));
  assert.ok(args[args.indexOf('-vf') + 1].includes('subtitles=clip-2.srt'));
  assert.equal(args[args.indexOf('-t') + 1], '30');
  assert.equal(args.at(-1), 'clip-2.mp4');
});

test('Windows process timeouts terminate descendants that inherit media pipes', { skip: process.platform !== 'win32' }, async () => {
  let descendant;
  const script = `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setTimeout(()=>{},30000)'],{stdio:'inherit',windowsHide:true});console.log(child.pid);setTimeout(()=>{},30000);`;
  await assert.rejects(run(process.execPath,['-e',script],{timeout:500,onLine:line=>{if(/^\d+$/.test(line))descendant=Number(line)}}), /timed out/);
  assert.ok(descendant);
  assert.throws(()=>process.kill(descendant,0));
});
