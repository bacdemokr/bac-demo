'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {GitHubConnection}=require('../app/github-connection');
const {githubCommand}=require('../app/github-chat');
const {createShowcase}=require('../app/showcase-api');
const http=require('node:http');
const response=(data,status=200)=>new Response(status===204?null:JSON.stringify(data),{status});
const names=['bac-demo','ai-studio','bac-snu-demo','ARC-AGI','dynamo'];
const rows=names.map((name,i)=>({id:i+1,name,owner:{login:'demo-user'},fork:i>=3,default_branch:'main',permissions:{admin:true,push:true}}));
function fixture(calls,{deny=false,changed=false}={}){return async(url,options)=>{const u=new URL(url);calls.push({path:u.pathname,method:options.method,query:u.search});if(u.pathname==='/user')return response({login:'demo-user'});if(u.pathname==='/user/repos')return response(rows);if(options.method==='DELETE')return response({message:'private-credential'},deny?403:204);const repo=rows.find(r=>u.pathname==='/repos/demo-user/'+r.name);return response({...repo,id:changed?999:repo?.id,parent:{full_name:'source-user/'+repo?.name}});};}
async function connected(options={}){const calls=[],g=new GitHubConnection({fetcher:fixture(calls,options)});await g.configure({token:'private-credential',owner:'demo-user',repo:'dynamo'});return {g,calls};}
test('selected target stays separate from all owned repositories and list chat uses the complete authoritative inventory without AI',async()=>{
 const {g,calls}=await connected();const inventory=await g.ownedRepositories();assert.equal(inventory.repositories.length,5);assert.equal(g.public().repo,'dynamo');assert(calls.some(c=>c.path==='/user/repos'&&c.query.includes('affiliation=owner')));
 const result=await githubCommand(g,[{role:'user',content:'내 GitHub 저장소 목록을 보여줘'}]);assert(result.reply.includes('저장소 5개'));for(const name of names)assert(result.reply.includes('demo-user/'+name));assert.equal(result.githubAction,undefined);assert(!JSON.stringify(result).includes('private-credential'));assert(calls.every(c=>c.method==='GET'));
});
test('owned inventory paginates and includes forks/private records while excluding another owner and duplicate records',async()=>{
 const {g}=await connected();const pages=[];g.fetcher=async url=>{const page=Number(new URL(url).searchParams.get('page'));pages.push(page);return response(page===1?Array.from({length:100},(_,i)=>({id:i,name:'repo-'+i,owner:{login:'demo-user'},private:i===0,fork:i===1})):[{name:'repo-100',owner:{login:'demo-user'}},{name:'repo-0',owner:{login:'demo-user'}},{name:'foreign',owner:{login:'other'}}]);};
 const data=await g.ownedRepositories();assert.deepEqual(pages,[1,2]);assert.equal(data.repositories.length,101);assert(data.repositories[0].private);assert(data.repositories[1].fork);assert(!data.truncated);
});
test('delete chat resolves exact named fork ignoring the selected dynamo; preview is GET-only and other/ambiguous/source requests are rejected',async()=>{
 const {g,calls}=await connected();const result=await githubCommand(g,[{role:'assistant',content:'Selected dynamo'},{role:'user',content:'fork한 arc-agi 삭제해줘'}]);assert.equal(result.githubAction.preview.repository,'demo-user/ARC-AGI');assert(calls.every(c=>c.method==='GET'));
 for(const text of ['이 저장소 삭제해줘','ARC-AGI와 dynamo 삭제해줘','source-user/ARC-AGI 삭제해줘','bac-demo 삭제해줘'])await assert.rejects(githubCommand(g,[{role:'user',content:text}]));
 assert.equal(await githubCommand(g,[{role:'user',content:'ARC-AGI 삭제하지 마'}]),null);assert.equal(g.public().repo,'dynamo');
});
test('only exact confirmation and revalidated identity allow a single DELETE204; deleting selected fork resets target without changing credentials',async()=>{
 const {g,calls}=await connected();const p=await g.prepareDelete('demo-user/dynamo');await assert.rejects(g.deleteFork({id:p.id,confirmation:'dynamo'}));assert(calls.every(c=>c.method==='GET'));const result=await g.deleteFork({id:p.id,confirmation:p.repository});assert(result.deleted);assert.equal(calls.filter(c=>c.method==='DELETE').length,1);assert.equal(g.public().repo,'');assert(g.public().connected);assert.equal(g.requireConnection().token,'private-credential');await assert.rejects(g.deleteFork({id:p.id,confirmation:p.repository}));assert.equal(calls.filter(c=>c.method==='DELETE').length,1);
});
test('stale preview, changed repository identity and active work prevent deletion; permission errors preserve target and never imply success',async()=>{
 for(const scenario of ['stale','changed','busy','denied']){const {g,calls}=await connected();const p=await g.prepareDelete('demo-user/ARC-AGI');if(scenario==='stale')await g.configure({token:'new-private',owner:'demo-user',repo:'dynamo'});if(scenario==='changed')g.fetcher=fixture(calls,{changed:true});if(scenario==='busy')g.canConfigure=()=>false;if(scenario==='denied')g.fetcher=fixture(calls,{deny:true});await assert.rejects(g.deleteFork({id:p.id,confirmation:p.repository}),e=>!e.message.includes('private-credential')&&(scenario!=='denied'||e.message.includes('Administration')));assert.equal(g.public().repo,'dynamo');assert(!g.public().deleting);assert.equal(calls.filter(c=>c.method==='DELETE').length,scenario==='denied'?1:0);}
});
test('HTTP delete endpoints reject GET/cross-origin/missing confirmation and preview never deletes',async()=>{
 const {g,calls}=await connected(),app=createShowcase({github:g}),server=http.createServer(async(req,res)=>{if(!await app.handle(req,res)){res.writeHead(404);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const post=(route,body,extra={})=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...extra},body:JSON.stringify(body)});
 try{assert.equal((await fetch(base+'/api/integrations/github/delete')).status,404);assert.equal((await post('/api/integrations/github/delete-preview',{repository:'demo-user/ARC-AGI'},{Origin:'https://other.example'})).status,403);const p=await(await post('/api/integrations/github/delete-preview',{repository:'demo-user/ARC-AGI'})).json();assert.equal(p.repository,'demo-user/ARC-AGI');assert(calls.every(c=>c.method==='GET'));assert.equal((await post('/api/integrations/github/delete',{id:p.id})).status,400);assert(calls.every(c=>c.method==='GET'));}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('restart restores only nonsecret selected target metadata for the same verified account',async t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),root=fs.mkdtempSync(path.join(os.tmpdir(),'github-target-')),targetFile=path.join(root,'target.json');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const g=new GitHubConnection({targetFile,fetcher:fixture([])});await g.configure({token:'private-credential',owner:'demo-user',repo:'dynamo'});const raw=fs.readFileSync(targetFile,'utf8');assert(!raw.includes('private-credential'));
 const restarted=new GitHubConnection({token:'private-credential',source:'config',targetFile,fetcher:fixture([])});await restarted.start();assert.equal(restarted.public().repo,'dynamo');assert.equal(restarted.public().source,'config');assert.equal((await restarted.ownedRepositories()).repositories.length,5);
 const p=await restarted.prepareDelete('demo-user/dynamo');await restarted.deleteFork({id:p.id,confirmation:p.repository});assert.deepEqual(JSON.parse(fs.readFileSync(targetFile,'utf8')),{});
});
