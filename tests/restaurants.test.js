'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {restaurantRequest,sameRestaurant,mergeRestaurants,MAP_SOURCES}=require('../app/restaurant-search');
const {BrowserJobs}=require('../app/browser-jobs');

test('restaurant search takes region and menu, rejecting missing or oversized fields before starting',()=>{
  assert.deepEqual(restaurantRequest('  성수동  ',' 파스타 '),{region:'성수동',menu:'파스타',query:'성수동 파스타'});
  const jobs=new BrowserJobs();
  for(const request of [{menu:'파스타'},{region:'성수동'},{region:' ',menu:'파스타'},{region:'가'.repeat(61),menu:'파스타'},{region:'성수동',menu:'가'.repeat(41)},{region:'성수동\n강남',menu:'파스타'}])assert.throws(()=>jobs.create({mode:'restaurants',...request}),e=>e.status===400);
  assert.equal(jobs.jobs.size,0);assert.equal(jobs.busy,false);
  assert.throws(()=>jobs.create({region:'성수동',menu:'파스타',mode:'restaurants',provider:'google'}),e=>e.status===400);
  assert.equal(new URL(MAP_SOURCES.naver.url('성수동 파스타')).hostname,'map.naver.com');
  assert.equal(new URL(MAP_SOURCES.daum.url('성수동 파스타')).searchParams.get('q'),'성수동 파스타');
});
test('same restaurant requires identity evidence and never merges distinct branches',()=>{
  const a={name:'미테이블 서울숲 성수본점',address:'왕십리로8길 5 1층',lotAddress:'서울특별시 성동구 성수동1가 656-385'};
  const b={name:'미테이블 성수본점',address:'서울 성동구 왕십리로8길 5 1층',lotAddress:'성수동1가 656-385'};
  assert(sameRestaurant(a,b));
  assert(!sameRestaurant({...a,address:'왕십리로8길 8',phone:'0212345678'},{...b,phone:'0212345678'}));
  assert(!sameRestaurant({name:'체인식당',address:'서울 성동구 중앙로 1'},{name:'체인식당',address:'부산 중구 중앙로 1'}));
  assert(!sameRestaurant({name:'체인식당'},{name:'체인식당'}));
  assert(!sameRestaurant({name:'다른가게',address:a.address},a));
  assert(!sameRestaurant({name:'가게',lotAddress:'성수동1가 1',phone:'0212345678'},{name:'가게',lotAddress:'성수동1가 2',phone:'0212345678'}));
});
test('map merge preserves separate ratings and missing values while deduplicating provider IDs',()=>{
  const a={id:'1',name:'동네파스타',address:'연무장길 10',rating:4.92,reviewCount:1500};
  const b={id:'2',name:'동네파스타',address:'서울 성동구 연무장길 10',rating:4.4,ratingCount:20,reviewCount:300};
  const c={id:'3',name:'동네파스타',address:'연무장길 12',rating:null};
  const rows=mergeRestaurants([{provider:'naver',places:[a,a]},{provider:'daum',places:[b,c]}]);
  assert.equal(rows.length,2);assert.equal(rows[0].naver.rating,4.92);assert.equal(rows[0].daum.rating,4.4);
  assert.equal(rows[0].daum.ratingCount,20);assert.equal(rows[0].daum.reviewCount,300);
  assert.equal(rows[1].daum.rating,null);assert.equal(rows[1].naver,undefined);
});
test('restaurant job remains running until its worker finishes cleanup, including failed searches',async()=>{
  let closing,release;
  const reachedClose=new Promise(r=>closing=r),cleanup=new Promise(r=>release=r);
  const page={setViewportSize:async()=>{},goto:async()=>{throw Error('Provider unavailable');},screenshot:async()=>Buffer.from('fixture'),close:async()=>{closing();await cleanup;}};
  const jobs=new BrowserJobs({chromium:{connectOverCDP:async()=>({contexts:()=>[{newPage:async()=>page}],close:async()=>{}})}});
  const start=jobs.create({mode:'restaurants',region:'성수동',menu:'파스타',provider:'auto'});
  await reachedClose;
  assert.equal(jobs.public(start.id).status,'running');assert.equal(jobs.busy,true);
  release();await new Promise(r=>setImmediate(r));
  assert.equal(jobs.public(start.id).status,'error');assert.equal(jobs.busy,false);
});
