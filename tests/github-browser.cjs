const assert=require('node:assert/strict'),http=require('node:http');
const {createShowcase}=require('../app/showcase-api');
const {GitHubConnection}=require('../app/github-connection');
module.exports=async({page})=>{
 const calls=[],github=new GitHubConnection({fetcher:async(url,options)=>{calls.push({url,method:options.method});const body=url.endsWith('/user')?{login:'fixture-user'}:{owner:{login:'fixture-user'},name:'fixture-repo',default_branch:'main',permissions:{push:true}};return new Response(JSON.stringify(body),{status:200});}});
 const app=createShowcase({github}),server=http.createServer(async(req,res)=>{if(!await app.handle(req,res)){res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{
  await page.locator('[data-close=browser-dialog]').click();
  await page.route('**/api/showcase/status',r=>r.fulfill({json:{gateway:{reachable:true,configured:true,agents:{git:false}},github:github.public(),team:{configured:github.public().connected&&github.public().canWrite,repository:'fixture-user/fixture-repo'},telegram:{},agentmail:{}}}));
  await page.route('**/api/integrations/github',async route=>{const request=route.request(),response=await fetch(base+'/api/integrations/github',{method:request.method(),...(request.method()==='POST'?{headers:{'Content-Type':'application/json'},body:request.postData()}:{})});await route.fulfill({status:response.status,json:await response.json()});});
  await page.setViewportSize({width:1440,height:900});await page.locator('#settings-open').click();await page.locator('#tab-github').click();
  assert.equal(await page.locator('#gh-token').getAttribute('type'),'password');await page.locator('#gh-token').fill('fixture_browser_private_token');await page.locator('#gh-repository').fill('fixture-user/fixture-repo');await page.getByRole('button',{name:'GitHub 연결',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#gh-status').textContent.includes('연결됨'));assert.equal(await page.locator('#gh-token').inputValue(),'');assert.equal(calls.length,2);assert(calls.every(c=>c.method==='GET'));
  assert.equal(await page.evaluate(()=>Object.keys(localStorage).length+Object.keys(sessionStorage).length),0);
  await page.locator('[data-close=settings-dialog]').click();await page.locator('[data-agent=github]').click();assert(!await page.locator('#input').isDisabled());assert((await page.locator('#chat-role').textContent()).includes('GitHub API'));
  await page.locator('#settings-open').click();await page.locator('#tab-github').click();assert.equal(await page.locator('#gh-token').inputValue(),'');assert.equal(await page.locator('#gh-repository').inputValue(),'fixture-user/fixture-repo');
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.querySelector('#settings-dialog').scrollWidth<=document.querySelector('#settings-dialog').clientWidth));
  await page.locator('#gh-token').fill('unused_draft_token');await page.locator('[data-close=settings-dialog]').click();await page.locator('#settings-open').click();await page.locator('#tab-github').click();assert.equal(await page.locator('#gh-token').inputValue(),'');
  await page.locator('#gh-disconnect').click();await page.waitForFunction(()=>document.querySelector('#gh-status').textContent==='연결 전');assert.equal(github.public().configured,false);assert.equal(calls.length,2);
  console.log('GitHub settings passed: runtime entry, masked token, GET-only verification, immediate repository access, key clearing, no browser storage, disconnect and mobile width.');
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
};
