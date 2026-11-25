import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('release version matches the app while dependency versions match their locked tarballs',async()=>{
 const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 const lock=JSON.parse(await readFile(new URL('../package-lock.json',import.meta.url),'utf8'));
 assert.equal(lock.version,pkg.version);assert.equal(lock.packages[''].version,pkg.version);
 for(const [name,value]of Object.entries(lock.packages)){
  if(value.resolved?.startsWith('https://registry.npmjs.org/')&&value.resolved.endsWith('.tgz'))assert.ok(decodeURIComponent(new URL(value.resolved).pathname).endsWith('-'+value.version+'.tgz'),`${name}: declared version does not match its locked tarball`);
 }
});
