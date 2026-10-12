const assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const {BrowserJobs}=require('../app/browser-jobs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
module.exports=async({page,cdpPort})=>{
  let blocked=false;
  const card=(asin,title,extra='')=>`<div data-component-type="s-search-result" data-asin="${asin}"><h2>${title}</h2>${extra}</div>`;
  const html='<html><title>Amazon fixture</title><body style="height:1800px">'+card('B000000001','USB C hub','<span class="a-price"><span class="a-offscreen">$19.99</span></span><span class="a-icon-alt">4.6 out of 5 stars</span><a href="/customerReviews"><span class="a-size-base">1.2K</span></a>')+card('B000000002','&lt;img src=x onerror=alert(1)&gt;')+card('B000000003','Paid product','<span>Sponsored</span>')+card('B000000001','Duplicate')+'</body></html>';
  const jobs=new BrowserJobs({endpoint:'http://127.0.0.1:'+cdpPort,chromium:{connectOverCDP:async(...args)=>{
    const browser=await chromium.connectOverCDP(...args);
    return {contexts:()=>[{newPage:async()=>{const worker=await browser.contexts()[0].newPage();await worker.route('https://www.amazon.com/**',r=>r.fulfill({contentType:'text/html',body:blocked?'<title>Robot Check</title><body>Enter the characters you see below</body>':html}));return worker;}}],close:()=>browser.close()};
  }}});
  const finish=async start=>{for(let i=0;i<200&&jobs.public(start.id).status==='running';i++)await wait(100);return jobs.public(start.id);};
  const done=await finish(jobs.create({mode:'amazon',query:'USB C hub',provider:'auto'}));
  assert.equal(done.status,'done');assert.equal(done.provider,'amazon');assert.equal(done.results.length,2);assert.equal(done.results[0].price,'$19.99');assert.equal(done.results[0].rating,4.6);assert.equal(done.results[0].reviewCount,'1.2K');assert.equal(done.results[1].price,null);assert.equal(done.results[1].rating,null);assert.equal(done.results[0].url,'https://www.amazon.com/dp/B000000001');assert(done.screenshot);assert(done.checkedAt);assert(!jobs.busy);
  blocked=true;const failed=await finish(jobs.create({mode:'amazon',query:'hub'}));assert.equal(failed.status,'error');assert(failed.error.includes('접근 확인'));assert.equal(failed.results.length,0);assert(failed.screenshot);assert(!jobs.busy);
  await page.route('**/api/browser/jobs',r=>{assert.deepEqual(r.request().postDataJSON(),{query:'USB C hub',provider:'amazon',mode:'amazon'});return r.fulfill({status:202,json:done});});
  await page.route('**/api/browser/jobs/'+done.id+'/frame.jpg*',r=>r.fulfill({contentType:'image/jpeg',body:jobs.jobs.get(done.id).frame}));
  assert.deepEqual(await page.locator('#browser-mode option').evaluateAll(opts=>opts.map(o=>o.value)),['restaurants','research','news','amazon']);
  await page.locator('#browser-mode').selectOption('amazon');await page.locator('[data-research-example=amazon]').click();assert.equal(await page.locator('#browser-query-label').textContent(),'상품 검색어');assert(!await page.locator('#browser-source').isVisible());await page.locator('#browser-run').click();await page.waitForFunction(()=>!document.querySelector('#browser-share').disabled);
  assert.equal(await page.locator('.result-card').count(),2);assert((await page.locator('.product-metrics').first().textContent()).includes('$19.99 · 4.6/5 · 리뷰 1.2K'));assert.equal(await page.locator('.result-card img').count(),0);assert(!await page.locator('#browser-summary-run').isVisible());
  await page.setViewportSize({width:390,height:844});await wait(400);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator('#browser-share').click();assert((await page.locator('#share-text').inputValue()).includes('$19.99'));await page.locator('[data-close=share-dialog]').click();
  await page.setViewportSize({width:1440,height:900});await page.locator('[data-close=browser-dialog]').click();
  console.log('Amazon passed: real CDP screenshots, prices/ratings/reviews, absent values, advertisements/deduplication, access challenge, safe UI, sharing and mobile.');
};
