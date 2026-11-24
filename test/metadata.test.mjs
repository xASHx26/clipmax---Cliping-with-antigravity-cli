import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateMetadata, normalizeTags, publicationDetails, creditStreamer, streamerNameFor, cleanStreamerName } from '../lib/metadata.mjs';
import { validateClips } from '../lib/core.mjs';
import { publish } from '../lib/publish.mjs';

test('publishing copy survives clip validation; Unicode descriptions and tag lists fit YouTube limits', () => {
  const raw = { start: 0, end: 10, title: 'A complete story', description: 'বাংলা'.repeat(1000), tags: ['#story', 'Story', 'two words', ...Array.from({length:30}, (_,i)=>String(i).repeat(70))] };
  const clip = validateClips({clips:[raw]}, 30, 1, 30)[0];
  assert.ok(Buffer.byteLength(clip.description) <= 5000);
  assert.equal(clip.tags[0], 'story'); assert.equal(clip.tags[1], 'two words');
  assert.equal(clip.tags.filter(t => t.toLowerCase() === 'story').length, 1);
  assert.ok(clip.tags.reduce((n,t,i)=>n+t.length+(t.includes(' ')?2:0)+(i?1:0),0)<=500);
  assert.deepEqual(normalizeTags('one, two, #one'), ['one','two']);
  assert.equal(publicationDetails({caption:'Legacy caption'}).description,'Legacy caption');
});

test('Gemini CLI uses only each selected clip transcript and validates IDs before replacing any copy', async () => {
  const clips=[{id:'clip-1',start:0,end:10},{id:'clip-2',start:20,end:30}];
  const cues=[{start:0,end:8,text:'A surprising answer.'},{start:11,end:18,text:'DO NOT INCLUDE THIS IN A CLIP.'},{start:20,end:29,text:'A complete second story.'}];
  const values=await generateMetadata({job:{provider:'antigravity',model:'test-model',title:'Source'},clips,cues,dir:'.',ask:async input=>{
    assert.equal(input.model,'test-model'); assert.ok(input.prompt.includes('A surprising answer.'));
    assert.ok(!input.prompt.includes('DO NOT INCLUDE THIS IN A CLIP.'));
    return {clips:clips.map(c=>({id:c.id,title:'New title',description:'Grounded description.',tags:['story','reaction']}))};
  }});
  assert.equal(values.length,2); assert.equal(values[0].publicationMetadata.provider,'Gemini CLI via Antigravity');
  for(const bad of [{clips:[]},{clips:[{id:'clip-1',title:'x',description:'x',tags:[]}]},{clips:[{id:'wrong',title:'x',description:'x',tags:['a']}]}]) {
    await assert.rejects(generateMetadata({job:{},clips:[clips[0]],cues,dir:'.',ask:async()=>bad}), /details/);
  }
  assert.equal(clips[0].title,undefined);
});

test('YouTube upload receives the AI title, full description and tags rather than the old caption', async () => {
  const dir=await mkdtemp(join(tmpdir(),'clipmax-metadata-')), file=join(dir,'clip.mp4');
  await writeFile(file,'fake video'); let calls=0;
  try {
    const result=await publish('youtube',{id:'job'},{title:'AI title',caption:'Old caption',description:'Full AI description #story',tags:['story','two words']},file,{youtubePrivacy:'private',madeForKids:false},{YOUTUBE_ACCESS_TOKEN:'test'},()=>{},{request:async(url,options)=>{
      calls++;
      if(calls===1){assert.deepEqual(options.body.snippet,{title:'AI title',description:'Full AI description #story',tags:['story','two words'],categoryId:'22'});assert.equal(options.body.status.privacyStatus,'private');return{response:{headers:new Headers({location:'https://www.googleapis.com/upload/test'})}};}
      assert.equal(options.method,'PUT'); return{data:{id:'uploaded-id'}};
    }});
    assert.equal(result.id,'uploaded-id');assert.equal(calls,2);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('source creator credit is deterministic, editable, and never taken from the publishing account', async () => {
  const job={sourceCreator:{name:'KaiCenat'},destinationAccount:{name:'Nepa'}};
  assert.equal(streamerNameFor(job),'KaiCenat');
  assert.equal(streamerNameFor({...job,streamerName:'Kai Cenat'}),'Kai Cenat');
  assert.equal(streamerNameFor({destinationAccount:{name:'Nepa'}}),'');
  assert.equal(cleanStreamerName('<Kai>\nCenat'),'KaiCenat');
  const details=creditStreamer({title:'Chat had one suggestion',description:'A complete reaction.',tags:['reaction']},job);
  assert.match(details.title,/^KaiCenat:/);assert.match(details.description,/^KaiCenat/);
  assert.deepEqual(details.tags.slice(0,2),['KaiCenat','KaiCenat clips']);
  assert.deepEqual(creditStreamer(details,job),details);
  const [result]=await generateMetadata({job,clips:[{id:'clip-1',start:0,end:10}],cues:[{start:0,end:10,text:'I am staying chill.'}],dir:'.',ask:async({prompt})=>{
    assert.ok(prompt.includes('"streamerName":"KaiCenat"'));assert.ok(!prompt.includes('Nepa'));
    assert.ok(prompt.includes('curiosity') || prompt.includes('curiosity'.toUpperCase()));
    return{clips:[{id:'clip-1',title:'Chat had one suggestion',description:'A complete reaction.',tags:['reaction']}]};
  }});
  assert.equal(result.publicationMetadata.streamerName,'KaiCenat');assert.match(result.title,/KaiCenat/);assert.match(result.description,/KaiCenat/);
});
