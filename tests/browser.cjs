/* Real Chromium smoke test. All provider calls are local fixtures. */
const assert=require('node:assert/strict');
const http=require('node:http');
const path=require('node:path');
const fs=require('node:fs');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright-core');
const {BrowserJobs,extractSearchResults}=require('../app/browser-jobs');
const {extractDocument}=require('../app/browser-research');
const {createShowcase}=require('../app/showcase-api');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function freePort(){const s=http.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
(async()=>{
  const executable=process.env.TEST_CHROMIUM_EXECUTABLE||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':'/usr/bin/chromium');
  if(!fs.existsSync(executable))throw new Error('Set TEST_CHROMIUM_EXECUTABLE to your Chrome/Chromium executable.');
  const port=await freePort(),cdpPort=await freePort();
  const server=spawn(process.execPath,['app/server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PORT:String(port),GATEWAY_URL:'http://127.0.0.1:1',GATEWAY_TOKEN:'',TG_BOT_TOKEN:'',TG_CHAT_ID:'',AGENTMAIL_API_KEY:'',AGENTMAIL_INBOX_ID:'',GITHUB_TOKEN:'',BROWSER_CDP_URL:'http://127.0.0.1:1'},stdio:['ignore','pipe','pipe']});
  let logs='';server.stdout.on('data',d=>logs+=d);server.stderr.on('data',d=>logs+=d);
  let chrome,fixture,fixtureApi;
  try{
    const base='http://127.0.0.1:'+port;
    for(let i=0;i<80;i++){try{if((await fetch(base+'/api/agents')).ok)break;}catch{}if(i===79)throw new Error(logs);await wait(100);}
    chrome=await chromium.launch({executablePath:executable,headless:true,args:[`--remote-debugging-port=${cdpPort}`,'--remote-debugging-address=127.0.0.1']});
    const context=await chrome.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/api/showcase/status',r=>r.fulfill({json:{gateway:{reachable:true,configured:true},browser:{connected:false},team:{configured:false},telegram:{},agentmail:{}}}));
    await page.goto(base);await page.waitForFunction(()=>window.BacDemo?.getAgents().length===4);await wait(300);
    assert.equal(await page.locator('#agent-roster button').count(),4);
    if(process.env.SCREENSHOT_DIR){fs.mkdirSync(process.env.SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'bac-demo-preview.png')});}
    const visibleAgents=()=>page.evaluate(()=>{
      const canvas=document.querySelector('#game'),bounds=canvas.getBoundingClientRect(),compact=innerWidth<=900;
      const scale=compact?.76:1;
      return window.BacDemo.getAgents().map(c=>({
        name:c.name,
        visible:c.x-40*scale>=0&&c.x+60*scale<=bounds.width&&c.y-54*scale>=0&&c.y+65*scale<=bounds.height&&document.elementFromPoint(bounds.left+c.x,bounds.top+c.y)===canvas
      }));
    });
    await page.locator('[data-agent=github]').click();await wait(550);
    assert((await visibleAgents()).every(a=>a.visible),'All desktop agents should remain visible beside the chat panel.');
    await page.locator('#input').fill('draft');await page.locator('[data-agent=github]').click();assert.equal(await page.locator('#input').inputValue(),'draft');
    await page.locator('#chat-head').click();assert.equal(await page.evaluate(()=>window.BacDemo.getActive()?.id),'github');
    if(process.env.SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'bac-demo-chat-preview.png')});
    for(const size of [{width:1100,height:900},{width:934,height:700}]){
      await page.setViewportSize(size);await wait(550);
      assert((await visibleAgents()).every(a=>a.visible),'Agents should remain visible at '+JSON.stringify(size));
    }
    await page.mouse.click(8,460);await wait(450);assert.equal(await page.evaluate(()=>window.BacDemo.getActive()),null);
    assert.equal(await page.locator('#chat').getAttribute('inert'),'');
    await page.setViewportSize({width:1440,height:900});await wait(450);
    const clickAgent=async id=>{const point=await page.evaluate(id=>{const c=window.BacDemo.getAgents().find(a=>a.id===id),r=document.querySelector('#game').getBoundingClientRect();return {x:c.x+r.left,y:c.y+r.top};},id);await page.mouse.click(point.x,point.y);await wait(450);};
    await clickAgent('github');assert.equal(await page.evaluate(()=>window.BacDemo.getActive()?.id),'github');
    await clickAgent('github');assert.equal(await page.locator('#chat-name').textContent(),'GitHubAgent');
    await page.keyboard.press('Escape');await wait(450);assert.equal(await page.evaluate(()=>window.BacDemo.getActive()),null);
    await page.locator('[data-agent=github]').click();await page.evaluate(()=>window.BacShowcase.settings('tools'));
    assert.equal(await page.evaluate(()=>window.BacDemo.getActive()?.id),'github');
    await page.locator('[data-close=settings-dialog]').click();await page.locator('#chat-close').click();await wait(450);
    console.log('Panel passed: visible agents at desktop/tablet widths, canvas selection, agent switching, draft retention, outside click, Escape, inert closed panel, nested dialog.');
    await page.locator('[data-mission=browser]').click();assert(await page.locator('#browser-dialog').isVisible());
    assert.deepEqual(await page.locator('#browser-source option').evaluateAll(options=>options.map(o=>o.value)),['auto','naver','daum']);
    await page.locator('#browser-run').click();await page.waitForFunction(()=>document.querySelector('#browser-note').textContent.includes('Chromium에 연결할 수 없습니다'));
    assert.equal(await page.locator('#browser-frame').isVisible(),false);assert(await page.locator('#browser-share').isDisabled());
    await page.locator('[data-close=browser-dialog]').click();
    let telegramConfigured=false,mailConfigured=false,writes=[];
    const tg={configured:true,connected:true,bot:'fixture_bot',chatId:'12345'},mail={configured:true,connected:true,inboxId:'fixture@agentmail.to'};
    await page.route('**/api/showcase/status',r=>r.fulfill({json:{gateway:{reachable:true,configured:true},browser:{connected:false},team:{configured:false},telegram:telegramConfigured?tg:{},agentmail:mailConfigured?mail:{}}}));
    await page.route('**/api/integrations/telegram',async r=>{
      if(r.request().method()==='POST'){const body=r.request().postDataJSON();telegramConfigured=!body.disconnect;writes.push('telegram configure');await r.fulfill({json:telegramConfigured?tg:{configured:false,connected:false}});}
      else await r.fulfill({json:telegramConfigured?tg:{}});
    });
    await page.route('**/api/integrations/agentmail',async r=>{mailConfigured=!r.request().postDataJSON().disconnect;writes.push('mail configure');await r.fulfill({json:mailConfigured?mail:{configured:false,connected:false}});});
    await page.locator('#settings-open').click();await page.locator('#tg-token').fill('123456789:'+'x'.repeat(30));await page.locator('#tg-chat').fill('12345');
    await page.getByRole('button',{name:'Telegram 연결',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#tg-status').textContent.includes('fixture_bot'));
    assert.equal(await page.locator('#tg-token').inputValue(),'');assert.deepEqual(writes,['telegram configure']);
    assert(await page.locator('#tg-connection-card').isVisible());assert(!await page.locator('#telegram-form').isVisible());
    await page.locator('#tab-agentmail').click();await page.locator('#mail-key').fill('fixture-key');await page.locator('#mail-inbox').fill('fixture@agentmail.to');
    await page.getByRole('button',{name:'AgentMail 연결',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#mail-status').textContent.includes('연결됨'));
    assert.equal(await page.locator('#mail-key').inputValue(),'');assert.equal(await page.evaluate(()=>Object.keys(localStorage).length),0);
    assert(await page.locator('#mail-connection-card').isVisible());assert(!await page.locator('#mail-connect-form').isVisible());
    assert.equal(await page.locator('#gateway-form,#gw-token,#tab-gateway').count(),0);
    await page.locator('[data-close=settings-dialog]').click();
    await page.route('**/api/integrations/agentmail/messages',r=>r.fulfill({json:{messages:[{id:'m1',subject:'<img src=x onerror=alert(1)>',from:'fixture@example.com',preview:'<script>unsafe()</script>',at:new Date().toISOString()}]}}));
    await page.locator('[data-mission=mail]').click();await page.locator('.inbox-item').waitFor();assert.equal(await page.locator('.inbox-item img,.inbox-item script').count(),0);
    await page.locator('#mail-new').click();await page.locator('#share-to').fill('you@example.com');await page.locator('#share-text').fill('Reviewed fixture email.');
    let sends=0;await page.route('**/api/integrations/agentmail/send',r=>{sends++;assert.deepEqual(r.request().postDataJSON(),{to:'you@example.com',subject:'Agentic AI Demo 결과',text:'Reviewed fixture email.'});return r.fulfill({json:{ok:true,messageId:'fixture-message'}});});
    assert.equal(sends,0);await page.locator('#share-send').click();await page.waitForFunction(()=>document.querySelector('#share-status').textContent.includes('fixture-message'));assert.equal(sends,1);
    await page.locator('[data-close=share-dialog]').click();await page.locator('[data-close=inbox-dialog]').click();
    await page.route('**/api/integrations/telegram/messages?*',r=>r.fulfill({json:{messages:[{id:1,from:'Fixture',text:'<img src=x onerror=alert(1)>'}],lastId:1}}));
    await page.locator('[data-mission=mail]').click();await page.locator('#message-tab-telegram').click();
    await page.locator('#telegram-text').fill('fixture chat');let tgSends=0;
    await page.route('**/api/integrations/telegram/send',r=>{assert.equal(r.request().method(),'POST');tgSends++;return r.fulfill({json:{ok:true,messageId:1}});});
    await page.locator('#telegram-send').click();await page.waitForFunction(()=>!document.querySelector('#telegram-send').disabled);assert.equal(tgSends,1);assert.equal(await page.locator('#telegram-messages img').count(),0);
    await page.locator('[data-close=inbox-dialog]').click();
    let taskReleased=false,starts=0;
    await page.route('**/api/tasks',r=>{assert.equal(r.request().method(),'POST');starts++;return r.fulfill({status:202,json:{jobId:'fixture-task'}});});
    await page.route('**/api/tasks/fixture-task',r=>r.fulfill({json:taskReleased?{status:'done',reply:'Background reply retained.',bubble:'Completed'}:{status:'pending'}}));
    await page.locator('[data-agent=github]').click();await page.locator('#input').fill('retain my result');await page.locator('#send').click();
    await page.waitForFunction(()=>window.BacDemo.getAgents().find(c=>c.id==='github').busy);
    await page.locator('#chat-close').click();await page.locator('[data-agent=sysmon]').click();taskReleased=true;
    await page.waitForFunction(()=>!window.BacDemo.getAgents().find(c=>c.id==='github').busy);
    assert(!(await page.locator('#msgs').textContent()).includes('Background reply retained.'));
    await page.locator('[data-agent=github]').click();assert((await page.locator('#msgs').textContent()).includes('Background reply retained.'));assert.equal(starts,1);
    await page.locator('#input').fill('preserved draft');await page.locator('[data-agent=sysmon]').click();await page.locator('[data-agent=github]').click();assert.equal(await page.locator('#input').inputValue(),'preserved draft');
    await page.locator('#chat-close').click();console.log('Tasks passed: one POST start, late result stays with its agent, polling survives closing, per-agent drafts and history survive switching.');
    let teamReleased=false,teamStarts=0;
    await page.route('**/api/showcase/status',r=>r.fulfill({json:{gateway:{reachable:true,configured:true},browser:{connected:false},team:{configured:true,repository:'fixture/repo'},telegram:tg,agentmail:mail}}));
    await page.evaluate(()=>window.BacShowcase.settings('tools'));await page.waitForFunction(()=>window.BacShowcase.canRun('multiagent'));await page.locator('[data-close=settings-dialog]').click();
    await page.route('**/api/team/jobs',r=>{teamStarts++;assert.equal(r.request().method(),'POST');assert(r.request().postDataJSON().requestId);return r.fulfill({status:202,json:{jobId:'fixture-team'}});});
    await page.route('**/api/team/jobs/fixture-team',r=>r.fulfill({json:{status:teamReleased?'done':'running',stages:teamReleased?[{stage:'pm-start',actor:'pm',text:'계획 작성'},{stage:'pm-done',actor:'pm',text:'계획 완료',plan:'Fixture PM plan.'},{stage:'handoff',actor:'pm',text:'전달'},{stage:'dev-start',actor:'dev',text:'구현'},{stage:'dev-done',actor:'dev',text:'Fixture PR created.',prUrl:'https://example.com/fixture-pr'}]:[{stage:'pm-start',actor:'pm',text:'계획 작성'}]}}));
    await page.locator('[data-mission=team]').click();await page.locator('#input').fill('Fixture feature');await page.locator('#send').click();await page.waitForFunction(()=>window.BacDemo.getAgents().find(c=>c.id==='multiagent').teamJobId);
    await page.locator('#chat-close').click();await page.locator('[data-agent=github]').click();teamReleased=true;await page.waitForFunction(()=>!window.BacDemo.getAgents().find(c=>c.id==='multiagent').busy);
    assert(!(await page.locator('#msgs').textContent()).includes('Fixture PR created.'));await page.locator('[data-agent=multiagent]').click();assert((await page.locator('#msgs').textContent()).includes('Fixture PM plan.'));assert.equal(await page.locator('#msgs a[href="https://example.com/fixture-pr"]').count(),1);assert.equal(teamStarts,1);await page.locator('#chat-close').click();
    console.log('Team passed: POST request identity, PM/Dev stages and PR result persist when panel is closed or switched.');
    await page.locator('#motion-toggle').click();assert.equal(await page.evaluate(()=>window.BacDemo.isPaused()),true);
    await page.setViewportSize({width:390,height:844});await wait(250);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.reload();await page.waitForFunction(()=>window.BacDemo?.getAgents().length===4);
    await page.locator('#activity-clear').scrollIntoViewIfNeeded();assert(await page.evaluate(()=>window.scrollY>0));await page.evaluate(()=>scrollTo(0,0));await wait(250);
    if(process.env.SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'bac-demo-mobile.png'),fullPage:true});
    await page.locator('[data-agent=github]').click();await wait(550);
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
    const extractPage=await context.newPage();
    await extractPage.setContent('<nav><a href="https://help.naver.com/">Navigation and support link</a></nav><a href="https://ader.naver.com/ad">Advertisement destination title</a><div class="fds-web-doc-root"><a href="https://example.com/organic"><span class="sds-comps-text-type-headline1">Actual organic result title</span></a><a href="https://example.com/organic">Repeated description of the same result</a></div>');
    assert.deepEqual((await extractPage.evaluate(extractSearchResults)).map(r=>({title:r.title,url:r.url})),[{title:'Actual organic result title',url:'https://example.com/organic'}]);
    await extractPage.setContent('<head><title>Dated original</title><script type="application/ld+json">{"@graph":[{"@type":"NewsArticle","datePublished":"2026-10-10T16:00:00Z"}]}</script></head><main>'+('Actual original article body. ').repeat(20)+'</main>');
    assert.equal((await extractPage.evaluate(extractDocument)).published,'2026-10-10T16:00:00Z');await extractPage.close();
    console.log('Extraction passed: result title is preferred; navigation, ads and repeated description links are excluded.');
    let firstArticleBlocked=false,firstArticleIssue='',newsFixture=false;
    const researchFixture=http.createServer((req,res)=>{
      res.writeHead(200,{'Content-Type':'text/html'});
      if(firstArticleBlocked&&req.url.startsWith('/article-0')){res.end('<html><title>Verify you are human</title><body>CAPTCHA challenge. No readable evidence.</body></html>');return;}
      if(req.url.startsWith('/article-')){
        const number=req.url.match(/article-(\d+)/)[1],issue=number==='0'?firstArticleIssue:'';
        const title=issue==='topic'?'Local community activities':'Alpha and Beta evidence '+number;
        const body=issue==='topic'?'Unrelated community event uses AI for LOCAL WEEK. ':'Original article evidence '+number+' supports the Alpha and Beta comparison with factual details. ';
        const published=issue==='date'?'2000-01-01':issue==='missing-date'?'':newsFixture?new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()):'2026-10-09';
        res.end('<html><head><title>'+title+'</title><meta property="article:published_time" content="'+published+'"></head><body><nav>Navigation must be excluded</nav><main><h1>'+title+'</h1><p>'+body.repeat(24)+'</p></main></body></html>');
      }
      else res.end('<html><title>Research search</title><body><nav><a href="https://help.naver.com/">Unrelated search navigation</a></nav>'+Array.from({length:4},(_,i)=>'<article><a href="http://127.0.0.1:'+researchFixture.address().port+'/article-'+i+'">Alpha and Beta original article number '+i+'</a><p>Alpha and Beta factual snippet.</p></article>').join('')+'</body></html>');
    });
    await new Promise(r=>researchFixture.listen(0,'127.0.0.1',r));
    const researchBase='http://127.0.0.1:'+researchFixture.address().port;
    const fixtureNews=(q,period)=>researchBase+'/news?q='+encodeURIComponent(q)+'&start='+period?.start+'&end='+period?.end;
    const researchSources={naver:{name:'Naver fixture',url:q=>researchBase+'/search?q='+encodeURIComponent(q),newsUrl:fixtureNews},daum:{name:'Daum fixture',url:q=>researchBase+'/other?q='+encodeURIComponent(q),newsUrl:fixtureNews}};
    const prompts=[],researchJobs=new BrowserJobs({endpoint:'http://127.0.0.1:'+cdpPort,sources:researchSources,ask:()=>async(system,user)=>{
      prompts.push({system,user});
      if(system.startsWith('Turn the user'))return JSON.stringify({queries:['Alpha official','Beta official'],objective:'Compare actual articles'});
      if(system.startsWith('Select web'))return JSON.stringify({indices:firstArticleBlocked?[0,1,2,3]:[0,1,2]});
      const data=JSON.parse(user);assert.equal(data.sources.length,3);assert(data.sources.every(s=>s.text.includes('Original article evidence')));return JSON.stringify({answer:'Alpha and Beta have supporting original articles. '+data.sources.map(s=>'['+s.id+']').join(' '),limitations:['Fixture evidence only.']});
    }});
    try{
      const started=researchJobs.create({query:'Compare Alpha and Beta',mode:'compare',provider:'auto'});
      for(let i=0;i<400&&researchJobs.public(started.id).status==='running';i++)await wait(100);
      const done=researchJobs.public(started.id);assert.equal(done.status,'done');assert.equal(done.searches.length,4);assert.equal(done.results.length,4);assert.equal(done.documents.filter(d=>d.status==='read').length,3);assert(done.documents.every(d=>d.published==='2026-10-09'));assert(done.summary.answer.includes('[1]'));assert(done.documents.every(d=>d.text===undefined));assert.equal(prompts.length,3);assert.equal(chrome.isConnected(),true);
      const evidence=researchJobs.evidence(started.id);assert(evidence.documents.every(d=>!d.text.includes('Navigation must be excluded')));
      assert.deepEqual([...new Set(done.searches.map(s=>s.source))],['Naver fixture','Daum fixture']);
      const originalResult=done.results[0];assert.equal(originalResult.searchSources.length,2);
      console.log('Research passed: question planning, two queries across two sources, deduplication, three actual article navigations, publication dates, evidence-only cited synthesis.');
      firstArticleBlocked=true;
      const partial=researchJobs.create({query:'Compare Alpha and Beta',mode:'compare',provider:'auto'});
      for(let i=0;i<400&&researchJobs.public(partial.id).status==='running';i++)await wait(100);
      const recovered=researchJobs.public(partial.id);assert.equal(recovered.status,'done');assert.equal(recovered.documents[0].status,'unavailable');assert.equal(recovered.documents.filter(d=>d.status==='read').length,3);assert.equal(recovered.documents.length,4);assert(!recovered.summary.answer.includes('[1]'));assert(recovered.summary.answer.includes('[4]'));
      console.log('Recovery passed: blocked article is excluded, another candidate is read, and only successful source IDs enter the answer.');
      firstArticleBlocked=false;
      for(const issue of ['topic','date','missing-date']){
        firstArticleIssue=issue;newsFixture=issue!=='topic';
        const next=researchJobs.create({query:newsFixture?'최근 일주일 Alpha와 Beta 발표를 정리해줘.':'Compare Alpha and Beta',mode:newsFixture?'news':'compare',provider:'auto'});
        for(let i=0;i<400&&researchJobs.public(next.id).status==='running';i++)await wait(100);
        const verified=researchJobs.public(next.id);assert.equal(verified.status,'done');assert.equal(verified.documents[0].status,'excluded');assert.equal(verified.documents.filter(d=>d.status==='read').length,3);assert(!verified.summary.answer.includes('[1]'));assert(verified.summary.answer.includes('[4]'));
        if(newsFixture)assert(verified.searches.every(s=>new URL(s.url).searchParams.get('start')===verified.plan.timeRange.start));
      }
      console.log('Relevance passed: misleading search title, old publication and missing publication date are excluded after actual navigation; another candidate supplies evidence.');
      global.researchResult=done;
      global.researchFrame=researchJobs.jobs.get(started.id).frame;
    }finally{researchFixture.closeAllConnections();await new Promise(r=>researchFixture.close(r));}
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
    await page.locator('#browser-mode').selectOption('search');await page.locator('#browser-query').fill('fixture query');await page.locator('#browser-run').click();
    await page.waitForFunction(()=>!document.querySelector('#browser-share').disabled);await page.locator('#browser-frame').waitFor();
    assert.equal(await page.locator('.result-card').count(),8);assert.equal(await page.locator('#browser-steps li').count(),6);
    assert(await page.locator('#browser-frame').evaluate(img=>img.naturalWidth===1280));
    await wait(400);
    if(process.env.SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'bac-demo-browser-preview.png')});
    await page.locator('#browser-summary-run').click();
    await page.waitForFunction(()=>document.querySelector('#browser-summary-text').textContent.includes('Background reply retained.'));
    assert(await page.locator('#browser-dialog').isVisible());assert.equal(await page.evaluate(()=>window.BacDemo.getActive()),null);
    assert.deepEqual(errors,[]);console.log('Viewer passed: real screenshot and trace, inline summary stays in the browser workflow.');
    await page.locator('[data-close=browser-dialog]').click();
    const researchResult=global.researchResult;
    await page.route('**/api/browser/jobs',r=>r.fulfill({status:202,json:researchResult}));
    await page.route('**/api/browser/jobs/'+researchResult.id+'/frame.jpg*',r=>r.fulfill({contentType:'image/jpeg',body:global.researchFrame}));
    await page.locator('[data-mission=browser]').click();await page.locator('[data-research-example=compare]').click();assert.equal(await page.locator('#browser-run').textContent(),'조사 시작');await page.locator('#browser-run').click();
    await page.waitForFunction(()=>document.querySelector('#browser-summary-text').textContent.includes('supporting original articles'));
    assert.equal(await page.locator('.evidence-card').count(),3);assert.equal(await page.locator('.source-citation').count(),3);assert.equal(await page.locator('#browser-candidates').getAttribute('open'),null);
    await page.waitForFunction(()=>document.querySelector('#browser-frame').naturalWidth===1280);
    assert((await page.locator('#browser-plan').textContent()).includes('Alpha official'));
    assert.equal(await page.locator('#browser-plan .query-chip').count(),2);
    await page.setViewportSize({width:390,height:844});await wait(300);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert(await page.evaluate(()=>document.querySelector('#browser-dialog').scrollWidth<=document.querySelector('#browser-dialog').clientWidth));
    await page.locator('#browser-summary').scrollIntoViewIfNeeded();if(process.env.SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'bac-demo-research-mobile.png')});
    await page.setViewportSize({width:1440,height:900});await wait(300);await page.evaluate(()=>document.querySelector('#browser-dialog').scrollTop=0);if(process.env.SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'bac-demo-research-preview.png')});
    await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.BacShowcase.settings('tools'));await wait(300);assert(await page.evaluate(()=>document.querySelector('#settings-dialog').scrollWidth<=document.querySelector('#settings-dialog').clientWidth));await page.locator('[data-close=settings-dialog]').click();
    assert.deepEqual(errors,[]);console.log('Research UI passed: automatic answer, clickable citations, dated evidence, collapsed candidates, editable question presets, mobile width.');
    await require('./restaurants-browser.cjs')({page,cdpPort});assert.deepEqual(errors,[]);
    await require('./github-browser.cjs')({page});assert.deepEqual(errors,[]);

  }finally{
    if(chrome)for(const context of chrome.contexts()){await context.unrouteAll({behavior:'ignoreErrors'});await context.close();}
    if(fixtureApi){fixtureApi.closeAllConnections();await new Promise(r=>fixtureApi.close(r));}if(chrome)await chrome.close();if(fixture){fixture.closeAllConnections();await new Promise(r=>fixture.close(r));}server.kill();await new Promise(r=>{if(server.exitCode!==null)r();else server.once('exit',r);});
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
