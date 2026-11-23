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
test('full Whisper JSON assembles timestamped subword tokens without losing words',()=>{
 const cue=whisperCues({transcription:[{offsets:{from:1000,to:3000},text:' Hello everyone!',tokens:[{text:'[_BEG_]'},{text:' Hello',offsets:{from:1000,to:1400}},{text:' every',offsets:{from:1400,to:1800}},{text:'one!',offsets:{from:1800,to:2600}}]}]},5)[0];
 assert.deepEqual(cue.words,[{text:'Hello',start:1,end:1.4},{text:'everyone!',start:1.4,end:2.6}]);
 const incomplete=whisperCues({transcription:[{offsets:{from:0,to:2000},text:'Hello world',tokens:[{text:'Hello',offsets:{from:0,to:1000}}]}]},2)[0];
 assert.equal(incomplete.words,undefined);
});
