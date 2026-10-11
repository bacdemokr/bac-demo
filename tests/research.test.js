'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {planResearch,timeRange,dateValue,documentIssue,matchesTopic,mergeResults,chooseDocuments,rankDocuments,summarizeResearch}=require('../app/browser-research');
const {SOURCES}=require('../app/browser-jobs');
test('AI turns a comparison question into bounded searches; without a model it preserves the request',async()=>{
  const request='Alpha와 Beta의 차이를 공식 자료로 비교해줘.';
  const plan=await planResearch(request,'compare',async(system,user)=>{assert.match(system,/comparisons/);assert.equal(JSON.parse(user).request,request);return JSON.stringify({queries:['Alpha official documentation','Beta official documentation'],objective:'공식 자료 비교'});});
  assert.equal(plan.method,'ai');assert.deepEqual(plan.queries,['Alpha official documentation','Beta official documentation']);
  assert.equal((await planResearch(request,'compare',null)).method,'direct');
  const direct=await planResearch('DGX Spark와 Jetson을 비교해줘. 공식 자료로 차이를 확인해줘.','compare',null);assert.deepEqual(direct.queries,['DGX Spark 공식 자료','Jetson 공식 자료']);
  const primary=await planResearch('DGX Spark의 로컬 AI 활용 사례를 조사해줘. 공식 자료와 실제 사례를 구분해줘.','research',null);assert.deepEqual(primary.queries,['DGX Spark 로컬 AI 활용 사례','DGX Spark 공식 자료']);
  const agent=await planResearch('로컬에서 AI 에이전트를 실행하는 실제 사례를 조사해줘.','research',null);assert.deepEqual(agent.queries,['로컬 AI 에이전트를 실제 사례']);assert(matchesTopic({title:'Local AI agents in practice'},agent));
  assert.deepEqual((await planResearch('최근 일주일 AI 발표를 정리해줘.','news',null)).queries,['AI 발표']);
  await assert.rejects(planResearch(request,'compare',async()=>JSON.stringify({queries:[42]})),e=>e.status===502);
});
test('News request uses short independent topics and a separate Korean calendar period even when AI is verbose',async()=>{
  const now=new Date('2026-10-10T16:00:00Z');
  const request='최근 일주일 NVIDIA와 로컬 AI 관련 주요 발표를 정리해줘. 발표 날짜와 출처도 알려줘.';
  const direct=await planResearch(request,'news',null,now);
  assert.deepEqual(direct.queries,['NVIDIA 발표','로컬 AI 발표']);
  assert.deepEqual(direct.timeRange,{start:'2026-10-05',end:'2026-10-11'});
  const ai=await planResearch(request,'news',async()=>JSON.stringify({queries:['최근 일주일 NVIDIA 관련 주요 발표를 정리해줘.','최근 일주일 로컬 AI 관련 주요 발표를 정리해줘.']}),now);
  assert.deepEqual(ai.queries,direct.queries);assert.deepEqual(ai.timeRange,direct.timeRange);
  const verbose=await planResearch(request,'news',async()=>JSON.stringify({queries:['NVIDIA 로컬 AI 새로운 개발 발표 하드웨어 소프트웨어 관련 활용 사례 구현 비교 제품 뉴스 발표']}),now);
  assert.equal(verbose.method,'direct');assert.deepEqual(verbose.queries,direct.queries);
  assert.deepEqual(timeRange('지난 3일 발표',now),{start:'2026-10-09',end:'2026-10-11'});
  assert.deepEqual(timeRange('어제 뉴스',now),{start:'2026-10-10',end:'2026-10-10'});
  assert.deepEqual(timeRange('2026-09-01부터 2026-09-07까지 발표',now),{start:'2026-09-01',end:'2026-09-07'});
  assert.deepEqual(timeRange('2026-09-01 발표',now),{start:'2026-09-01',end:'2026-09-01'});
  assert.equal(dateValue('2026-02-30'),null);assert.equal(dateValue('2026.10.09. 08:25'),'2026-10-09');
  assert.equal(dateValue('2026-10-10T16:00:00Z'),'2026-10-11');
  for(const source of [SOURCES.naver,SOURCES.daum]){const url=new URL(source.newsUrl(direct.queries[0],direct.timeRange));assert(url.searchParams.has('pd')||url.searchParams.has('period'));assert.match(url.href,/20261005|2026.10.05/);assert.match(url.href,/20261011|2026.10.11/);}
});
test('Unrelated pages never fill evidence slots; original topic and publication date are checked after navigation',async()=>{
  const request='최근 일주일 NVIDIA와 로컬 AI 발표를 정리해줘.';
  const plan=await planResearch(request,'news',null,new Date('2026-10-11T00:00:00Z'));
  const unrelated={title:'네이버 LOCAL WEEK 진행',snippet:'지역 사회 활동에 AI를 활용합니다.',url:'https://example.com/unrelated'};
  assert.equal(matchesTopic(unrelated,plan),false);
  const nvidia={title:'엔비디아 신제품 발표',snippet:'제품 출시 소식',url:'https://nvidia.com/new',published:'2026-10-09'};
  assert.equal(matchesTopic(nvidia,plan),true);
  assert.deepEqual(chooseDocuments([unrelated,nvidia],request,5,plan),[nvidia]);
  assert.deepEqual(await rankDocuments([unrelated,nvidia],request,'news',async(system,user)=>{assert.equal(JSON.parse(user).candidates.length,1);return JSON.stringify({indices:[0,1]});},5,plan),[nvidia]);
  assert.match(documentIssue({...unrelated,text:'Unrelated body'},plan),/주제/);
  assert.match(documentIssue({...nvidia,published:'2025-10-09'},plan),/기간 밖/);
  assert.match(documentIssue({...nvidia,published:''},plan),/게시일/);
  assert.equal(documentIssue(nvidia,plan),null);
  assert.equal(matchesTopic({title:'Local AI runs offline',text:'A new local LLM release'},plan),true);
  assert.equal(matchesTopic({title:'케이블TV, 로컬 AI 주권 선언',text:'지역 주민과 전통시장의 AI 교육 정책'},plan),false);
  assert.equal(matchesTopic({title:'지역 기업, 로컬 AI 추론 도입',text:'기업 PC에서 모델을 실행해 프라이버시 보호'},plan),true);
});
test('Cross-source merge removes trackers and duplicates while preserving source attribution',()=>{
  const results=mergeResults([{source:'Naver',query:'Alpha',results:[{title:'Alpha docs',url:'https://docs.example/a?utm_source=naver#top'}]},{source:'Google',query:'Alpha',results:[{title:'Same docs',url:'https://docs.example/a'}]}]);
  assert.equal(results.length,1);assert.equal(results[0].url,'https://docs.example/a');assert.deepEqual(results[0].searchSources,['Naver','Google']);
  assert.equal(mergeResults([{results:[{url:'javascript:alert(1)'},{url:'https://user:secret@example.com/'}]}]).length,0);
  const many=mergeResults(['Alpha','Beta'].map(query=>({query,source:'Naver',results:Array.from({length:25},(_,i)=>({title:query,url:`https://example.com/${query}/${i}`}))})));
  assert.equal(many.length,30);assert(many.filter(r=>r.title==='Beta').length>=10,'Second topic must survive the result limit.');
});
test('Document selection favors relevance and complementary hosts; AI can select both comparison sides on one host',async()=>{
  const candidates=[{title:'Unrelated',snippet:'',url:'https://random.example/a'},{title:'Alpha official documentation',snippet:'Alpha usage',url:'https://docs.example/alpha'},{title:'Beta official documentation',snippet:'Beta usage',url:'https://docs.example/beta'},{title:'Alpha independent review',snippet:'Alpha',url:'https://review.example/a'}];
  assert.equal(chooseDocuments(candidates,'Alpha',2)[0].title,'Alpha official documentation');
  const selected=await rankDocuments(candidates,'Alpha vs Beta','compare',async()=>JSON.stringify({indices:[1,2]}));assert.deepEqual(selected.slice(0,2),candidates.slice(1,3));assert(!selected.includes(candidates[0]));
  const nvidia=Array.from({length:6},(_,i)=>({title:'NVIDIA announcement '+i,snippet:'',url:'https://example.com/nvidia/'+i}));
  const local={title:'Local AI announcement',snippet:'',url:'https://example.com/local'};
  const mixed=chooseDocuments([...nvidia,local],'NVIDIA와 로컬 AI 발표',3,{queries:['NVIDIA 발표','로컬 AI 발표']});
  assert(mixed.includes(local),'Each separate topic should get an evidence slot.');
  await assert.rejects(rankDocuments(candidates,'Alpha','research',async()=>JSON.stringify({indices:[8]})),e=>e.status===502);
});
test('Synthesis receives actual read text, excludes failed pages, and rejects unsupported citations',async()=>{
  const docs=[{id:1,status:'read',title:'Alpha',url:'https://docs.example/alpha',published:'2026-10-09',text:'Actual original article body, not a search snippet.'},{id:2,status:'unavailable',title:'Beta',url:'https://docs.example/beta',text:'UNREAD SECRET'},{id:3,status:'excluded',title:'Off-topic',text:'OFFTOPIC SECRET'}];
  const summary=await summarizeResearch('Alpha vs Beta','compare',docs,async(system,user)=>{assert.match(system,/time window/);const data=JSON.parse(user);assert.equal(data.sources.length,1);assert.equal(data.sources[0].text,docs[0].text);assert.equal(data.sources[0].published,'2026-10-09');return JSON.stringify({answer:'Alpha의 근거를 확인했습니다. [1]',limitations:['Beta 원문은 읽지 못했습니다.']});});
  assert.match(summary.answer,/\[1\]/);assert.equal(summary.limitations.length,1);
  await assert.rejects(summarizeResearch('compare','compare',docs,async()=>JSON.stringify({answer:'Beta is better. [2]'})),e=>e.status===502);
  await assert.rejects(summarizeResearch('compare','compare',[],async()=>{throw Error('must not run');}),e=>e.status===409);
});
