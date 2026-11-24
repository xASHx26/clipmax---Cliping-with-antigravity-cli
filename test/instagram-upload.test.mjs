import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Connections } from '../lib/connections.mjs';
import { publish,connectionStatus } from '../lib/publish.mjs';

test('Instagram Facebook Login verifies the exact professional account and needs no public host',async()=>{
 const vault=new Connections('.',null,async(url)=>{assert.ok(url.startsWith('https://graph.facebook.com/'));return new Response(JSON.stringify({id:'12345',username:'studio'}));});
 await vault.add({platform:'instagram',accessToken:'meta-token',instagramLogin:'facebook',accountId:'12345'});
 assert.equal(vault.config().INSTAGRAM_LOGIN,'facebook');assert.equal(connectionStatus(vault.config()).instagram,true);
 await assert.rejects(vault.add({platform:'instagram',accessToken:'meta-token',instagramLogin:'facebook',accountId:'98765'}),/did not verify/);
});
test('Instagram uploads bytes to the trusted Meta host, waits for processing, then publishes the container',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'clipmax-instagram-')),file=join(dir,'clip.mp4');await writeFile(file,'video-bytes');
 const calls=[];let checks=0;
 try{
  const result=await publish('instagram',{id:'job'},{id:'clip-1',title:'Title',caption:'Caption'},file,{}, {INSTAGRAM_USER_ID:'12345',INSTAGRAM_ACCESS_TOKEN:'token',INSTAGRAM_LOGIN:'facebook'},()=>{}, {
   wait:async()=>{},request:async(url,options)=>{
    calls.push(url);
    if(url.endsWith('/12345/media')){assert.equal(options.body.upload_type,'resumable');assert.equal(options.body.video_url,undefined);return {data:{id:'container',uri:'https://rupload.facebook.com/ig-api-upload/v27.0/container'}};}
    if(url.startsWith('https://rupload.facebook.com/')){assert.equal(options.headers.Authorization,'OAuth token');assert.equal(options.body.toString(),'video-bytes');assert.equal(options.headers.file_size,'11');return {data:{success:true}};}
    if(url.includes('fields=status_code'))return {data:{status_code:++checks===1?'IN_PROGRESS':'FINISHED'}};
    assert.equal(options.body.creation_id,'container');return {data:{id:'posted'}};
   }
  });assert.equal(result.status,'published');assert.equal(result.id,'posted');assert.equal(calls.length,5);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('an untrusted Instagram upload host is rejected before any bytes are sent',async()=>{
 let requests=0;
 await assert.rejects(publish('instagram',{id:'job'},{id:'clip-1',title:'t',caption:'c'},'unused.mp4',{}, {INSTAGRAM_USER_ID:'1',INSTAGRAM_ACCESS_TOKEN:'token',INSTAGRAM_LOGIN:'facebook'},()=>{}, {
  request:async()=>{requests++;return {data:{id:'c',uri:'https://evil.example/ig-api-upload/c'}};}
 }),/Unexpected Instagram/);assert.equal(requests,1);
});
