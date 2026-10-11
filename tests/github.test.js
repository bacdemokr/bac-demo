'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {GitHubConnection,loadGitHubCredential}=require('../app/github-connection');
const {createShowcase}=require('../app/showcase-api');
const answer=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const first='fixture_first_private_token',second='fixture_second_private_token';
function fixture(calls){return async(url,options)=>{calls.push({url,options});if(url.endsWith('/user'))return answer({login:'demo-user'});const [owner,name]=new URL(url).pathname.split('/').slice(2);return answer({owner:{login:owner},name,default_branch:'trunk',permissions:{push:true}});};}

test('runtime GitHub connection verifies account and selected repository through GET only, without exposing its token',async()=>{
 const calls=[],g=new GitHubConnection({fetcher:fixture(calls)});
 const result=await g.configure({token:first,owner:'demo-user',repo:'demo-repo'});
 assert(result.connected);assert.equal(result.source,'runtime');assert.equal(result.defaultBranch,'trunk');assert.equal(calls.length,2);
 assert(calls.every(c=>c.options.method==='GET'&&c.options.redirect==='error'));assert.equal(calls[1].url,'https://api.github.com/repos/demo-user/demo-repo');
 assert(!JSON.stringify(result).includes(first));assert(!JSON.stringify(g.public()).includes(first));
 const restart=new GitHubConnection();assert.equal(restart.public().configured,false);
 await g.configure({disconnect:true});assert.equal(g.public().configured,false);assert.throws(()=>g.requireConnection(),e=>e.status===409);
});
test('file and environment credentials still load at startup, and runtime changes leave the file untouched',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'github-settings-'));try{
  const file=path.join(root,'.gh_token');await fs.writeFile(file,first+'\n');
  const loaded=loadGitHubCredential({appDir:root,env:{GITHUB_TOKEN:second},legacyFile:path.join(root,'none')});assert.equal(loaded.source,'file');assert.equal(loaded.token,first);
  const g=new GitHubConnection({...loaded,fetcher:fixture([])});await g.start();assert.equal(g.public().connected,true);assert.equal(g.public().source,'file');
  await g.configure({token:second,owner:'other',repo:'new-repo'});assert.equal(g.public().source,'runtime');assert.equal(await fs.readFile(file,'utf8'),first+'\n');
  await g.configure({disconnect:true});assert.equal(await fs.readFile(file,'utf8'),first+'\n');
  const restarted=new GitHubConnection({...loadGitHubCredential({appDir:root,env:{},legacyFile:path.join(root,'none')}),fetcher:fixture([])});await restarted.start();assert.equal(restarted.requireConnection().token,first);
  await fs.unlink(file);assert.equal(loadGitHubCredential({appDir:root,env:{GITHUB_TOKEN:second},legacyFile:path.join(root,'none')}).source,'environment');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('failed replacement keeps the working GitHub connection, and provider failures never echo secrets',async()=>{
 const g=new GitHubConnection({fetcher:fixture([])});await g.configure({token:first,owner:'demo-user',repo:'demo'});
 g.fetcher=async()=>answer({message:second},401);await assert.rejects(g.configure({token:second,owner:'other',repo:'demo'}),e=>!e.message.includes(second)&&e.status===502);
 assert.equal(g.requireConnection().token,first);assert.equal(g.public().owner,'demo-user');
 g.fetcher=async()=>{throw Error(second);};await assert.rejects(g.configure({token:second,owner:'other',repo:'demo'}),e=>!e.message.includes(second));
});
test('disconnect and newer settings beat pending GitHub verification; active collaboration blocks changes',async()=>{
 let release;const g=new GitHubConnection({fetcher:async(url)=>url.endsWith('/user')?new Promise(r=>release=()=>r(answer({login:'demo-user'}))):answer({owner:{login:'demo-user'},name:'demo',default_branch:'main'})});
 const pending=g.configure({token:first,owner:'demo-user',repo:'demo'});await g.configure({disconnect:true});release();await assert.rejects(pending,e=>e.status===409);assert.equal(g.public().connected,false);
 let active=false;const locked=new GitHubConnection({fetcher:fixture([]),canConfigure:()=>!active});await locked.configure({token:first,owner:'demo-user',repo:'demo'});active=true;
 await assert.rejects(locked.configure({disconnect:true}),e=>e.status===409);assert.equal(locked.requireConnection().token,first);
});
test('GitHub rejects header injection, invalid targets and empty repositories; read-only repositories stay identifiable',async()=>{
 const calls=[],g=new GitHubConnection({fetcher:fixture(calls)});
 for(const body of [{token:'bad\nheader',owner:'x',repo:'x'},{token:first,owner:'x/y',repo:'x'},{token:first,owner:'x',repo:'..'}])await assert.rejects(g.configure(body),e=>e.status===400);
 assert.equal(calls.length,0);
 g.fetcher=async url=>answer(url.endsWith('/user')?{login:'demo-user'}:{owner:{login:'demo-user'},name:'demo',default_branch:null});
 await assert.rejects(g.configure({token:first,owner:'demo-user',repo:'demo'}),e=>e.status===409);
 g.fetcher=async url=>answer(url.endsWith('/user')?{login:'demo-user'}:{owner:{login:'demo-user'},name:'demo',default_branch:'main',permissions:{push:false}});
 await g.configure({token:first,owner:'demo-user',repo:'demo'});assert.equal(g.public().connected,true);assert.equal(g.public().canWrite,false);
});
test('runtime GitHub HTTP endpoint accepts same-origin POST, returns masked status, and rejects cross-origin mutations',async()=>{
 const calls=[],app=createShowcase({fetcher:fixture(calls)}),server=http.createServer(async(req,res)=>{if(!await app.handle(req,res)){res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,body={token:first,owner:'demo-user',repo:'demo'};
 try{
  const headers={'Content-Type':'application/json'};
  assert.equal((await fetch(base+'/api/integrations/github',{method:'POST',headers:{...headers,Origin:'https://other.example'},body:JSON.stringify(body)})).status,403);assert.equal(calls.length,0);
  const connected=await fetch(base+'/api/integrations/github',{method:'POST',headers,body:JSON.stringify(body)});assert.equal(connected.status,200);assert(!(await connected.text()).includes(first));
  const state=await (await fetch(base+'/api/integrations/github')).json();assert(state.connected);assert.equal(calls.length,2);
  const oversized=await fetch(base+'/api/integrations/github',{method:'POST',headers,body:JSON.stringify({...body,token:'x'.repeat(45000)})});assert.equal(oversized.status,413);
  await fetch(base+'/api/integrations/github',{method:'POST',headers,body:JSON.stringify({disconnect:true})});assert.equal(app.github.public().configured,false);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
