'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {planResearch,mergeResults,chooseDocuments,rankDocuments,summarizeResearch}=require('../app/browser-research');
test('AI turns a comparison question into bounded searches; without a model it preserves the request',async()=>{
  const request='Alpha와 Beta의 차이를 공식 자료로 비교해줘.';
  const plan=await planResearch(request,'compare',async(system,user)=>{assert.match(system,/comparisons/);assert.equal(JSON.parse(user).request,request);return JSON.stringify({queries:['Alpha official documentation','Beta official documentation'],objective:'공식 자료 비교'});});
  assert.equal(plan.method,'ai');assert.deepEqual(plan.queries,['Alpha official documentation','Beta official documentation']);
  assert.equal((await planResearch(request,'compare',null)).method,'direct');
  const direct=await planResearch('DGX Spark와 Jetson을 비교해줘. 공식 자료로 차이를 확인해줘.','compare',null);assert.deepEqual(direct.queries,['DGX Spark 공식 자료','Jetson 공식 자료']);
  const primary=await planResearch('DGX Spark의 로컬 AI 활용 사례를 조사해줘. 공식 자료와 실제 사례를 구분해줘.','research',null);assert.deepEqual(primary.queries,['DGX Spark 로컬 AI 활용 사례','DGX Spark 공식 자료']);
  assert.match((await planResearch('최근 일주일 AI 발표를 정리해줘.','news',null)).queries[0],/최근 일주일/);
  await assert.rejects(planResearch(request,'compare',async()=>JSON.stringify({queries:[42]})),e=>e.status===502);
});
test('Cross-source merge removes trackers and duplicates while preserving source attribution',()=>{
  const results=mergeResults([{source:'Naver',query:'Alpha',results:[{title:'Alpha docs',url:'https://docs.example/a?utm_source=naver#top'}]},{source:'Google',query:'Alpha',results:[{title:'Same docs',url:'https://docs.example/a'}]}]);
  assert.equal(results.length,1);assert.equal(results[0].url,'https://docs.example/a');assert.deepEqual(results[0].searchSources,['Naver','Google']);
  assert.equal(mergeResults([{results:[{url:'javascript:alert(1)'},{url:'https://user:secret@example.com/'}]}]).length,0);
});
test('Document selection favors relevance and complementary hosts; AI can select both comparison sides on one host',async()=>{
  const candidates=[{title:'Unrelated',snippet:'',url:'https://random.example/a'},{title:'Alpha official documentation',snippet:'Alpha usage',url:'https://docs.example/alpha'},{title:'Beta official documentation',snippet:'Beta usage',url:'https://docs.example/beta'},{title:'Alpha independent review',snippet:'Alpha',url:'https://review.example/a'}];
  assert.equal(chooseDocuments(candidates,'Alpha',2)[0].title,'Alpha official documentation');
  const selected=await rankDocuments(candidates,'Alpha vs Beta','compare',async()=>JSON.stringify({indices:[1,2]}));assert.deepEqual(selected,candidates.slice(1,3));
  await assert.rejects(rankDocuments(candidates,'Alpha','research',async()=>JSON.stringify({indices:[8]})),e=>e.status===502);
});
test('Synthesis receives actual read text, excludes failed pages, and rejects unsupported citations',async()=>{
  const docs=[{id:1,status:'read',title:'Alpha',url:'https://docs.example/alpha',published:'2026-10-09',text:'Actual original article body, not a search snippet.'},{id:2,status:'unavailable',title:'Beta',url:'https://docs.example/beta',text:'UNREAD SECRET'}];
  const summary=await summarizeResearch('Alpha vs Beta','compare',docs,async(system,user)=>{assert.match(system,/time window/);const data=JSON.parse(user);assert.equal(data.sources.length,1);assert.equal(data.sources[0].text,docs[0].text);assert.equal(data.sources[0].published,'2026-10-09');return JSON.stringify({answer:'Alpha의 근거를 확인했습니다. [1]',limitations:['Beta 원문은 읽지 못했습니다.']});});
  assert.match(summary.answer,/\[1\]/);assert.equal(summary.limitations.length,1);
  await assert.rejects(summarizeResearch('compare','compare',docs,async()=>JSON.stringify({answer:'Beta is better. [2]'})),e=>e.status===502);
  await assert.rejects(summarizeResearch('compare','compare',[],async()=>{throw Error('must not run');}),e=>e.status===409);
});
