'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),path=require('node:path'),fs=require('node:fs/promises'),os=require('node:os');
const {spawn}=require('node:child_process');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function freePort(){const s=http.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
test('actual app uses runtime credentials and target immediately for read-only chat and a fixture PR, blocking changes during collaboration',async()=>{
 const token='runtime_fixture_private_token',calls=[];let releasePM,pmWaiting;
 const reachedPM=new Promise(r=>pmWaiting=r);
 const provider=http.createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;calls.push({method:req.method,path:req.url,auth:req.headers.authorization,body:raw?JSON.parse(raw):null});
  res.setHeader('Content-Type','application/json');
  if(req.url==='/user')return res.end(JSON.stringify({login:'fixture-user'}));
  if(req.url==='/repos/runtime-owner/runtime-repo')return res.end(JSON.stringify({owner:{login:'runtime-owner'},name:'runtime-repo',description:'Verified runtime repository.',default_branch:'trunk',permissions:{push:true}}));
  if(req.url.endsWith('/git/ref/heads/trunk'))return res.end(JSON.stringify({object:{sha:'fixture-sha'}}));
  if(req.url.endsWith('/pulls'))return res.end(JSON.stringify({html_url:'https://github.com/runtime-owner/runtime-repo/pull/7',number:7}));
  res.end(JSON.stringify({ok:true}));
 });
 const gateway=http.createServer(async(req,res)=>{
  if(req.url==='/health')return res.end('ok');
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw),messages=body.messages;
  assert(!raw.includes(token),'Runtime token must never be sent to the language model.');
  let reply='SUMMARY: 저장소\n\nVerified runtime repository.';
  if(messages.some(m=>m.content.includes('You are the PM'))){pmWaiting();await new Promise(r=>releasePM=r);reply='Implement one module.\nFILE: runtime-demo.js';}
  if(messages.some(m=>m.content.includes('You are a CODE GENERATOR')))reply='// demo\nmodule.exports = { add: (a,b) => a+b };';
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:reply}}]}));
 });
 await new Promise(r=>provider.listen(0,'127.0.0.1',r));await new Promise(r=>gateway.listen(0,'127.0.0.1',r));
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'runtime-github-')),config=path.join(root,'openclaw.json');
 await fs.writeFile(config,JSON.stringify({gateway:{port:gateway.address().port,auth:{token:'gateway-fixture'}},agents:{entries:[{id:'fixture-host',default:true}]}}));
 const port=await freePort(),base='http://127.0.0.1:'+port;
 const child=spawn(process.execPath,['--require',path.resolve(__dirname,'github-fetch-fixture.cjs'),'app/server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PORT:String(port),OPENCLAW_CONFIG_PATH:config,GATEWAY_URL:'',GATEWAY_TOKEN:'',GITHUB_TOKEN:'',GH_OWNER:'default-owner',GH_REPO:'default-repo',GITHUB_FIXTURE_URL:'http://127.0.0.1:'+provider.address().port,TG_BOT_TOKEN:'',TG_CHAT_ID:'',AGENTMAIL_API_KEY:'',AGENTMAIL_INBOX_ID:''},stdio:'ignore'});
 const post=(route,data)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 try{
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/agents')).ok)break;}catch{}await wait(30);}
  const connected=await post('/api/integrations/github',{token,owner:'runtime-owner',repo:'runtime-repo'});assert.equal(connected.status,200);assert(!(await connected.text()).includes(token));assert(calls.every(c=>c.method==='GET'));
  const status=await (await fetch(base+'/api/showcase/status')).json();assert.equal(status.team.repository,'runtime-owner/runtime-repo');assert.equal(status.team.configured,true);assert.equal(status.gateway.agents.git,false);
  const chat=await (await post('/api/tasks',{agent:'github',messages:[{role:'user',content:'저장소를 알려줘.'}]})).json();let result;
  for(let i=0;i<100;i++){result=await (await fetch(base+'/api/tasks/'+chat.jobId)).json();if(result.status==='done')break;await wait(20);}assert.equal(result.status,'done');assert(result.reply.includes('Verified runtime repository'));
  const started=await post('/api/team/jobs',{requestId:'runtime-github-job-123',messages:[{role:'user',content:'Create a demo add module.'}]});assert.equal(started.status,202);const job=await started.json();await reachedPM;
  assert.equal((await post('/api/integrations/github',{disconnect:true})).status,409);
  assert.equal((await post('/api/integrations/github',{token:'other-fixture-token',owner:'other-owner',repo:'other-repo'})).status,409);
  releasePM();let done;for(let i=0;i<100;i++){done=await (await fetch(base+'/api/team/jobs/'+job.jobId)).json();if(done.status==='done')break;await wait(30);}assert.equal(done.status,'done');assert(done.stages.some(s=>s.prNum===7));assert(!JSON.stringify(done).includes(token));
  const writes=calls.filter(c=>c.method!=='GET');assert.equal(writes.length,3);assert(writes.every(c=>c.path.startsWith('/repos/runtime-owner/runtime-repo/')&&c.auth==='Bearer '+token));assert.equal(writes.at(-1).body.base,'trunk');
  const disconnected=await post('/api/integrations/github',{disconnect:true});assert.equal(disconnected.status,200);assert.equal((await (await fetch(base+'/api/showcase/status')).json()).team.configured,false);
 }finally{releasePM?.();child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));for(const server of [provider,gateway]){server.closeAllConnections();await new Promise(r=>server.close(r));}await fs.rm(root,{recursive:true,force:true});}
});
