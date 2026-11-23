import test from 'node:test';
import assert from 'node:assert/strict';
import { whisperCues } from '../lib/transcribe.mjs';
test('Whisper millisecond timestamps become bounded second-based caption cues', () => {
  assert.deepEqual(whisperCues({ transcription: [{ offsets: { from: 1000, to: 3000 }, text: ' Hello world ' }, { offsets: { from: 3000, to: 7000 }, text: 'Next phrase' }] }, 5), [{ start: 1, end: 3, text: 'Hello world' }, { start: 3, end: 5, text: 'Next phrase' }]);
});
test('caption parsing ignores invalid times and silence tokens and merges repeated adjacent hallucinations', () => {
  const make = (from, to, text) => ({ offsets: { from, to }, text });
  assert.deepEqual(whisperCues({ transcription: [make(0, 1, '[BLANK_AUDIO]'), make(-1, 30, 'bad'), make(5, 3, 'bad'), make(0, 1000, 'Hello'), make(1000, 2000, 'Hello'), make(20000, 21000, 'outside')] }, 10), [{ start: 0, end: 2, text: 'Hello' }]);
  assert.throws(() => whisperCues({}, 10));
});
