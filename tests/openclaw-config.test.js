'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {resolveOpenClaw}=require('../app/openclaw-config');
async function fixture(fn){const root=await fs.mkdtemp(path.join(os.tmpdir(),'claw-autoconfig-'));try{await fn(root);}finally{await fs.rm(root,{recursive:true,force:true});}}
test('JSON5 config supplies token, custom port and actual agent IDs without a UI step',()=>fixture(async root=>{
  const file=path.join(root,'openclaw.json');await fs.writeFile(file,"{gateway:{port:18890,auth:{token:'fixture-private'}},agents:{entries:{'demo-host':{default:true},git:{}}},}");
  const result=await resolveOpenClaw({env:{OPENCLAW_CONFIG_PATH:file},appDir:root,home:root,discover:async()=>{throw Error('Explicit config must not scan');}});
  assert.equal(result.url,'http://127.0.0.1:18890');assert.equal(result.token,'fixture-private');assert.equal(result.agent,'demo-host');assert.deepEqual(result.agents,{bac:'demo-host',git:'git',pm:'demo-host',dev:'demo-host'});
  assert.deepEqual(await fs.readdir(root),['openclaw.json']);
}));
test('Active listener config beats stale home config and its path survives a later restart',()=>fixture(async root=>{
  const file=path.join(root,'active.json'),standard=path.join(root,'.openclaw');await fs.mkdir(standard);
  await fs.writeFile(file,JSON.stringify({gateway:{auth:{token:'active-private'}},agents:{list:[{id:'host',default:true}]}}));
  await fs.writeFile(path.join(standard,'openclaw.json'),JSON.stringify({gateway:{auth:{token:'stale-private'}}}));
  const first=await resolveOpenClaw({env:{},appDir:root,home:root,discover:async()=>[file]});assert.equal(first.token,'active-private');assert.equal(first.agents.git,null);
  const cache=await fs.readFile(path.join(root,'.openclaw-path'),'utf8');assert.equal(cache,file+'\n');assert(!cache.includes('active-private'));
  const restarted=await resolveOpenClaw({env:{},appDir:root,home:root,discover:async()=>[]});assert.equal(restarted.token,'active-private');assert.equal(restarted.agent,'host');
}));
test('Explicit remote destination never receives an automatically discovered local token',()=>fixture(async root=>{
  const file=path.join(root,'openclaw.json');await fs.writeFile(file,JSON.stringify({gateway:{auth:{token:'local-private'}}}));
  let scans=0;const result=await resolveOpenClaw({env:{GATEWAY_URL:'https://remote.example:18789'},appDir:root,home:root,discover:async()=>{scans++;return[file];}});
  assert.equal(result.token,'');assert.equal(scans,0);assert(result.error);
  const mismatch=await resolveOpenClaw({env:{OPENCLAW_CONFIG_PATH:file,GATEWAY_URL:'http://127.0.0.1:19999'},appDir:root,home:root});assert.equal(mismatch.token,'');
}));
test('Explicit environment credentials keep compatibility and skip unrelated local discovery',()=>fixture(async root=>{
  const result=await resolveOpenClaw({env:{GATEWAY_URL:'https://own.example',GATEWAY_TOKEN:'explicit-private',GATEWAY_AGENT:'my-agent'},appDir:root,home:root,discover:async()=>{throw Error('Do not scan');}});
  assert.equal(result.token,'explicit-private');assert.equal(result.agent,'my-agent');assert.equal(result.url,'https://own.example');
  const missing=await resolveOpenClaw({env:{OPENCLAW_CONFIG_PATH:path.join(root,'missing.json')},appDir:root,home:root});assert.equal(missing.token,'');assert(missing.error);
}));
test('Explicit fleets use the configured system agent instead of an arbitrary worker',()=>fixture(async root=>{
  const file=path.join(root,'openclaw.json'),config={gateway:{auth:{token:'fleet-private'}},agents:{ownership:'explicit',defaults:{systemAgent:{agentId:'actual-host'}},entries:{'worker-first':{},'actual-host':{}}}};
  await fs.writeFile(file,JSON.stringify(config));
  const result=await resolveOpenClaw({env:{OPENCLAW_CONFIG_PATH:file},appDir:root,home:root});assert.equal(result.agent,'actual-host');
  delete config.agents.defaults;await fs.writeFile(file,JSON.stringify(config));
  const ambiguous=await resolveOpenClaw({env:{OPENCLAW_CONFIG_PATH:file},appDir:root,home:root});assert.equal(ambiguous.token,'');assert(ambiguous.error);
}));
