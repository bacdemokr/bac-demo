'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {ModelConnections}=require('../app/model-connections');
const {loadAPIConfig}=require('../app/api-config');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const reply=text=>new Response(JSON.stringify({choices:[{message:{content:text}}]}),{headers:{'Content-Type':'application/json'}});
function fixture(calls){return async(url,options)=>{calls.push({url,options});return url.endsWith('/models')?new Response(JSON.stringify({data:[{id:'demo-model'}]})):reply('SUMMARY: Ready\n\nActual response');};}
test('local and NVIDIA connections keep separate credentials, verify inference, switch explicitly and send actual model IDs without OpenClaw headers',async()=>{
 const calls=[],m=new ModelConnections({fetcher:fixture(calls)});
 await m.configure({provider:'local',baseUrl:'http://127.0.0.1:8001/v1',model:'demo-model'});assert(m.ready());assert.equal(m.active,'local');assert(!calls[0].options.headers.Authorization);
 await m.configure({provider:'nvidia',model:'demo-model',apiKey:'private-model-key'});assert.equal(m.active,'nvidia');assert(m.public().profiles.local.connected);assert(!JSON.stringify(m.public()).includes('private-model-key'));
 const snap=m.snapshot();const result=await m.complete(snap,[{role:'user',content:'actual request'}]);assert.equal(result.reply,'Actual response');const request=calls.at(-1);assert.equal(request.url,'https://inference-api.nvidia.com/v1/chat/completions');assert.equal(request.options.headers.Authorization,'Bearer private-model-key');assert.equal(JSON.parse(request.options.body).model,'demo-model');assert(!request.options.headers['x-openclaw-session-key']);
 await m.configure({active:'local'});assert.equal(m.snapshot().provider,'local');await m.configure({active:'gateway'});assert(!m.ready());assert.equal(m.public().active,'gateway');
});
test('bad model, failed inference and secret-bearing HTML errors preserve existing connection; keys cannot transfer across NVIDIA endpoints',async()=>{
 const m=new ModelConnections({fetcher:fixture([])});await m.configure({provider:'nvidia',model:'demo-model',apiKey:'private-key'});
 await assert.rejects(m.configure({provider:'nvidia',baseUrl:'https://integrate.api.nvidia.com/v1',model:'demo-model'}),e=>/키/.test(e.message));
 await assert.rejects(m.configure({provider:'nvidia',baseUrl:'https://evil.example/v1',apiKey:'private-key',model:'demo-model'}));
 await assert.rejects(m.configure({provider:'nvidia',model:'missing'}));assert.equal(m.public().profiles.nvidia.model,'demo-model');
 m.fetcher=async url=>url.endsWith('/models')?new Response(JSON.stringify({data:[{id:'demo-model'}]})):new Response('private-key',{status:403});
 await assert.rejects(m.configure({provider:'nvidia',model:'demo-model',apiKey:'new-private-key'}),e=>!e.message.includes('private-key'));assert.equal(m.snapshot().apiKey,'private-key');
});
test('work locks model changes before and after verification and newer selection wins a pending connection',async()=>{
 let locked=false,release;const m=new ModelConnections({fetcher:fixture([]),canConfigure:()=>!locked});await m.configure({provider:'local',model:'demo-model'});locked=true;await assert.rejects(m.configure({active:'gateway'}),e=>e.status===409);locked=false;
 m.fetcher=async()=>new Promise(r=>release=()=>r(new Response(JSON.stringify({data:[{id:'demo-model'}]}))));const pending=m.configure({provider:'local',model:'demo-model'});await m.configure({active:'gateway'});m.fetcher=fixture([]);release();await assert.rejects(pending,e=>e.status===409);assert.equal(m.active,'gateway');
});
test('file startup verifies models without inference and keeps unverified selected providers from silently falling back',async()=>{
 const calls=[],m=new ModelConnections({config:{active:'local',local:{model:'demo-model'}},fetcher:fixture(calls)});assert(!m.ready());await m.start();assert(m.ready());assert(calls.every(c=>c.options.method==='GET'));assert.equal(m.public().profiles.local.source,'config');
 const failed=new ModelConnections({config:{active:'local',local:{model:'demo-model'}},fetcher:async()=>new Response('secret-error',{status:503})});await failed.start();assert(!failed.ready());assert.equal(failed.active,'local');assert(!JSON.stringify(failed.public()).includes('secret-error'));
});
test('unified model configuration validates endpoints, required active models and unknown fields without echoing secrets',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'model-config-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const file=path.join(root,'api.json');
 fs.writeFileSync(file,JSON.stringify({models:{active:'local',local:{baseUrl:'http://127.0.0.1:8001/v1',model:'demo-model'},nvidia:{baseUrl:'https://inference-api.nvidia.com/v1',model:'demo-model',apiKey:'file-secret'}}}));assert.equal(loadAPIConfig({root,env:{}}).models.active,'local');
 for(const models of [{active:'bad'},{active:'local'},{nvidia:{model:'demo-model'}},{nvidia:{apiKey:'file-secret',baseUrl:'https://evil.example/v1'}},{local:{extra:'file-secret'}}]){fs.writeFileSync(file,JSON.stringify({models}));assert.throws(()=>loadAPIConfig({root,env:{}}),e=>!e.message.includes('file-secret'));}
});

test('saved model selection survives restart and save failures preserve the active provider',async t=>{
 const {saveModels}=require('../app/api-config');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'model-persist-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const m=new ModelConnections({fetcher:fixture([]),persist:models=>saveModels(models,{root,env:{}})});
 await m.configure({provider:'nvidia',model:'demo-model',apiKey:'private-key'});
 const restarted=new ModelConnections({config:loadAPIConfig({root,env:{}}).models,fetcher:fixture([])});await restarted.start();
 assert.equal(restarted.active,'nvidia');assert(restarted.ready());assert.equal(restarted.snapshot().apiKey,'private-key');
 m.persist=()=>{throw Error('secret path');};await assert.rejects(m.configure({active:'gateway'}),e=>e.status===500&&!e.message.includes('secret path'));assert.equal(m.active,'nvidia');
});
