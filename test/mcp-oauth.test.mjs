import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { Connections } from '../lib/connections.mjs';
import { AppMcp } from '../lib/mcp.mjs';

test('real MCP SDK refreshes encrypted saved authorization after restart on a different port', async () => {
  const home=await mkdtemp(join(tmpdir(),'clipmax-mcp-oauth-')),key=randomBytes(32).toString('base64');
  try {
    const vault=new Connections(home,key);
    const original=new AppMcp(vault,'http://127.0.0.1:12345');
    const provider=original.provider('descript',{});
    await provider.saveClientInformation({client_id:'fixture-client',issuer:'https://auth.example.com'});
    await provider.saveTokens({access_token:'expired-fixture-access',refresh_token:'fixture-refresh',token_type:'Bearer',issuer:'https://auth.example.com'});
    await provider.saveDiscoveryState({authorizationServerUrl:'https://auth.example.com',resourceMetadata:{resource:'https://api.descript.com/v2/mcp'},authorizationServerMetadata:{issuer:'https://auth.example.com',authorization_endpoint:'https://auth.example.com/authorize',token_endpoint:'https://auth.example.com/token',response_types_supported:['code'],token_endpoint_auth_methods_supported:['none']}});
    const restored=new Connections(home,key);await restored.load();
    const session={};const manager=new AppMcp(restored,'http://127.0.0.1:23456');
    let requests=0;
    const result=await auth(manager.provider('descript',session),{serverUrl:'https://api.descript.com/v2/mcp',fetchFn:async(url,init)=>{
      requests++;
      assert.equal(String(url),'https://auth.example.com/token');
      const body=new URLSearchParams(init.body);
      assert.equal(body.get('client_id'),'fixture-client');
      assert.equal(body.get('grant_type'),'refresh_token');
      assert.equal(body.get('refresh_token'),'fixture-refresh');
      return Response.json({access_token:'renewed-fixture-access',token_type:'Bearer',expires_in:3600});
    }});
    assert.equal(result,'AUTHORIZED');assert.equal(requests,1);assert.equal(session.authUrl,undefined);
    const reread=new Connections(home,key);await reread.load();
    assert.equal(reread.state.mcp.descript.tokens.access_token,'renewed-fixture-access');
    assert.equal(reread.state.mcp.descript.tokens.refresh_token,'fixture-refresh');
    assert.equal(reread.state.mcp.descript.redirect,'http://127.0.0.1:12345/oauth/mcp/descript');
    assert.ok(!(await readFile(join(home,'connections.enc'),'utf8')).includes('fixture-refresh'));
  }finally{await rm(home,{recursive:true,force:true});}
});
