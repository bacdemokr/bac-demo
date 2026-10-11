'use strict';
const {Problem}=require('./integrations');

const MAP_SOURCES={
  naver:{name:'네이버지도',url:q=>'https://map.naver.com/p/search/'+encodeURIComponent(q)},
  daum:{name:'카카오맵',url:q=>'https://map.kakao.com/?q='+encodeURIComponent(q)},
};
function restaurantRequest(region,menu){
  if(typeof region!=='string'||typeof menu!=='string'||!region.trim()||!menu.trim())throw new Problem('지역과 메뉴를 모두 입력해주세요.');
  if(region.length>60||menu.length>40||/[\r\n\x00-\x1f]/.test(region+menu))throw new Problem('지역은 60자, 메뉴는 40자 이내로 입력해주세요.');
  return {region:region.trim().replace(/\s+/g,' '),menu:menu.trim().replace(/\s+/g,' '),query:(region.trim()+' '+menu.trim()).replace(/\s+/g,' ')};
}

// Runs in a map page/frame. Numbers come only from the rendered rating labels.
function extractRestaurants(provider){
  const text=e=>(e?.innerText||e?.textContent||'').replace(/\s+/g,' ').trim();
  const count=value=>{const m=String(value).replaceAll(',','').match(/(\d+(?:\.\d+)?)\s*(만|천)?/);if(!m)return null;const n=Number(m[1])*(m[2]==='만'?10000:m[2]==='천'?1000:1);return Number.isFinite(n)&&n>=0&&n<=1e8?Math.round(n):null;};
  const rating=value=>{const n=Number(value);return value&&Number.isFinite(n)&&n>0&&n<=5?n:null;};
  const visible=e=>!!e&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';
  if(provider==='daum')return [...document.querySelectorAll('li.PlaceItem')].flatMap(item=>{
    const name=text(item.querySelector('[data-id="name"],.link_name'));
    const link=item.querySelector('[data-id="moreview"],a.moreview');
    const id=link?.href.match(/place\.map\.kakao\.com\/(\d+)/)?.[1];if(!name||!id)return [];
    const score=item.querySelector('[data-id="scoreNum"],.score .num');
    const ratingText=visible(score)?text(score):'';
    const ratingCountText=text(item.querySelector('[data-id="numberofscore"],.numberofscore'));
    return [{id,name,address:text(item.querySelector('[data-id="address"]')),lotAddress:text(item.querySelector('[data-id="otherAddr"]')).replace(/^\(지번\)\s*/,''),phone:text(item.querySelector('[data-id="phone"]')),category:text(item.querySelector('[data-id="subcategory"]')),url:'https://place.map.kakao.com/'+id,rating:rating(ratingText),ratingText:rating(ratingText)!==null?ratingText:'',ratingCount:count(ratingCountText),ratingCountText,reviewCount:count(text(item.querySelector('[data-id="numberofreview"]'))),reviewCountText:text(item.querySelector('[data-id="numberofreview"]'))}];
  });
  const cache=window.__APOLLO_STATE__||{},entities=Object.values(cache).filter(v=>v&&typeof v==='object'&&v.id&&v.name);
  return [...document.querySelectorAll('li')].flatMap(item=>{
    const anchor=item.querySelector('a[data-nlog-params]:has(.TYaxT)');if(!anchor)return [];
    let params;try{params=JSON.parse(anchor.getAttribute('data-nlog-params'));}catch{return [];}
    const id=String(params.place_id||'');if(!/^\d+$/.test(id))return [];
    // Sponsored copies are not used to establish the ranking.
    const advertised=[...item.querySelectorAll('[data-nlog-params]')].some(a=>{try{return JSON.parse(a.getAttribute('data-nlog-params')).is_ad===true;}catch{return false;}});
    if(advertised)return [];
    const name=text(anchor.querySelector('.TYaxT'));if(!name)return [];
    const entity=entities.find(v=>String(v.id)===id&&v.__typename==='PlaceListBusinessesItem')||entities.find(v=>String(v.id)===id)||{};
    const metrics=item.querySelector('.Dr_06')||item;
    const score=[...metrics.querySelectorAll('span')].find(s=>s.querySelector('.place_blind')?.textContent.trim()==='별점');
    const ratingText=visible(score)?text(score).replace(/^별점\s*/,''):'';
    const reviewText=[...metrics.querySelectorAll('span')].map(text).find(t=>/^리뷰\s*[\d,.]/.test(t))||'';
    const reviewCountText=reviewText.replace(/^리뷰\s*/,'');
    return [{id,name,address:String(entity.roadAddress||entity.fullAddress||''),lotAddress:String(entity.fullAddress||entity.address||''),phone:String(entity.phone||''),category:text(anchor.querySelector('.KCMnt')),url:'https://map.naver.com/p/entry/place/'+id,rating:rating(ratingText),ratingText:rating(ratingText)!==null?ratingText:'',ratingCount:null,ratingCountText:'',reviewCount:count(reviewCountText),reviewCountText}];
  });
}
function normalize(value){return String(value||'').normalize('NFKC').toLowerCase().replace(/[\s()㈜·.,_-]/g,'');}
function street(address){const m=String(address||'').match(/(?:^|\s)([\p{L}\p{N}]+(?:대로|로|길))\s+(\d+(?:-\d+)?)(?=\s|$)/u);return m?normalize(m[1]+m[2]):'';}
function lot(address){return normalize(String(address||'').match(/([\p{L}\p{N}]+(?:동\d*가|동|읍|면|리))\s+(\d+(?:-\d+)?)/u)?.[0]||'');}
function nameSimilar(a,b){
  a=normalize(a);b=normalize(b);if(a===b)return true;if(Math.min(a.length,b.length)<3)return false;
  const pairs=s=>new Set(Array.from({length:s.length-1},(_,i)=>s.slice(i,i+2))),x=pairs(a),y=pairs(b);
  return [...x].filter(p=>y.has(p)).length/Math.min(x.size,y.size)>=.8;
}
function sameRestaurant(a,b){
  if(!nameSimilar(a.name,b.name))return false;
  const district=value=>String(value||'').match(/(?:^|\s)([가-힣]+[시군구])(?=\s)/g)?.at(-1)?.trim()||'';
  const areaA=district(a.address+' '+a.lotAddress),areaB=district(b.address+' '+b.lotAddress);
  if(areaA&&areaB&&areaA!==areaB)return false;
  const roadA=street(a.address),roadB=street(b.address);
  // Different known buildings always mean different branches, even with a shared phone.
  if(roadA&&roadB&&roadA!==roadB)return false;
  if(roadA&&roadB&&roadA===roadB)return true;
  const lotA=lot(a.lotAddress),lotB=lot(b.lotAddress);if(lotA&&lotB){if(lotA===lotB)return true;return false;}
  const phoneA=String(a.phone||'').replace(/\D/g,''),phoneB=String(b.phone||'').replace(/\D/g,'');
  return phoneA.length>=9&&phoneA===phoneB;
}
function mergeRestaurants(groups){
  const rows=[],seen=new Set();
  for(const group of groups)for(const place of group.places||[]){
    const key=group.provider+':'+place.id;if(seen.has(key))continue;seen.add(key);
    const existing=rows.find(row=>!row[group.provider]&&Object.values(row.sources).some(other=>sameRestaurant(other,place)));
    const row=existing||{id:key,name:place.name,address:place.address||place.lotAddress||'',sources:{}};
    row[group.provider]=place;row.sources[group.provider]=place;
    if(!existing)rows.push(row);
    if((place.address||'').length>row.address.length)row.address=place.address;
  }
  return rows;
}
async function searchRestaurants({job,endpoint,chromium,sources=MAP_SOURCES,event}){
  let browser,page;const groups=[];
  try{
    event('connect','지도 검색 브라우저 연결');
    browser=await (chromium||require('playwright-core').chromium).connectOverCDP(endpoint,{timeout:5000});
    const context=browser.contexts()[0]||await browser.newContext();page=await context.newPage();await page.setViewportSize({width:1280,height:800});
    const capture=async()=>{try{job.frame=await page.screenshot({type:'jpeg',quality:65,animations:'disabled',timeout:4000});job.revision++;}catch{}};
    const keys=job.provider==='auto'?['naver','daum'].filter(k=>sources[k]):[job.provider];
    job.plan={queries:[job.query],mode:'restaurants',method:'keywords',timeRange:null};
    for(const key of keys){
      const source=sources[key],group={provider:key,source:source.name,query:job.query,url:source.url(job.query),places:[],results:[]};groups.push(group);job.searches=groups;
      event('search',source.name+': '+job.query);
      try{
        await page.goto(group.url,{waitUntil:'domcontentloaded',timeout:25000});job.url=page.url();job.title=await page.title();await capture();
        let frame;
        for(let attempt=0;attempt<24;attempt++){
          frame=key==='naver'?(page.frame({name:'searchIframe'})||page):page;
          group.places=await frame.evaluate(extractRestaurants,key).catch(()=>[]);
          if(group.places.length)break;
          const text=await frame.locator('body').innerText({timeout:800}).catch(()=>'');
          if(/보안 문자|접근이 제한|비정상적인 접근|verify you are human/i.test(text))break;
          await page.waitForTimeout(500);
        }
        if(group.places.length){
          event('scroll',source.name+' 목록을 내려 추가 후보 확인');
          for(let step=0;step<3;step++){
            await frame.evaluate(()=>{const el=document.getElementById('_pcmap_list_scroll_container')||document.getElementById('info.search');if(el)el.scrollTop=el.scrollHeight;else window.scrollTo(0,document.body.scrollHeight);});
            await page.waitForTimeout(400);const more=await frame.evaluate(extractRestaurants,key);
            group.places=[...new Map([...group.places,...more].map(p=>[p.id,p])).values()].slice(0,50);await capture();
          }
          if(key==='daum')for(let next=0;next<2;next++){
            const more=page.locator('[id="info.search.place.more"]');
            const current=await page.locator('[id="info.search.page"] a.ACTIVE').textContent({timeout:500}).catch(()=>'1');
            const button=await more.isVisible()?more:page.locator('[id="info.search.page.no'+(Number(current)+1)+'"]');
            if(!await button.isVisible())break;
            const seen=new Set(group.places.map(p=>p.id));
            event('page',source.name+' 다음 결과 페이지 확인');
            try{await button.click({timeout:3000});}catch{group.warning='다음 결과 페이지를 확인하지 못해 읽은 후보만 표시합니다.';break;}
            let added=false;
            for(let attempt=0;attempt<12;attempt++){
              await page.waitForTimeout(400);const places=await page.evaluate(extractRestaurants,key);
              if(places.some(p=>!seen.has(p.id))){group.places=[...new Map([...group.places,...places].map(p=>[p.id,p])).values()].slice(0,50);added=true;break;}
            }
            await capture();if(!added)break;
          }
          group.checkedAt=new Date().toISOString();
          group.results=group.places.map(p=>({title:p.name,url:p.url}));
          event('extract',`${source.name} ${group.places.length}곳 · 별점 ${group.places.filter(p=>p.rating!==null).length}곳 확인`);
        }else{group.error='검색 결과를 읽지 못했습니다. 지도에서 직접 확인해주세요.';event('search-error',source.name+' 결과를 읽지 못했습니다.');}
      }catch{group.error='지도 페이지에 접근하지 못했습니다. 다른 지도 결과를 계속 확인합니다.';event('search-error',source.name+' 접근 실패');}
      group.results=group.places.map(p=>({title:p.name,url:p.url}));
      if(group.places.length&&!group.checkedAt)group.checkedAt=new Date().toISOString();
      job.restaurants=mergeRestaurants(groups);
      job.results=groups.flatMap(g=>g.results);await capture();
    }
    job.checkedAt=new Date().toISOString();
    job.note=`네이버지도 ${groups.find(g=>g.provider==='naver')?.places.length||0}곳 · 카카오맵 ${groups.find(g=>g.provider==='daum')?.places.length||0}곳 · 중복 확인 후 ${job.restaurants.length}곳`;
    if(!job.restaurants.length)throw new Problem('확인한 식당이 없습니다. 지역·메뉴 또는 지도 접근 상태를 확인해주세요.',502);
    event('done','식당 평점 비교 완료');
  }catch(error){job.error=job.stage==='connect'?'Chromium에 연결할 수 없습니다. 설치 안내에 따라 CDP 브라우저를 실행해주세요.':error instanceof Problem?error.message:'맛집 검색을 완료하지 못했습니다.';event('error',job.error);}
  finally{if(page)await page.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});job.status=job.error?'error':'done';}
}
module.exports={MAP_SOURCES,restaurantRequest,extractRestaurants,sameRestaurant,mergeRestaurants,searchRestaurants};
