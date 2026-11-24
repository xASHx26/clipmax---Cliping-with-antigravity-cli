import { publicationDetails } from './metadata.mjs';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { SOCIAL_PLATFORMS, PLATFORM_NAMES } from './social-platforms.mjs';
import { uploadBytes } from './upload-progress.mjs';

const API = 'https://api.upload-post.com';
const profileName = value => {
  const name=String(value||'').trim();
  if(!/^[A-Za-z0-9_@-]{1,100}$/.test(name))throw new Error('Choose a valid publishing profile.');
  return name;
};
async function api(key,path,{fetcher=fetch,body,method='GET'}={}) {
  const response=await fetcher(API+path,{method,headers:{Authorization:`Apikey ${key}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(30000)});
  let data;try{data=await response.json()}catch{throw new Error('Upload-Post returned an unreadable response.');}
  if(!response.ok||data.success===false)throw new Error(`Upload-Post (${response.status}): ${String(data.message||data.error||'Authorization or service request failed').replaceAll(key,'[redacted]').slice(0,400)}`);
  return data;
}
export function connectedSocial(value) {
  if(!value||typeof value!=='object'||Array.isArray(value)||!String(value.username||'').trim())return null;
  return { remoteId:String(value.username),name:String(value.handle||value.display_name||value.username).slice(0,120),reauthRequired:value.reauth_required===true,capabilities:Array.isArray(value.capabilities)?value.capabilities.filter(x=>typeof x==='string'):[] };
}
export class ManagedPublishing {
  constructor(vault,fetcher=fetch){this.vault=vault;this.fetch=fetcher;}
  key(){const key=this.vault.state.publisher?.apiKey;if(!key)throw new Error('Add your Upload-Post API key in Connections first.');return key;}
  summary(){const p=this.vault.state.publisher;return {configured:Boolean(p?.apiKey),provider:'upload-post',profiles:p?.profiles||[],plan:p?.plan||'',lastSynced:p?.lastSynced||null};}
  async configure(input){
    const key=String(input.apiKey||'').trim();if(key.length<8||key.length>2000||/[\r\n]/.test(key))throw new Error('Enter a valid Upload-Post API key.');
    const data=await api(key,'/api/uploadposts/users',{fetcher:this.fetch});
    if(!Array.isArray(data.profiles))throw new Error('Upload-Post did not return publishing profiles.');
    const previous=this.vault.state.publisher;
    // Replacing a provider account invalidates existing automatic destinations.
    if(previous?.apiKey&&previous.apiKey!==key)for(const account of this.vault.state.accounts)if(account.provider==='upload-post'){account.active=false;account.missing=true;}
    this.vault.state.publisher={apiKey:key,profiles:data.profiles.map(p=>({username:profileName(p.username),name:String(p.display_name||p.username).slice(0,100)})),plan:String(data.plan||''),lastSynced:Date.now()};
    await this.vault.save();return this.summary();
  }
  async createProfile(input){
    const username=profileName(input.username);
    const data=await api(this.key(),'/api/uploadposts/users',{fetcher:this.fetch,method:'POST',body:{username,display_name:String(input.name||'Clipmax workspace').slice(0,100)}});
    if(data.profile?.username!==username)throw new Error('Publishing profile was not confirmed. Refresh profiles before trying again.');
    const profiles=this.vault.state.publisher.profiles; if(!profiles.some(p=>p.username===username))profiles.push({username,name:String(data.profile.display_name||username)});
    await this.vault.save();return this.summary();
  }
  async connect(input){
    const username=profileName(input.profile);if(!this.summary().profiles.some(p=>p.username===username))throw new Error('Select a publishing profile first.');
    const data=await api(this.key(),'/api/uploadposts/users/generate-jwt',{fetcher:this.fetch,method:'POST',body:{username,show_calendar:false,connect_title:'Connect your Clipmax channels',connect_description:'Authorize the accounts that will receive your clips.'}});
    const url=new URL(data.access_url);if(url.origin!=='https://app.upload-post.com'||!/^\/connect(?:\/|$)/.test(url.pathname))throw new Error('Unexpected social sign-in destination.');
    return {url:url.href};
  }
  async getProfile(profile){const data=await api(this.key(),'/api/uploadposts/users/'+encodeURIComponent(profileName(profile)),{fetcher:this.fetch});if(data.profile?.username!==profile)throw new Error('Publishing profile identity did not match.');return data.profile;}
  async sync(input){
    const username=profileName(input.profile),profile=await this.getProfile(username),seen=new Set(),accounts=this.vault.state.accounts;
    for(const platform of SOCIAL_PLATFORMS){
      const social=connectedSocial(profile.social_accounts?.[platform]);if(!social)continue;
      const prior=accounts.find(a=>a.provider==='upload-post'&&a.profile===username&&a.platform===platform&&a.remoteId===social.remoteId&&!a.missing);
      const account={...prior,id:prior?.id||randomUUID(),platform,provider:'upload-post',mode:'managed',profile:username,...social,active:!social.reauthRequired,missing:false,verifiedAt:Date.now(),credentials:{}};
      for(const a of accounts)if(a.platform===platform&&account.active)a.active=false;
      if(prior)Object.assign(prior,account);else accounts.push(account);seen.add(account.id);
    }
    for(const account of accounts)if(account.provider==='upload-post'&&account.profile===username&&!seen.has(account.id)){account.active=false;account.missing=true;}
    this.vault.state.publisher.lastSynced=Date.now();await this.vault.save();return this.vault.summary();
  }
  async verify(targets,options={}){
    const selected=this.vault.state.accounts.filter(a=>a.active&&a.provider==='upload-post'&&targets.includes(a.platform));
    const profiles=new Map();for(const a of selected)if(!profiles.has(a.profile))profiles.set(a.profile,await this.getProfile(a.profile));
    for(const account of selected){
      const current=connectedSocial(profiles.get(account.profile).social_accounts?.[account.platform]);
      if(!current||current.remoteId!==account.remoteId||current.reauthRequired){account.missing=!current||current.remoteId!==account.remoteId;account.reauthRequired=true;await this.vault.save();throw new Error(`${PLATFORM_NAMES[account.platform]} account changed or needs sign-in. Reconnect and select it again before publishing.`);}
      account.capabilities=current.capabilities;account.verifiedAt=Date.now();
      if(account.platform==='tiktok'&&options.tiktokPrivacy&&options.tiktokPrivacy!=='PUBLIC_TO_EVERYONE'&&!current.capabilities.includes('video_privacy'))throw new Error('This TikTok connection cannot honor private/friends-only video publishing. Reconnect with privacy support or explicitly select Everyone before uploading.');
    }
    if(selected.length)await this.vault.save();
  }
}

function resultFor(data,platform){return Array.isArray(data.results)?data.results.find(r=>r.platform===platform):data.results?.[platform];}
export function managedResult(data,platform,requestId){
  const result=resultFor(data,platform),common={provider:'upload-post',requestId,id:String(result?.platform_post_id||result?.post_id||result?.video_id||result?.publish_id||requestId)};
  if(result?.fallback_to_inbox)return {...common,status:'action_required',error:'Delivered to TikTok inbox/drafts. Finish posting in TikTok.'};
  if(result?.skipped||result?.success===false||result?.status==='failed'||data.status==='failed')return {...common,status:'failed',error:String(result?.error||data.message||'Provider upload failed. Check the platform before retrying.').slice(0,600)};
  const finished=data.status==='completed'||['completed','published'].includes(result?.status);
  const queued=['queued','pending','processing','in_progress'].includes(result?.status)||/^queued$/i.test(result?.message||'');
  if(result?.success===true&&!queued&&(finished||result.url||result.post_url)){
    let url;try{const parsed=new URL(result.url||result.post_url);if(parsed.protocol==='https:'&&!parsed.username&&!parsed.password)url=parsed.href}catch{}
    return {...common,status:url?'published':'uploaded',...(url?{url}:{})};
  }
  return {...common,status:'processing'};
}
export async function managedStatus(platform,requestId,key,fetcher=fetch){
  if(!SOCIAL_PLATFORMS.includes(platform)||!/^[A-Za-z0-9_-]{1,150}$/.test(requestId))throw new Error('Invalid upload status request.');
  return managedResult(await api(key,'/api/uploadposts/status?request_id='+encodeURIComponent(requestId),{fetcher}),platform,requestId);
}
export async function publishManaged(platform,job,clip,path,options,config,onProgress=()=>{},{uploader=uploadBytes,fetcher=fetch,wait=ms=>new Promise(r=>setTimeout(r,ms)),polls=30}={}){
  const target=config.UPLOAD_POST_TARGETS?.[platform],key=config.UPLOAD_POST_API_KEY;
  if(!key||!target||!SOCIAL_PLATFORMS.includes(platform))throw new Error('Connect this publishing account first.');
  const profile=await api(key,'/api/uploadposts/users/'+encodeURIComponent(profileName(target.profile)),{fetcher});
  const current=connectedSocial(profile.profile?.social_accounts?.[platform]);
  if(profile.profile?.username!==target.profile||!current||current.remoteId!==target.remoteId||current.reauthRequired)throw new Error('The destination account changed or needs sign-in. Reconnect it before uploading.');
  if(platform==='tiktok'&&options.tiktokPrivacy!=='PUBLIC_TO_EVERYONE'&&!current.capabilities.includes('video_privacy'))throw new Error('TikTok cannot honor the selected privacy with this connection.');
  if((await stat(path)).size>256*1024*1024)throw new Error('This local uploader supports exports up to 256 MB. Use a smaller export.');
  const requestId=createHash('sha256').update(`${job.id}:${clip.id}:${platform}:${target.profile}:${target.remoteId}`).digest('hex');
  const details=publicationDetails(clip),form=new FormData(),caption=[details.title,details.description].filter(Boolean).join('\n');
  for(const [name,value]of Object.entries({user:target.profile,'platform[]':platform,title:caption,description:details.description,async_upload:'true',request_id:requestId,external_id:`clipmax:${job.id}:${clip.id}`,youtube_title:details.title,privacyStatus:options.youtubePrivacy||'private',selfDeclaredMadeForKids:String(options.madeForKids===true),instagram_title:caption,tiktok_title:caption,privacy_level:options.tiktokPrivacy||'SELF_ONLY',post_mode:'DIRECT_POST',disable_inbox_fallback:'true'}))form.append(name,value);
  if(platform==='youtube')for(const tag of details.tags)form.append('tags[]',tag);
  form.append('video',new Blob([await readFile(path)],{type:'video/mp4'}),clip.id+'.mp4');
  const request=new Request(API+'/api/upload',{method:'POST',body:form}),bytes=Buffer.from(await request.arrayBuffer());
  onProgress({percent:0,bytes:0,totalBytes:bytes.length,message:'Sending video to Upload-Post'});
  const response=await uploader(API+'/api/upload',{method:'POST',headers:{Authorization:`Apikey ${key}`,'Content-Type':request.headers.get('content-type'),'Idempotency-Key':requestId},body:bytes,onProgress:value=>onProgress({...value,message:'Sending video to Upload-Post'})});
  let data;try{data=await response.json()}catch{throw new Error(`Upload response unreadable. Check provider status before retrying. Request ${requestId}`)}
  if(!response.ok||data.success===false)throw new Error(`Upload-Post (${response.status}): ${String(data.message||data.error||'Upload rejected').replaceAll(key,'[redacted]').slice(0,400)}`);
  let result=managedResult(data,platform,requestId);
  for(let i=0;result.status==='processing'&&i<polls;i++){
    onProgress({percent:null,message:'Upload-Post / platform processing'});await wait(3000);
    try{result=await managedStatus(platform,requestId,key,fetcher)}catch{break}
  }
  return result;
}
