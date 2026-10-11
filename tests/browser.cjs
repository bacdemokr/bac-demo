/* Real Chromium smoke test. All provider calls are local fixtures. */
const assert=require('node:assert/strict');
const http=require('node:http');
const path=require('node:path');
const fs=require('node:fs');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright-core');
const {BrowserJobs}=require('../app/browser-jobs');
const {createShowcase}=require('../app/showcase-api');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function freePort(){const s=http.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
(async()=>{
  const executable=process.env.TEST_CHROMIUM_EXECUTABLE||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':'/usr/bin/chromium');
  if(!fs.existsSync(executable))throw new Error('Set TEST_CHROMIUM_EXECUTABLE to your Chrome/Chromium executable.');
  const port=await freePort(),cdpPort=await freePort();
  const server=spawn(process.execPath,['app/server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PORT:String(port),GATEWAY_URL:'http://127.0.0.1:1',GATEWAY_TOKEN:'',TG_BOT_TOKEN:'',TG_CHAT_ID:'',AGENTMAIL_API_KEY:'',AGENTMAIL_INBOX_ID:''},stdio:['ignore','pipe','pipe']});
  let logs='';server.stdout.on('data',d=>logs+=d);server.stderr.on('data',d=>logs+=d);
  let chrome,fixture,fixtureApi;
  try{
    const base='http://127.0.0.1:'+port;
    for(let i=0;i<80;i++){try{if((await fetch(base+'/api/agents')).ok)break;}catch{}if(i===79)throw new Error(logs);await wait(100);}
    chrome=await chromium.launch({executablePath:executable,headless:true,args:[`--remote-debugging-port=${cdpPort}`,'--remote-debugging-address=127.0.0.1']});
    const context=await chrome.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base);await page.waitForFunction(()=>window.BacDemo?.getAgents().length===7);await wait(300);
    assert.equal(await page.locator('#agent-roster button').count(),7);
    if(process.env.SCREENSHOT_DIR){fs.mkdirSync(process.env.SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'bac-demo-preview.png')});}
    const visibleAgents=()=>page.evaluate(()=>{
      const canvas=document.querySelector('#game'),bounds=canvas.getBoundingClientRect(),compact=innerWidth<=900;
      const scale=compact?.76:1;
      return window.BacDemo.getAgents().map(c=>({
        name:c.name,
        visible:c.x-40*scale>=0&&c.x+60*scale<=bounds.width&&c.y-54*scale>=0&&c.y+65*scale<=bounds.height&&document.elementFromPoint(bounds.left+c.x,bounds.top+c.y)===canvas
      }));
    });
    await page.locator('[data-agent=scout]').click();await wait(550);
    assert((await visibleAgents()).every(a=>a.visible),'All desktop agents should remain visible beside the chat panel.');
    await page.locator('#input').fill('draft');await page.locator('[data-agent=scout]').click();assert.equal(await page.locator('#input').inputValue(),'draft');
    await page.locator('#chat-head').click();assert.equal(await page.evaluate(()=>window.BacDemo.getActive()?.id),'scout');
    if(process.env.SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'bac-demo-chat-preview.png')});
    for(const size of [{width:1100,height:900},{width:934,height:700}]){
      await page.setViewportSize(size);await wait(550);
      assert((await visibleAgents()).every(a=>a.visible),'Agents should remain visible at '+JSON.stringify(size));
    }
    await page.mouse.click(8,460);await wait(450);assert.equal(await page.evaluate(()=>window.BacDemo.getActive()),null);
    assert.equal(await page.locator('#chat').getAttribute('inert'),'');
    await page.setViewportSize({width:1440,height:900});await wait(450);
    const clickAgent=async id=>{const point=await page.evaluate(id=>{const c=window.BacDemo.getAgents().find(a=>a.id===id),r=document.querySelector('#game').getBoundingClientRect();return {x:c.x+r.left,y:c.y+r.top};},id);await page.mouse.click(point.x,point.y);await wait(450);};
    await clickAgent('scout');assert.equal(await page.evaluate(()=>window.BacDemo.getActive()?.id),'scout');
    await clickAgent('github');assert.equal(await page.locator('#chat-name').textContent(),'GitHubAgent');
    await page.keyboard.press('Escape');await wait(450);assert.equal(await page.evaluate(()=>window.BacDemo.getActive()),null);
    await page.locator('[data-agent=scout]').click();await page.locator('#agent-actions button').click();
    await page.locator('#browser-query').fill('draft query');assert.equal(await page.evaluate(()=>window.BacDemo.getActive()?.id),'scout');
    await page.locator('[data-close=browser-dialog]').click();await page.locator('#chat-close').click();await wait(450);
    console.log('Panel passed: visible agents at desktop/tablet widths, canvas selection, agent switching, draft retention, outside click, Escape, inert closed panel, nested dialog.');
    await page.locator('[data-mission=browser]').click();assert(await page.locator('#browser-dialog').isVisible());
    await page.locator('#browser-run').click();await page.waitForFunction(()=>document.querySelector('#browser-note').textContent.includes('Chromium에 연결할 수 없습니다'));
    assert.equal(await page.locator('#browser-frame').isVisible(),false);assert(await page.locator('#browser-share').isDisabled());
    await page.locator('[data-close=browser-dialog]').click();
    let telegramConfigured=false,mailConfigured=false,writes=[];
    const tg={configured:true,connected:true,bot:'fixture_bot',chatId:'12345'},mail={configured:true,connected:true,inboxId:'fixture@agentmail.to'};
    await page.route('**/api/showcase/status',r=>r.fulfill({json:{gateway:{reachable:false,configured:false},browser:{connected:false},telegram:telegramConfigured?tg:{},agentmail:mailConfigured?mail:{}}}));
    await page.route('**/api/integrations/telegram',async r=>{
      if(r.request().method()==='POST'){const body=r.request().postDataJSON();telegramConfigured=!body.disconnect;writes.push('telegram configure');await r.fulfill({json:telegramConfigured?tg:{configured:false,connected:false}});}
      else await r.fulfill({json:telegramConfigured?tg:{}});
    });
    await page.route('**/api/integrations/agentmail',async r=>{mailConfigured=!r.request().postDataJSON().disconnect;writes.push('mail configure');await r.fulfill({json:mailConfigured?mail:{configured:false,connected:false}});});
    await page.locator('#settings-open').click();await page.locator('#tg-token').fill('123456789:'+'x'.repeat(30));await page.locator('#tg-chat').fill('12345');
    await page.getByRole('button',{name:'Telegram 연결',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#tg-status').textContent.includes('fixture_bot'));
    assert.equal(await page.locator('#tg-token').inputValue(),'');assert.deepEqual(writes,['telegram configure']);
    await page.locator('#tab-agentmail').click();await page.locator('#mail-key').fill('fixture-key');await page.locator('#mail-inbox').fill('fixture@agentmail.to');
    await page.getByRole('button',{name:'AgentMail 연결',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#mail-status').textContent.includes('연결됨'));
    assert.equal(await page.locator('#mail-key').inputValue(),'');assert.equal(await page.evaluate(()=>Object.keys(localStorage).length),0);
    await page.locator('[data-close=settings-dialog]').click();
    await page.route('**/api/integrations/agentmail/messages',r=>r.fulfill({json:{messages:[{id:'m1',subject:'<img src=x onerror=alert(1)>',from:'fixture@example.com',preview:'<script>unsafe()</script>',at:new Date().toISOString()}]}}));
    await page.locator('[data-mission=mail]').click();await page.locator('.inbox-item').waitFor();assert.equal(await page.locator('.inbox-item img,.inbox-item script').count(),0);
    await page.locator('#mail-new').click();await page.locator('#share-to').fill('you@example.com');await page.locator('#share-text').fill('Reviewed fixture email.');
    let sends=0;await page.route('**/api/integrations/agentmail/send',r=>{sends++;assert.deepEqual(r.request().postDataJSON(),{to:'you@example.com',subject:'Agentic AI Demo 결과',text:'Reviewed fixture email.'});return r.fulfill({json:{ok:true,messageId:'fixture-message'}});});
    assert.equal(sends,0);await page.locator('#share-send').click();await page.waitForFunction(()=>document.querySelector('#share-status').textContent.includes('fixture-message'));assert.equal(sends,1);
    await page.locator('[data-close=share-dialog]').click();await page.locator('[data-close=inbox-dialog]').click();
    await page.locator('[data-agent=telegram]').click();await page.locator('#input').fill('fixture chat');let tgSends=0;
    await page.route('**/api/integrations/telegram/send',r=>{assert.equal(r.request().method(),'POST');tgSends++;return r.fulfill({json:{ok:true,messageId:1}});});
    await page.locator('#send').click();await page.waitForFunction(()=>!document.querySelector('#send').disabled);assert.equal(tgSends,1);await page.locator('#chat-close').click();
    await page.locator('#motion-toggle').click();assert.equal(await page.evaluate(()=>window.BacDemo.isPaused()),true);
    await page.setViewportSize({width:390,height:844});await wait(250);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.reload();await page.waitForFunction(()=>window.BacDemo?.getAgents().length===7);
    await page.locator('#activity-clear').scrollIntoViewIfNeeded();assert(await page.evaluate(()=>window.scrollY>0));await page.evaluate(()=>scrollTo(0,0));await wait(250);
    if(process.env.SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'bac-demo-mobile.png'),fullPage:true});
    await page.locator('[data-agent=scout]').click();await wait(550);
    assert((await visibleAgents()).every(a=>a.visible),'Mobile agents should remain visible above the bottom sheet.');
    assert(await page.locator('#input').isVisible());
    if(process.env.SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'bac-demo-mobile-chat.png')});
    await page.setViewportSize({width:390,height:650});await wait(450);
    assert((await visibleAgents()).every(a=>a.visible),'Mobile agents should remain visible in a shorter viewport.');
    await page.mouse.click(10,35);await wait(450);assert.equal(await page.evaluate(()=>window.BacDemo.getActive()),null);
    await page.setViewportSize({width:390,height:844});await wait(450);
    assert.deepEqual(errors,[]);
    console.log('UI passed: desktop/mobile, connection forms, no automatic send, safe inbox rendering, POST chat, unavailable browser.');
    // Actual CDP run against a deterministic local search page, not a mocked screenshot.
    fixture=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<html><title>Fixture search</title><body style="height:1800px;background:#f3f6f0"><h1>Local browser fixture</h1>'+Array.from({length:8},(_,i)=>`<article style="margin:60px"><a href="https://example.com/article-${i}">Deterministic research result number ${i}</a><p>Actual fixture page content to extract.</p></article>`).join('')+'</body></html>');});
    await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
    const jobs=new BrowserJobs({endpoint:'http://127.0.0.1:'+cdpPort,sources:{fixture:{name:'Fixture',url:q=>'http://127.0.0.1:'+fixture.address().port+'/?q='+encodeURIComponent(q)}}});
    const job=jobs.create({query:'fixture query',provider:'fixture'});assert.throws(()=>jobs.create({query:'next',provider:'fixture'}),e=>e.status===409);
    for(let i=0;i<160&&jobs.public(job.id).status==='running';i++)await wait(100);
    const result=jobs.public(job.id);assert.equal(result.status,'done');assert.equal(result.results.length,8);assert(result.revision>=4);assert(jobs.jobs.get(job.id).frame.length>5000);
    assert.deepEqual(result.events.map(e=>e.stage),['connect','navigate','observe','scroll','extract','done']);assert.equal(chrome.isConnected(),true);
    if(process.env.SCREENSHOT_DIR)fs.writeFileSync(path.join(process.env.SCREENSHOT_DIR,'bac-demo-browser-capture.jpg'),jobs.jobs.get(job.id).frame);
    assert.throws(()=>jobs.create({query:'x',provider:'constructor'}),e=>e.status===400);
    console.log('Browser passed: real CDP navigation, scroll, link extraction, JPEG capture, single-job lock, Chromium stays alive.');
    const viewer=createShowcase({browser:new BrowserJobs({endpoint:'http://127.0.0.1:'+cdpPort,sources:{naver:{name:'Naver fixture',url:q=>'http://127.0.0.1:'+fixture.address().port+'/?q='+encodeURIComponent(q)}}})});
    fixtureApi=http.createServer(async(req,res)=>{if(!await viewer.handle(req,res)){res.writeHead(404);res.end();}});
    await new Promise(r=>fixtureApi.listen(0,'127.0.0.1',r));
    const apiBase='http://127.0.0.1:'+fixtureApi.address().port;
    await page.route('**/api/browser/**',async route=>{
      const req=route.request(),url=apiBase+new URL(req.url()).pathname+new URL(req.url()).search;
      const response=await fetch(url,{method:req.method(),...(req.method()==='POST'?{headers:{'Content-Type':'application/json'},body:req.postData()}: {})});
      await route.fulfill({status:response.status,contentType:response.headers.get('Content-Type'),body:Buffer.from(await response.arrayBuffer())});
    });
    await page.setViewportSize({width:1440,height:900});await page.locator('[data-mission=browser]').click();
    await page.locator('#browser-query').fill('fixture query');await page.locator('#browser-run').click();
    await page.waitForFunction(()=>!document.querySelector('#browser-share').disabled);await page.locator('#browser-frame').waitFor();
    assert.equal(await page.locator('.result-card').count(),8);assert.equal(await page.locator('#browser-steps li').count(),6);
    assert(await page.locator('#browser-frame').evaluate(img=>img.naturalWidth===1280));
    await wait(400);
    if(process.env.SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'bac-demo-browser-preview.png')});
    await page.locator('#browser-to-chat').click();
    assert(await page.locator('#chat').isVisible());await page.waitForFunction(()=>document.querySelector('#msgs').textContent.includes('브라우저 작업이 만료'));
    assert.deepEqual(errors,[]);console.log('Viewer passed: HTTP job polling, actual screenshot route, execution trace, source links, expired summary job is reported.');

  }finally{
    if(fixtureApi){fixtureApi.closeAllConnections();await new Promise(r=>fixtureApi.close(r));}if(chrome)await chrome.close();if(fixture){fixture.closeAllConnections();await new Promise(r=>fixture.close(r));}server.kill();await new Promise(r=>{if(server.exitCode!==null)r();else server.once('exit',r);});
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
