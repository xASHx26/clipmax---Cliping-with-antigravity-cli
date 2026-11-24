const {app,BrowserWindow}=require('electron');
const {createServer}=require('node:http');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const assert=require('node:assert/strict');
const root=join(__dirname,'..');
let publisher={configured:false,profiles:[]},lastToken,opened=[],accounts=[];
const server=createServer(async(req,res)=>{
 const json=(data,code=200)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
 let body='';for await(const chunk of req)body+=chunk;
 if(req.url==='/api/status')return json({downloader:true,connections:Object.fromEntries(accounts.map(a=>[a.platform,true])),accounts:{persistent:true,accounts,oauthReady:{}},publisher});
 if(req.url==='/api/jobs')return json([]);
 if(req.url==='/api/connections'){lastToken=JSON.parse(body);accounts=[{id:'ig-direct',platform:'instagram',name:'Test professional account',active:true,mode:'api'}];return json({accounts},201);}
 if(req.url==='/api/publisher/configure'){assert.equal(JSON.parse(body).apiKey,'fixture-key-only');publisher={configured:true,profiles:[{username:'studio',name:'Studio'}],plan:'fixture'};return json(publisher);}
 if(req.url==='/api/publisher/connect')return json({url:'https://app.upload-post.com/connect?token=fixture'});
 if(req.url==='/api/publisher/sync'){accounts.push({id:'linkedin-managed',platform:'linkedin',name:'Test member',active:true,mode:'managed',provider:'upload-post',profile:'studio'});return json({accounts});}
 const paths={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/workflow.js':'workflow.js','/workflow.css':'workflow.css'};
 if(!paths[req.url])return json({},404);
 res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':req.url.endsWith('.css')?'text/css':'text/html');res.end(readFileSync(join(root,'public',paths[req.url])));
});
app.whenReady().then(async()=>{
 let win,code=0;const errors=[];
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  win=new BrowserWindow({show:false,width:1280,height:1000,webPreferences:{offscreen:true,contextIsolation:true}});
  win.webContents.on('console-message',(_event,level,message)=>{if(level>=3)errors.push(message)});
  await win.loadURL('http://127.0.0.1:'+server.address().port);await new Promise(r=>setTimeout(r,200));
  const js=code=>win.webContents.executeJavaScript(code);
  await js(`window.openedAuth=[];window.clipmaxDesktop={openAuth:async url=>window.openedAuth.push(url)};document.getElementById('add-connection-button').click()`);
  await new Promise(r=>setTimeout(r,100));
  assert.equal(await js(`document.getElementById('connection-method').value`),'oauth');
  assert.equal(await js(`document.getElementById('managed-fields').hidden`),true);
  assert.equal(await js(`document.getElementById('google-client-file-field').hidden`),false);
  await js(`document.getElementById('connection-platform').value='instagram';document.getElementById('connection-platform').dispatchEvent(new Event('change'))`);
  assert.equal(await js(`document.getElementById('connection-method').value`),'token');
  assert.equal(await js(`document.getElementById('media-url-field').hidden`),true);
  assert.equal(await js(`document.getElementById('connection-id-label').textContent`),'Instagram professional account ID');
  await js(`document.getElementById('connection-token').value='fixture-meta-token';document.getElementById('connection-account-id').value='12345';document.getElementById('connection-form').requestSubmit()`);
  await new Promise(r=>setTimeout(r,100));assert.equal(lastToken.instagramLogin,'facebook');assert.equal(lastToken.accountId,'12345');
  await js(`document.getElementById('new-connection').click()`);await new Promise(r=>setTimeout(r,100));
  await js(`document.getElementById('connection-method').value='managed';document.getElementById('connection-method').dispatchEvent(new Event('change'));document.getElementById('publisher-key').value='fixture-key-only';document.getElementById('publisher-save').click()`);
  await new Promise(r=>setTimeout(r,100));assert.equal(await js(`document.getElementById('publisher-key').value`),'');
  assert.equal(await js(`document.getElementById('publisher-profile').value`),'studio');
  await js(`document.getElementById('connection-form').requestSubmit()`);await new Promise(r=>setTimeout(r,100));
  assert.match((await js(`window.openedAuth`))[0],/^https:\/\/app.upload-post.com\/connect/);assert.equal(accounts.length,1);
  await js(`document.getElementById('publisher-sync').click()`);await new Promise(r=>setTimeout(r,100));
  assert.equal(await js(`document.querySelector('[name=auto-platform][value=linkedin]').disabled`),false);
  assert.equal(await js(`document.querySelector('[name=auto-platform][value=tiktok]').disabled`),true);
  assert.ok(!(await js(`document.getElementById('connection-list').innerHTML`)).includes('fixture-key-only'));
  assert.deepEqual(errors,[]);console.log('PASS: Free direct sign-in is default, Instagram direct-file setup is usable, managed credentials stay hidden, sign-in alone never creates a verified account, and synced accounts enable auto-upload.');
 }catch(error){console.error(error);code=1}finally{win?.destroy();server.close();app.exit(code)}
});
