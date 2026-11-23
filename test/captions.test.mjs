import test from 'node:test';
import assert from 'node:assert/strict';
import { captionWords, clipAss } from '../lib/captions.mjs';

test('animated captions trim/rebase to a clip, highlight words and stay inside safe layout',()=>{
  const ass=clipAss([{start:10,end:13,text:'Look at this moment now.'}],11,13);
  assert.match(ass,/PlayResX: 1080\nPlayResY: 1920/);
  assert.match(ass,/\\move\(540,1431,540,1421/);
  assert.match(ass,/\\1c&H6BE5FF&/);
  const times=ass.split('\n').filter(l=>l.startsWith('Dialogue:')).map(l=>l.split(',').slice(1,3));
  assert.ok(times.length>1);assert.equal(times[0][0],'0:00:00.00');assert.equal(times.at(-1)[1],'0:00:02.00');
});

test('caption overrides cannot be injected by source text and long words fit',()=>{
  const ass=clipAss([{start:0,end:2,text:'{\\pos(0,0)} WWWWWWWWWWWWWWWWWWWWWWWWWWWWWW'}],0,2);
  assert.ok(!ass.includes('{\\pos(0,0)}'));
  assert.ok(!ass.includes('WWWWWWWWWWWWWWWWWWWWWWWWWWWWWW'));
  const sizes=[...ass.matchAll(/\\fs(\d+)/g)].map(m=>Number(m[1]));assert.ok(sizes.some(size=>size<68));
});

test('word timestamps are kept; estimated timing is bounded when unavailable',()=>{
  const words=[{text:'A',start:2,end:2.2},{text:'reaction',start:2.2,end:3}];
  assert.deepEqual(captionWords({start:2,end:3,text:'A reaction',words}),words);
  const estimated=captionWords({start:5,end:7,text:'A longer phrase'});
  assert.equal(estimated[0].start,5);assert.equal(estimated.at(-1).end,7);
  assert.ok(estimated.every((w,i)=>w.end>w.start&&(!i||w.start===estimated[i-1].end)));
});

test('steady highlight and clean styles avoid motion, and absent speech produces no ASS',()=>{
  const cues=[{start:0,end:2,text:'A complete sentence.'}];
  assert.ok(!clipAss(cues,0,2,{style:'highlight'}).includes('\\move'));
  const clean=clipAss(cues,0,2,{aspect:'16:9',style:'clean'});
  assert.match(clean,/PlayResX: 1920/);assert.ok(!clean.includes('\\move'));assert.ok(!clean.includes('\\1c'));
  assert.equal(clipAss([],0,2),'');
});
