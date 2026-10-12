'use strict';
const {Problem}=require('./integrations');
const AMAZON={name:'Amazon',url:q=>'https://www.amazon.com/s?k='+encodeURIComponent(q)};
// Runs in the worker tab. Use displayed values; do not infer missing prices or ratings.
function extractAmazonProducts(){
  const seen=new Set(),products=[];
  for(const row of document.querySelectorAll('[data-component-type="s-search-result"][data-asin]')){
    const asin=row.getAttribute('data-asin');
    if(!/^[A-Z0-9]{10}$/.test(asin)||seen.has(asin))continue;
    const text=row.innerText||'';
    if(/\bSponsored\b|스폰서|광고/.test(text)||row.querySelector('[data-component-type="sp-sponsored-result"],.puis-sponsored-label-text'))continue;
    const title=(row.querySelector('h2')?.innerText||'').replace(/\s+/g,' ').trim();
    if(!title)continue;
    seen.add(asin);
    const ratingText=row.querySelector('.a-icon-alt')?.textContent||'';
    const ratingMatch=ratingText.match(/([0-5](?:\.\d+)?)\s*(?:out of 5|5점)/);
    const rating=ratingMatch?Number(ratingMatch[1]):null;
    const reviewNode=row.querySelector('a[href*="customerReviews"] .a-size-base,a[href*="customerReviews"] span[aria-label],a[href*="customerReviews"]');
    const reviewCount=(reviewNode?.textContent||text.match(/out of 5 stars\s*\(?([\d.,]+[KM]?)\)?/i)?.[1]||'').replace(/\s+/g,' ').trim();
    const price=(row.querySelector('.a-price:not(.a-text-price) .a-offscreen')?.textContent||'').replace(/\s+/g,' ').trim();
    products.push({asin,title:title.slice(0,400),url:'https://www.amazon.com/dp/'+asin,price:price.slice(0,80)||null,rating:rating!==null&&rating<=5?rating:null,reviewCount:reviewCount.slice(0,80)||null});
    if(products.length===20)break;
  }
  const blocked=/captcha|robot check|verify (?:that )?you are human|enter the characters|access denied|website filtered|로봇|보안 문자/i.test(document.title+' '+(document.body?.innerText||'').slice(0,3000));
  return {products,blocked};
}
async function searchAmazon({job,endpoint,chromium,event}){
  let browser,page;
  try{
    event('connect','Chromium 연결 확인');
    browser=await (chromium||require('playwright-core').chromium).connectOverCDP(endpoint,{timeout:5000});
    page=await (browser.contexts()[0]||await browser.newContext()).newPage();await page.setViewportSize({width:1280,height:800});
    const capture=async()=>{try{job.frame=await page.screenshot({type:'jpeg',quality:65,animations:'disabled',timeout:5000});job.revision++;}catch{job.note='일부 화면 캡처를 완료하지 못했습니다.';}};
    event('search','Amazon 상품 검색: '+job.query);
    await page.goto(job.url,{waitUntil:'domcontentloaded',timeout:30000});job.url=page.url();job.title=await page.title();await capture();
    await page.waitForTimeout(1000);
    event('scroll','검색 결과를 내려 상품 정보 확인');
    for(const y of [600,1200]){await page.evaluate(y=>window.scrollTo(0,y),y);await page.waitForTimeout(350);await capture();}
    const {products,blocked}=await page.evaluate(extractAmazonProducts);
    if(blocked)throw new Problem('Amazon에서 접근 확인을 요청하고 있습니다. 잠시 후 다시 검색하거나 Amazon에서 직접 확인해주세요.',502);
    if(!products.length)throw new Problem('Amazon 상품 정보를 읽지 못했습니다. 실제 화면에서 검색 결과 또는 접근 제한을 확인해주세요.',502);
    job.products=products;job.results=products;job.checkedAt=new Date().toISOString();
    job.note=`상품 ${products.length}개 확인 · 광고 제외 · 화면의 통화 기준 · 배송비·세금 제외`;
    event('extract',`상품 ${products.length}개의 가격·평점 확인`);
    await page.evaluate(()=>window.scrollTo(0,0));await capture();event('done','상품 검색 완료');
  }catch(error){job.status='error';job.error=job.stage==='connect'?'Chromium에 연결할 수 없습니다. 브라우저 연결을 확인해주세요.':error instanceof Problem?error.message:'Amazon 검색을 완료하지 못했습니다. 네트워크와 실제 화면을 확인해주세요.';event('error',job.error);}
  finally{if(page)await page.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});if(job.status==='running')job.status='done';}
}
module.exports={AMAZON,extractAmazonProducts,searchAmazon};
