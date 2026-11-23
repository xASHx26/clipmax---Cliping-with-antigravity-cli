import test from 'node:test';import assert from 'node:assert/strict';import {effectWave,EFFECT_LENGTHS,backgroundWave} from '../lib/sounds.mjs';
test('opening accents are short, silent at the edges, and avoid the old long rumbling hit',()=>{
 for(const [name,duration] of Object.entries(EFFECT_LENGTHS)){
  const wave=effectWave(name);assert.equal(wave.readUInt32LE(24),48000);assert.ok(duration<=.32);
  assert.equal(wave.readInt16LE(44),0);assert.equal(wave.readInt16LE(wave.length-2),0);
  let maximum=0;for(let i=44;i<wave.length;i+=2)maximum=Math.max(maximum,Math.abs(wave.readInt16LE(i)));assert.ok(maximum>1000&&maximum<30000);
 }
 assert.notDeepEqual(effectWave('notification'),effectWave('pop'));
});
test('background moods generate distinct reusable PCM beds',()=>{
 const sad=backgroundWave('melancholy'),playful=backgroundWave('playful');assert.equal(sad.readUInt32LE(24),48000);assert.notDeepEqual(sad,playful);
});
