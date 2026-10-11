const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {TelegramBridge,AgentMailBridge} = require('../app/integrations');
const {createShowcase} = require('../app/showcase-api');
const token = '123456789:'+'x'.repeat(30);
const answer = data => new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
function tgFixture(calls,updates=[]){return async(url,opts)=>{
  const method=url.split('/').pop(),body=JSON.parse(opts.body);calls.push({method,body});
  if(method==='getMe')return answer({ok:true,result:{is_bot:true,username:'fixture_bot'}});
  if(method==='getChat')return answer({ok:true,result:{id:12345}});
  if(method==='sendMessage')return answer({ok:true,result:{message_id:99}});
  return answer({ok:true,result:body.offset===-1?[]:updates});
};}

test('Telegram verifies without sending; destination is pinned; unrelated inbound chats are filtered',async()=>{
  const calls=[],t=new TelegramBridge({fetcher:tgFixture(calls,[{update_id:1,message:{chat:{id:999},text:'not ours'}},{update_id:2,message:{chat:{id:12345},text:'our reply'}}])});
  await t.configure({token,chatId:'12345'});t.stop();
  assert.equal(calls.some(c=>c.method==='sendMessage'),false);
  await t.poll();t.stop();
  assert.deepEqual(t.receive(0).messages.map(m=>m.text),['our reply']);
  assert.deepEqual(await t.send('hello'),{ok:true,messageId:99});
  assert.equal(calls.at(-1).body.chat_id,'12345');
  assert.equal(JSON.stringify(t.public()).includes(token),false);
  await t.configure({disconnect:true});await assert.rejects(t.send('hello'),e=>e.status===409);
});

test('Disconnect wins over a pending verification',async()=>{
  let release;const t=new TelegramBridge({fetcher:async(url)=>url.endsWith('getMe')?new Promise(r=>{release=()=>r(answer({ok:true,result:{is_bot:true,username:'old_bot'}}));}):answer({ok:true,result:{id:12345}})});
  const pending=t.configure({token,chatId:'12345'});await t.configure({disconnect:true});release();
  await assert.rejects(pending,e=>e.status===409);assert.equal(t.public().configured,false);t.stop();
});

test('Failed reconnect preserves the working bot and active polling generation',async()=>{
  const t=new TelegramBridge({fetcher:tgFixture([])});await t.configure({token,chatId:'12345'});t.stop();const revision=t.revision;
  await assert.rejects(t.configure({token:'bad',chatId:'12345'}));assert.equal(t.revision,revision);assert.equal(t.public().connected,true);t.stop();
});

test('Provider failures never disclose credentials or upstream response bodies',async()=>{
  const t=new TelegramBridge({fetcher:async()=>new Response(JSON.stringify({ok:false,error_code:401,description:token}),{status:401})});
  await assert.rejects(t.configure({token,chatId:'12345'}),e=>e.status===502&&!e.message.includes(token));
  const m=new AgentMailBridge({fetcher:async()=>{throw new Error('https://host/'+token);}});
  await assert.rejects(m.configure({apiKey:token,inboxId:'fixture@agentmail.to'}),e=>!e.message.includes(token));
});

test('AgentMail uses encoded inbox paths and sends only reviewed plain text',async()=>{
  const calls=[];const m=new AgentMailBridge({fetcher:async(url,opts)=>{
    calls.push({url,opts});if(url.includes('/messages/send'))return answer({message_id:'msg_123',thread_id:'thread_123'});
    if(url.includes('/messages?'))return answer({messages:[{message_id:'m1',subject:'<script>x</script>',preview:'safe as text',from:'you@example.com'}]});
    return answer({inbox_id:'fixture+demo@agentmail.to'});
  }});
  await m.configure({apiKey:'fixture-key',inboxId:'fixture+demo@agentmail.to'});
  assert.equal(calls.length,1);assert.match(calls[0].url,/fixture%2Bdemo%40agentmail\.to$/);
  assert.equal(JSON.stringify(m.public()).includes('fixture-key'),false);
  const inbox=await m.messages();assert.equal(inbox.messages[0].subject,'<script>x</script>');
  await assert.rejects(m.send({to:'bad',subject:'test',text:'body'}));assert.equal(calls.length,2);
  await m.send({to:'you@example.com',subject:'test',text:'reviewed body'});
  assert.deepEqual(JSON.parse(calls.at(-1).opts.body),{to:['you@example.com'],subject:'test',text:'reviewed body'});
  assert.equal(calls.at(-1).opts.redirect,'error');
});

test('Connection and send routes reject cross-origin, GET mutation, and oversized requests',async()=>{
  const app=createShowcase({fetcher:async()=>answer({})}),server=http.createServer(async(req,res)=>{if(!await app.handle(req,res)){res.writeHead(404);res.end();}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
  try{
    const rejected=await fetch(url+'/api/integrations/telegram',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://foreign.example'},body:JSON.stringify({token,chatId:'12345'})});assert.equal(rejected.status,403);
    assert.equal((await fetch(url+'/api/integrations/telegram/send')).status,404);
    const large=await fetch(url+'/api/integrations/agentmail',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:'x'.repeat(50000),inboxId:'a@agentmail.to'})});assert.equal(large.status,413);
    assert.equal((await fetch(url+'/api/integrations/telegram',{method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'})).status,415);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));app.telegram.stop();}
});
