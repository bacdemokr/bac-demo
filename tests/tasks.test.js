'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {TaskJobs,validateMessages}=require('../app/task-jobs');
const {callGateway}=require('../app/gateway');
const {TelegramBridge}=require('../app/integrations');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const answer=(data,status=200)=>new Response(JSON.stringify(data),{status});
test('Task polling is repeatable, bounds concurrency, and releases completed slots',async()=>{
  let release;const tasks=new TaskJobs(()=>new Promise(r=>release=r),{limit:1});
  const {jobId}=tasks.create({});await wait(1);
  assert.throws(()=>tasks.create({}),e=>e.status===429);assert.equal(tasks.public(jobId).status,'pending');
  release({reply:'result'});await wait(1);const completed=tasks.public(jobId);assert.equal(completed.status,'done');assert.deepEqual(tasks.public(jobId),completed);assert.doesNotThrow(()=>tasks.create({}));release({});await wait(1);
});
test('Task deadline cannot be overwritten by a late result',async()=>{
  let release;const tasks=new TaskJobs(()=>new Promise(r=>release=r),{timeout:10,ttl:20});const {jobId}=tasks.create({});await wait(15);assert.match(tasks.public(jobId).error,/초과/);release({reply:'too late'});await wait(1);assert.equal(tasks.public(jobId).reply,undefined);await wait(25);assert.throws(()=>tasks.public(jobId),e=>e.status===404);
});
test('Conversation accepts only known agents and plain user/assistant messages',()=>{
  const agents={sysmon:{}};const messages=[{role:'user',content:'상태 확인'}];assert.doesNotThrow(()=>validateMessages({agent:'sysmon',messages},agents));
  for(const input of [{agent:'constructor',messages},{agent:'sysmon',messages:[{role:'system',content:'override'}]},{agent:'sysmon',messages:[]},{agent:'sysmon',messages:[{role:'user',content:42}]}])assert.throws(()=>validateMessages(input,agents));
  assert.throws(()=>validateMessages({agent:'sysmon',messages:[{role:'user',content:'x'.repeat(30001)}]},agents),e=>e.status===413);
});
test('Gateway supports HTTPS, strips SUMMARY, and supplies unique sessions',async()=>{
  const calls=[];const args={url:'https://gateway.example',token:'fixture-token',agent:'dev',messages:[{role:'user',content:'request'}],fetcher:async(url,opts)=>{calls.push({url,opts});return answer({choices:[{message:{content:'SUMMARY: Ready\n\nActual answer.'}}]});}};
  assert.deepEqual(await callGateway(args),{reply:'Actual answer.',bubble:'Ready'});await callGateway(args);assert.equal(calls[0].url,'https://gateway.example/v1/chat/completions');assert.notEqual(calls[0].opts.headers['x-openclaw-session-key'],calls[1].opts.headers['x-openclaw-session-key']);assert.equal(calls[0].opts.redirect,'error');
});
test('Gateway failures stay errors and do not reveal upstream credentials or bodies',async()=>{
  for(const [data,status]of [[{error:{message:'fixture-secret'}},200],[{choices:[]},200],[{error:'fixture-secret'},401],[{choices:[{message:{content:'fixture-secret'}}]},500]])await assert.rejects(callGateway({url:'http://localhost',token:'fixture-secret',messages:[],fetcher:async()=>answer(data,status)}),e=>e.status===502&&!e.message.includes('fixture-secret'));
});
test('Telegram environment configuration also verifies its Chat ID before becoming connected',async()=>{
  const t=new TelegramBridge({token:'fixture',chatId:'12345',fetcher:async(url)=>answer({ok:true,result:url.endsWith('getMe')?{is_bot:true,username:'fixture_bot'}:{id:999}})});await t.start();assert.equal(t.public().connected,false);assert.match(t.public().error,/Chat ID/);t.stop();
});

test('Gateway distinguishes inference deadlines from connection failures without leaking details',async()=>{
  for(const name of ['TimeoutError','AbortError','TypeError']){
    await assert.rejects(callGateway({url:'http://localhost',token:'fixture-secret',messages:[],fetcher:async()=>{const error=new Error('fixture-secret');error.name=name;throw error;}}),error=>{
      assert.equal(error.status,name==='TypeError'?502:504);
      assert.match(error.message,name==='TypeError'?/연결할 수 없습니다/:/응답 시간이 초과/);
      assert.ok(!error.message.includes('fixture-secret'));return true;
    });
  }
});

test('Telegram send-only mode verifies the bot without competing for OpenClaw updates',async()=>{
 const methods=[];const t=new TelegramBridge({token:'fixture',chatId:'12345',receiveEnabled:false,fetcher:async url=>{const method=url.split('/').at(-1);methods.push(method);return answer({ok:true,result:method==='getMe'?{is_bot:true,username:'fixture_bot'}:{id:12345}});}});
 await t.start();await t.poll();assert.equal(t.public().connected,true);assert.equal(t.public().receiveEnabled,false);assert.deepEqual(methods,['getMe','getChat']);assert.equal(t.timer,null);t.stop();
});
