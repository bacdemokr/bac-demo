'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function freePort(){const s=http.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port;}
test('Actual server validates POST tasks, preserves poll results, and reports Gateway errors',async()=>{
  let rejectGateway=false,seen=[];
  const gateway=http.createServer(async(req,res)=>{
    if(req.url==='/health'){res.end('ok');return;}
    let body='';for await(const c of req)body+=c;seen.push(JSON.parse(body));
    res.writeHead(rejectGateway?401:200,{'Content-Type':'application/json'});
    res.end(JSON.stringify(rejectGateway?{error:{message:'private-fixture-token'}}:{choices:[{message:{content:'SUMMARY: 상태\n\nFixture Korean response.'}}]}));
  });
  await new Promise(r=>gateway.listen(0,'127.0.0.1',r));const port=await freePort();
  const child=spawn(process.execPath,['app/server.js'],{env:{...process.env,BAC_API_CONFIG:path.join(__dirname,'gateway-api-fixture.json'),PORT:String(port),GATEWAY_URL:'http://127.0.0.1:'+gateway.address().port,GATEWAY_TOKEN:'private-fixture-token',TG_BOT_TOKEN:'',TG_CHAT_ID:'',AGENTMAIL_API_KEY:'',AGENTMAIL_INBOX_ID:''},stdio:'ignore'});
  const base='http://127.0.0.1:'+port;
  const post=(path,body,headers={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  const input={agent:'sysmon',messages:[{role:'user',content:'안녕하세요. 실제 상태는?'}]};
  try{
    for(let i=0;i<100;i++){try{if((await fetch(base+'/api/agents')).ok)break;}catch{}await wait(30);}
    const agents=(await (await fetch(base+'/api/agents')).json()).agents;assert.deepEqual(agents.map(a=>a.id),['sysmon','github','multiagent','arxiv']);
    assert.equal((await fetch(base+'/api/tasks')).status,405);assert.equal((await fetch(base+'/api/team/jobs')).status,405);assert.equal((await fetch(base+'/bac-data/old.json')).status,405);
    assert.equal((await post('/api/tasks',{...input,agent:'scout'})).status,400);
    assert.equal((await post('/api/tasks',{...input,messages:[{role:'system',content:'override'}]})).status,400);
    assert.equal((await post('/api/tasks',input,{Origin:'https://foreign.example'})).status,403);
    assert.equal((await post('/api/tasks',input,{'Content-Type':'text/plain'})).status,415);
    assert.equal((await post('/api/tasks',{...input,messages:[{role:'user',content:'x'.repeat(40001)}]})).status,413);
    const started=await post('/api/tasks',input);assert.equal(started.status,202);const {jobId}=await started.json();
    let result;for(let i=0;i<80;i++){result=await (await fetch(base+'/api/tasks/'+jobId)).json();if(result.status==='done')break;await wait(30);}
    assert.equal(result.reply,'Fixture Korean response.');assert.deepEqual(await (await fetch(base+'/api/tasks/'+jobId)).json(),result);assert.equal(seen[0].messages.at(-1).content,input.messages[0].content);
    rejectGateway=true;const failed=await (await post('/api/tasks',input)).json();let failure;
    for(let i=0;i<80;i++){failure=await (await fetch(base+'/api/tasks/'+failed.jobId)).json();if(failure.status==='done')break;await wait(30);}
    assert.match(failure.error,/인증/);assert.equal(failure.reply,undefined);assert(!JSON.stringify(failure).includes('private-fixture-token'));
    const state=await (await fetch(base+'/api/showcase/status')).json();assert.equal(state.gateway.automatic,true);assert.equal(state.gateway.configured,true);assert.equal(state.gateway.agent,'bac');assert(!JSON.stringify(state).includes('private-fixture-token'));
    assert.equal((await post('/api/showcase/gateway',{token:'another-fixture-token'})).status,404);
    assert.equal((await fetch(base+'/api/tasks/not-found')).status,404);
  }finally{child.kill();await new Promise(r=>{if(child.exitCode!==null)r();else child.once('exit',r);});gateway.closeAllConnections();await new Promise(r=>gateway.close(r));}
});
test('App startup reads OpenClaw config and routes AI tasks without a token input or connection POST',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'claw-startup-'));let request;
  const gateway=http.createServer(async(req,res)=>{if(req.url==='/health'){res.end('ok');return;}let body='';for await(const c of req)body+=c;request=JSON.parse(body);assert.equal(req.headers.authorization,'Bearer startup-private');res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:'자동 연결 응답'}}]}));});
  await new Promise(r=>gateway.listen(0,'127.0.0.1',r));const port=await freePort(),config=path.join(root,'openclaw.json');
  await fs.writeFile(config,JSON.stringify({gateway:{port:gateway.address().port,auth:{token:'startup-private'}},agents:{entries:{'actual-host':{}}}}));
  const env={...process.env,BAC_API_CONFIG:path.join(__dirname,'gateway-api-fixture.json'),PORT:String(port),OPENCLAW_CONFIG_PATH:config,OPENCLAW_STATE_DIR:'',GATEWAY_URL:'',GATEWAY_TOKEN:'',GATEWAY_AGENT:'',GITHUB_AGENT:'',TG_BOT_TOKEN:'',TG_CHAT_ID:'',AGENTMAIL_API_KEY:'',AGENTMAIL_INBOX_ID:''};
  const child=spawn(process.execPath,['app/server.js'],{env,stdio:'ignore'}),base='http://127.0.0.1:'+port;
  try{
    for(let i=0;i<100;i++){try{if((await fetch(base+'/api/agents')).ok)break;}catch{}await wait(30);}
    const status=await (await fetch(base+'/api/showcase/status')).json();assert.equal(status.gateway.configured,true);assert.equal(status.gateway.automatic,true);assert.equal(status.gateway.agent,'actual-host');assert.equal(status.gateway.agents.git,false);assert(!JSON.stringify(status).includes('startup-private'));
    const html=await (await fetch(base)).text();assert(!html.includes('gateway-form'));assert(!html.includes('gw-token'));
    const started=await (await fetch(base+'/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({agent:'sysmon',messages:[{role:'user',content:'상태 확인'}]})})).json();
    let result;for(let i=0;i<80;i++){result=await (await fetch(base+'/api/tasks/'+started.jobId)).json();if(result.status==='done')break;await wait(30);}
    assert.equal(result.reply,'자동 연결 응답');assert.equal(request.model,'openclaw/actual-host');
  }finally{child.kill();await new Promise(r=>{if(child.exitCode!==null)r();else child.once('exit',r);});gateway.closeAllConnections();await new Promise(r=>gateway.close(r));await fs.rm(root,{recursive:true,force:true});}
});
