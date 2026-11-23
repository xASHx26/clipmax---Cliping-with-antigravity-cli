import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../lib/core.mjs';
import { updateStage, mediaProgress, downloadProgress, whisperProgress } from '../lib/progress.mjs';
test('FFmpeg progress uses encoded timestamps and does not claim completion before exit', () => {
  const signals = [], parse = mediaProgress(10, progress => signals.push(progress));
  parse('out_time_us=2500000'); parse('speed=1.5x'); parse('progress=continue');
  parse('out_time_us=10000000'); parse('progress=end');
  assert.equal(signals[0].percent, 25);
  assert.equal(signals[0].mediaSeconds, 2.5);
  assert.equal(signals[0].speed, '1.5x');
  assert.equal(signals[1].percent, 99.9);
});
test('download progress supports real bytes, estimated totals and external FFmpeg timestamps', () => {
  const signals = [], parse = downloadProgress(60, p => signals.push(p));
  parse('CLIPMAX_DOWNLOAD:250:1000:NA:8:500');
  parse('CLIPMAX_DOWNLOAD:500:NA:2000:4:500');
  parse('frame=12 time=00:00:30.00 speed=2.4x');
  assert.equal(signals[0].percent, 25);
  assert.equal(signals[0].estimatedTotal, false);
  assert.equal(signals[1].percent, 25);
  assert.equal(signals[1].estimatedTotal, true);
  assert.equal(signals[2].percent, 50);
  assert.equal(signals[2].mediaSeconds, 30);
});
test('Whisper uses emitted transcription percentages; unknown progress stays unknown', () => {
  const signals = [], parse = whisperProgress(p => signals.push(p));
  parse('whisper_print_progress_callback: progress = 45%'); parse('some model loading log');
  assert.deepEqual(signals, [{ percent: 45 }]);
  const job = {};
  updateStage(job, 'analysis', { state: 'running', percent: null });
  assert.equal(job.workflow.stages.analysis.percent, null);
  updateStage(job, 'analysis', { state: 'done' });
  assert.equal(job.workflow.stages.analysis.percent, 100);
});
test('process line callbacks handle split chunks, carriage returns and unterminated final lines', async () => {
  const lines = [];
  await run(process.execPath, ['-e', "process.stdout.write('out_time_');setTimeout(()=>{process.stdout.write('us=1000000\\rprogress=continue\\nlast-line')},10)"], { onLine: line => lines.push(line) });
  assert.deepEqual(lines, ['out_time_us=1000000', 'progress=continue', 'last-line']);
});
