import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Connections } from '../lib/connections.mjs';
import { ManagedPublishing, connectedSocial, managedResult, publishManaged } from '../lib/managed-publishing.mjs';
import { connectionStatus } from '../lib/publish.mjs';
import { autoUploadSettings } from '../lib/auto-publish.mjs';
const key='test-provider-secret-key';
const response=(data,status=200)=>new Response(JSON.stringify(data),{status});
function profile(id='UC-channel-a'){return {username:'studio',social_accounts:{youtube:{username:id,handle:'My Channel'},tiktok:{username:'creator-a',handle:'Creator',capabilities:['video_privacy']},instagram:{username:'ig-a',handle:'My IG'}}};}
function mock(profileGetter=()=>profile()){
 return async(url,options)=>{
  assert.equal(options.headers.Authorization,`Apikey ${key}`);
  if(url.endsWith('/generate-jwt'))return response({success:true,access_url:'https://app.upload-post.com/connect?token=temporary'});
  if(url.endsWith('/users'))return response({success:true,plan:'test',profiles:[profileGetter()]});
  return response({success:true,profile:profileGetter()});
 };
}
test('managed key remains encrypted and only verified stable channel identities become automatic destinations',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'clipmax-managed-'));
 try{
  const vault=new Connections(dir,randomBytes(32).toString('base64')),provider=new ManagedPublishing(vault,mock());
  await provider.configure({apiKey:key});assert.equal(vault.summary().accounts.length,0);
  assert.ok(!JSON.stringify(provider.summary()).includes(key));
  assert.ok(!(await readFile(join(dir,'connections.enc'),'utf8')).includes(key));
  assert.match((await provider.connect({profile:'studio'})).url,/^https:\/\/app.upload-post.com\/connect/);
  await provider.sync({profile:'studio'});assert.equal(vault.summary().accounts.length,3);
  assert.ok(!JSON.stringify(vault.summary()).includes(key));assert.equal(connectionStatus(vault.config()).instagram,true);
  const setting=autoUploadSettings({enabled:true,consent:true,platforms:['youtube','instagram']},vault.summary().accounts,connectionStatus(vault.config()));
  assert.ok(setting.accountIds.youtube);await provider.verify(['youtube']);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('channel swaps and expired social grants stop uploads; names alone never count as a verified identity',async()=>{
 let current=profile();const vault=new Connections('.',null),provider=new ManagedPublishing(vault,mock(()=>current));
 await provider.configure({apiKey:key});await provider.sync({profile:'studio'});const old=vault.summary().accounts.find(a=>a.platform==='youtube');
 current=profile('UC-channel-b');await assert.rejects(provider.verify(['youtube']),/account changed/);
 assert.equal(connectionStatus(vault.config()).youtube,false);
 await provider.sync({profile:'studio'});const active=vault.summary().accounts.find(a=>a.platform==='youtube'&&a.active);assert.notEqual(active.id,old.id);
 current.social_accounts.youtube.reauth_required=true;await assert.rejects(provider.verify(['youtube']),/needs sign-in/);
 assert.equal(connectedSocial({display_name:'Name without ID'}),null);assert.equal(connectedSocial(''),null);
});
test('TikTok privacy is never silently upgraded to public when provider capability is absent',async()=>{
 const p=profile();p.social_accounts.tiktok.capabilities=[];
 const vault=new Connections('.',null),provider=new ManagedPublishing(vault,mock(()=>p));await provider.configure({apiKey:key});await provider.sync({profile:'studio'});
 await assert.rejects(provider.verify(['tiktok'],{tiktokPrivacy:'SELF_ONLY'}),/cannot honor/);
 await provider.verify(['tiktok'],{tiktokPrivacy:'PUBLIC_TO_EVERYONE'});
});
test('result parsing distinguishes queued, skipped, failed, drafts, published and moderation-pending outcomes',()=>{
 assert.equal(managedResult({status:'completed',results:[{platform:'youtube',success:false,skipped:true}]},'youtube','id').status,'failed');
 assert.equal(managedResult({status:'processing',results:[{platform:'x',success:true,message:'Queued'}]},'x','id').status,'processing');
 assert.equal(managedResult({status:'completed',results:[{platform:'tiktok',success:true,fallback_to_inbox:true}]},'tiktok','id').status,'action_required');
 assert.equal(managedResult({status:'completed',results:[{platform:'youtube',success:true,post_url:'https://youtu.be/post'}]},'youtube','id').status,'published');
 assert.equal(managedResult({status:'completed',results:[]},'youtube','id').status,'processing');
 assert.equal(managedResult({status:'completed',results:[{platform:'tiktok',success:true}]},'tiktok','id').status,'uploaded');
});
test('multipart video upload preserves privacy, sends an idempotency key, tracks real writes and confirms provider status',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'clipmax-upload-')),file=join(dir,'clip.mp4');await writeFile(file,'video-fixture');
 try{
  let uploaded=0,seenId;const config={UPLOAD_POST_API_KEY:key,UPLOAD_POST_TARGETS:{youtube:{profile:'studio',remoteId:'UC-channel-a'}}};
  const run=()=>publishManaged('youtube',{id:'job'},{id:'clip-1',title:'A title',caption:'A caption'},file,{youtubePrivacy:'private',madeForKids:true},config,()=>{}, {
   uploader:async(url,options)=>{
    uploaded++;assert.equal(url,'https://api.upload-post.com/api/upload');assert.equal(options.headers.Authorization,`Apikey ${key}`);
    const form=await new Response(options.body,{headers:{'Content-Type':options.headers['Content-Type']}}).formData();
    assert.equal(form.get('privacyStatus'),'private');assert.equal(form.get('selfDeclaredMadeForKids'),'true');assert.equal(form.get('user'),'studio');assert.equal(form.get('platform[]'),'youtube');
    assert.equal(await form.get('video').text(),'video-fixture');if(seenId)assert.equal(seenId,options.headers['Idempotency-Key']);seenId=options.headers['Idempotency-Key'];
    options.onProgress({bytes:options.body.length,totalBytes:options.body.length,percent:99.9});return response({success:true,request_id:seenId});
   },fetcher:async(url,options)=>url.includes('/status?')?response({status:'completed',results:[{platform:'youtube',success:true,post_url:'https://youtu.be/post'}]}):mock()(url,options),wait:async()=>{},polls:1
  });
  assert.equal((await run()).status,'published');assert.equal((await run()).status,'published');assert.equal(uploaded,2);
  let wrongUploads=0;await assert.rejects(publishManaged('youtube',{id:'job'},{id:'clip-1'},file,{},config,()=>{},{fetcher:mock(()=>profile('different-channel')),uploader:async()=>wrongUploads++}),/destination account changed/);assert.equal(wrongUploads,0);
 }finally{await rm(dir,{recursive:true,force:true})}
});
