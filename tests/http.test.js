'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {spawn}=require('node:child_process');
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
  const child=spawn(process.execPath,['app/server.js'],{env:{...process.env,PORT:String(port),GATEWAY_URL:'http://127.0.0.1:'+gateway.address().port,GATEWAY_TOKEN:'private-fixture-token',TG_BOT_TOKEN:'',TG_CHAT_ID:'',AGENTMAIL_API_KEY:'',AGENTMAIL_INBOX_ID:''},stdio:'ignore'});
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
    const before=seen.length;
    assert.equal((await post('/api/showcase/gateway',{url:'ftp://invalid',token:'another-fixture-token'})).status,400);
    const connection=await post('/api/showcase/gateway',{url:'http://127.0.0.1:'+gateway.address().port,token:'another-fixture-token'});
    assert.equal(connection.status,200);const connectionState=await connection.json();assert.equal(connectionState.configured,true);assert(!JSON.stringify(connectionState).includes('another-fixture-token'));assert.equal(seen.length,before);
    const disconnected=await post('/api/showcase/gateway',{disconnect:true});assert.equal((await disconnected.json()).configured,false);
    assert.equal((await post('/api/tasks',input)).status,409);
    assert.equal((await fetch(base+'/api/tasks/not-found')).status,404);
  }finally{child.kill();await new Promise(r=>{if(child.exitCode!==null)r();else child.once('exit',r);});gateway.closeAllConnections();await new Promise(r=>gateway.close(r));}
});
