'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');const wait=ms=>new Promise(r=>setTimeout(r,ms));
test('actual server starts from file local model and routes NVIDIA chat plus local PM/Dev without OpenClaw; active work locks switching',async()=>{
 const calls=[];let releasePM,notifyPM;const pmReached=new Promise(r=>notifyPM=r);
 const fixture=http.createServer(async(req,res)=>{
  let raw='';for await(const c of req)raw+=c;const body=raw?JSON.parse(raw):null;calls.push({path:req.url,method:req.method,auth:req.headers.authorization,body});res.setHeader('Content-Type','application/json');
  if(req.url==='/v1/models')return res.end(JSON.stringify({data:[{id:'demo-model'}]}));
  if(req.url==='/v1/chat/completions'){
   assert.equal(body.model,'demo-model');assert(!req.headers['x-openclaw-session-key']);assert(!raw.includes('private-github-key'));
   let text='SUMMARY: Connected\n\nModel fixture answer';
   if(body.messages.some(m=>m.content.includes('You are the PM'))){notifyPM();await new Promise(r=>releasePM=r);text='Create an add module.\nFILE: add.js';}
   if(body.messages.some(m=>m.content.includes('You are a CODE GENERATOR')))text='module.exports={add:(a,b)=>a+b};';
   return res.end(JSON.stringify({choices:[{message:{content:text}}]}));
  }
  if(req.url==='/user')return res.end(JSON.stringify({login:'fixture-user'}));
  if(req.url==='/repos/fixture-user/demo')return res.end(JSON.stringify({owner:{login:'fixture-user'},name:'demo',default_branch:'main',permissions:{push:true}}));
  if(req.url.endsWith('/git/ref/heads/main'))return res.end(JSON.stringify({object:{sha:'fixture-sha'}}));
  if(req.url.endsWith('/pulls'))return res.end(JSON.stringify({html_url:'https://github.com/fixture-user/demo/pull/1',number:1}));res.end('{}');
 });await new Promise(r=>fixture.listen(0,'127.0.0.1',r));const upstream='http://127.0.0.1:'+fixture.address().port;
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'model-server-')),config=path.join(root,'api.json');await fs.writeFile(config,JSON.stringify({github:{token:'private-github-key',owner:'fixture-user',repo:'demo'},models:{active:'local',local:{baseUrl:upstream+'/v1',model:'demo-model'}}}));
 const socket=http.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const child=spawn(process.execPath,['--require',path.resolve(__dirname,'api-fetch-fixture.cjs'),'app/server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PORT:String(port),BAC_API_CONFIG:config,API_FIXTURE_URL:upstream,GATEWAY_URL:'http://127.0.0.1:1',GATEWAY_TOKEN:'',TG_BOT_TOKEN:'',TG_CHAT_ID:'',AGENTMAIL_API_KEY:'',AGENTMAIL_INBOX_ID:''},stdio:'ignore'});
 const base='http://127.0.0.1:'+port,post=(route,body,extra={})=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...extra},body:JSON.stringify(body)}),get=async route=>(await fetch(base+route)).json();
 try{
  let state;for(let i=0;i<100;i++){try{state=await get('/api/showcase/status');if(state.ai?.configured&&state.github?.connected)break;}catch{}await wait(30);}assert(state.ai.configured);assert.equal(state.ai.provider,'local');assert.equal(state.team.configured,true);assert(!state.gateway.configured);assert(calls.filter(c=>c.path==='/v1/chat/completions').length===0);
  assert.equal((await post('/api/integrations/models',{active:'gateway'},{Origin:'https://other.example'})).status,403);
  const connected=await post('/api/integrations/models',{provider:'nvidia',apiKey:'private-nvidia-key',model:'demo-model'});assert.equal(connected.status,200);assert(!(await connected.text()).includes('private-nvidia-key'));
  const started=await (await post('/api/tasks',{agent:'sysmon',messages:[{role:'user',content:'시스템 상태 알려줘'}]})).json();let reply;for(let i=0;i<100;i++){reply=await get('/api/tasks/'+started.jobId);if(reply.status==='done')break;await wait(20);}assert.equal(reply.reply,'Model fixture answer');assert.equal(calls.filter(c=>c.path==='/v1/chat/completions').at(-1).auth,'Bearer private-nvidia-key');
  assert.equal((await post('/api/integrations/models',{active:'local'})).status,200);
  const team=await post('/api/team/jobs',{requestId:'direct-model-team-12345',messages:[{role:'user',content:'Create an add module.'}]});assert.equal(team.status,202);const job=await team.json();await pmReached;
  assert.equal((await post('/api/integrations/models',{active:'nvidia'})).status,409);releasePM();let done;for(let i=0;i<100;i++){done=await get('/api/team/jobs/'+job.jobId);if(done.status==='done')break;await wait(20);}assert(done.stages.some(s=>s.prNum===1));assert(calls.filter(c=>c.path==='/v1/chat/completions').slice(-2).every(c=>!c.auth));assert.equal(calls.filter(c=>c.method!=='GET'&&c.path.startsWith('/repos/')).length,3);
  assert(!JSON.stringify(await get('/api/showcase/status')).includes('private-nvidia-key'));const saved=JSON.parse(await fs.readFile(config,'utf8'));assert.equal(saved.models.active,'local');assert.equal(saved.models.nvidia.apiKey,'private-nvidia-key');assert.equal(saved.github.token,'private-github-key');assert.equal((await fs.stat(config)).mode&0o777,0o600);
 }finally{releasePM?.();child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));fixture.closeAllConnections();await new Promise(r=>fixture.close(r));await fs.rm(root,{recursive:true,force:true});}
});
