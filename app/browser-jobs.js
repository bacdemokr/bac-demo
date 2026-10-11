"use strict";
const { randomUUID } = require("crypto");
const { Problem } = require("./integrations");
const {planResearch,mergeResults,chooseDocuments,rankDocuments,summarizeResearch,extractDocument}=require("./browser-research");

const SOURCES = {
  naver: { name: "Naver", newsUrl:q=>`https://search.naver.com/search.naver?where=news&sort=1&query=${encodeURIComponent(q)}`, url: q => `https://search.naver.com/search.naver?query=${encodeURIComponent(q)}` },
  google: { name: "Google", newsUrl:q=>`https://www.google.com/search?tbm=nws&q=${encodeURIComponent(q)}`, url: q => `https://www.google.com/search?q=${encodeURIComponent(q)}` },
  daum: { name: "Daum", newsUrl:q=>`https://search.daum.net/search?w=news&q=${encodeURIComponent(q)}`, url: q => `https://search.daum.net/search?w=tot&q=${encodeURIComponent(q)}` },
};

// Executed in the page. Prefer actual result titles over navigation or ads.
function extractSearchResults() {
  const seen = new Set();
  const preferred = document.querySelectorAll('a:has(.sds-comps-text-type-headline1), a.title_link, a.news_tit, a.api_txt_lines.total_tit, #search a:has(h3), #rso a:has(h3), #webdocColl a:has(.tit)');
  const candidates = preferred.length ? [...preferred] : [...document.querySelectorAll('a[href]')];
  return candidates.flatMap(a => {
    if (a.closest('header,footer,nav,[role="navigation"],#power_link,.ad_section')) return [];
    const heading = a.querySelector('.sds-comps-text-type-headline1,h3,.tit');
    const title = (heading?.innerText || a.innerText || '').replace(/새 창 열림/g,'').replace(/\s+/g,' ').trim();
    let url;
    try {
      url = new URL(a.href);
      if (/google\.com$/.test(url.hostname) && url.pathname === '/url' && url.searchParams.get('q')) url = new URL(url.searchParams.get('q'));
    } catch { return []; }
    if (!/^https?:$/.test(url.protocol) || title.length < (preferred.length ? 3 : 15) || title.length > 250) return [];
    if (/^(search\.naver\.com|(?:www|accounts|support)\.google\.com|search\.daum\.net)$/.test(url.hostname)) return [];
    if (/(^|\.)(help|nid|ader|adcr|keep|pay)\.naver\.com$/.test(url.hostname)) return [];
    url.hash = '';
    if (seen.has(url.href)) return [];
    seen.add(url.href);
    const snippet = (a.closest('article,.fds-web-doc-root,.g,.c-container,li,.total_wrap,.wrap_cont')?.innerText || '').replace(/새 창 열림/g,'').replace(/\s+/g,' ').trim().slice(0,450);
    return [{title,url:url.href,snippet}];
  }).slice(0,12);
}

class BrowserJobs {
  constructor({ endpoint = "http://127.0.0.1:9222", chromium, sources = SOURCES, ask = null } = {}) {
    this.endpoint = endpoint; this.chromium = chromium; this.sources = sources; this.ask = ask; this.jobs = new Map(); this.busy = false;
  }
  create({ query, provider = "naver", mode = "search" }) {
    if (!["search","research","news","compare"].includes(mode)) throw new Problem("조사 방식을 확인해주세요.");
    const maxLength=mode==='search'?240:600;
    if (typeof query !== "string" || !query.trim() || query.length > maxLength) throw new Problem(`조사 요청은 1-${maxLength}자로 입력해주세요.`);
    if (provider !== "auto" && !Object.hasOwn(this.sources, provider)) throw new Problem("지원하는 검색 소스를 선택해주세요.");
    if (this.busy) throw new Problem("브라우저가 탐색 중입니다. 현재 작업이 끝난 뒤 실행해주세요.", 409);
    for (const [id, job] of this.jobs) if (Date.now() - job.at > 600000) this.jobs.delete(id);
    while (this.jobs.size >= 12) this.jobs.delete(this.jobs.keys().next().value);
    const sourceKey=provider==='auto'?['naver','daum',...Object.keys(this.sources).filter(key=>key!=='google')].find(key=>this.sources[key]):provider;
    if(!sourceKey)throw new Problem('자동 조사에 사용할 검색원이 없습니다. Naver 또는 Daum을 연결해주세요.');
    const source = this.sources[sourceKey];
    const job = { id: randomUUID(), query: query.trim(), provider, mode, source: provider === "auto" && mode !== "search" ? "여러 검색원" : source.name, url: source.url(query.trim()), status: "running", events: [], results: [], documents: [], searches: [], plan:null, summary:null, frame: null, revision: 0, at: Date.now() };
    this.jobs.set(job.id, job); this.busy = true;
    (mode === "search" ? this.run(job) : this.research(job)).finally(() => { this.busy = false; });
    return this.public(job.id);
  }
  event(job, stage, text) { job.stage = stage; job.events.push({ stage, text, at: Date.now() }); }
  public(id) {
    const job = this.jobs.get(id);
    if (!job) throw new Problem("브라우저 작업이 만료되었습니다. 다시 실행해주세요.", 404);
    const { frame, ...data } = job;
    return { ...data, documents:job.documents.map(({text,...d})=>d), screenshot: frame ? `/api/browser/jobs/${id}/frame.jpg?v=${job.revision}` : null };
  }
  evidence(id) {
    this.public(id);
    const job=this.jobs.get(id);
    return {request:job.query,mode:job.mode,plan:job.plan,results:job.results,documents:job.documents,searches:job.searches};
  }
  async research(job) {
    let browser,page;
    const started=Date.now();
    const ask=this.ask?.();
    try {
      this.event(job,"connect","Chromium 연결 확인");
      browser=await (this.chromium||require('playwright-core').chromium).connectOverCDP(this.endpoint,{timeout:5000});
      const context=browser.contexts()[0]||await browser.newContext();page=await context.newPage();await page.setViewportSize({width:1280,height:800});
      const capture=async()=>{try{job.frame=await page.screenshot({type:'jpeg',quality:65,animations:'disabled',timeout:4000});job.revision++;}catch{job.note='일부 화면 캡처를 완료하지 못했습니다.';}};
      this.event(job,"plan","조사 요청을 검색 질문으로 정리");
      try {job.plan=await planResearch(job.query,job.mode,ask);} catch {job.plan=await planResearch(job.query,job.mode,null);job.warnings=['AI 검색 계획을 만들지 못해 요청에서 검색어를 추렸습니다.'];}
      this.event(job,"planned",`검색어: ${job.plan.queries.join(' / ')}`);
      const keys=job.provider==='auto'?['naver','daum'].filter(k=>this.sources[k]):[job.provider];
      if(!keys.length)keys.push(...Object.keys(this.sources).filter(key=>key!=='google').slice(0,2));
      const groups=[];
      for(const query of job.plan.queries)for(const key of keys){
        if(Date.now()-started>150000)break;
        const source=this.sources[key],target=(job.mode==='news'&&source.newsUrl?source.newsUrl:source.url)(query);
        const group={source:source.name,query,url:target,results:[]};groups.push(group);job.searches=groups;
        this.event(job,"search",`${source.name}: ${query}`);
        try{
          await page.goto(target,{waitUntil:'domcontentloaded',timeout:20000});job.url=page.url();job.title=await page.title();await capture();await page.waitForTimeout(500);
          await page.evaluate(()=>window.scrollTo(0,700));await page.waitForTimeout(250);await capture();
          group.results=await page.evaluate(extractSearchResults);this.event(job,"search-done",`${source.name}에서 후보 ${group.results.length}개 확인`);
          if(!group.results.length)group.error='검색 결과를 읽을 수 없습니다. 접근 제한 또는 결과 없음 상태를 확인해주세요.';
        }catch{group.error='검색 페이지 접근 실패';this.event(job,"search-error",`${source.name} 검색을 완료하지 못했습니다. 다른 검색원을 계속 확인합니다.`);}
        job.results=mergeResults(groups);
      }
      if(!job.results.length)throw new Problem('검색 결과를 얻지 못했습니다. 실제 화면과 검색원별 오류를 확인해주세요.',502);
      let selected;
      this.event(job,'selecting','질문에 맞는 원문 후보 선정');
      try{selected=await rankDocuments(job.results,job.query,job.mode,ask,5);}catch{selected=chooseDocuments(job.results,job.query,5);(job.warnings||=[]).push('AI 후보 선정을 완료하지 못해 관련성·출처 다양성 기준을 사용했습니다.');}
      this.event(job,"select",`원문 후보 ${selected.length}개 선정 · 읽을 수 있는 본문 최대 3개 확인`);
      for(const [index,result] of selected.entries()){
        if(job.documents.filter(d=>d.status==='read').length>=3||Date.now()-started>210000)break;
        const doc={id:index+1,title:result.title,url:result.url,status:'reading',searchSources:result.searchSources};job.documents.push(doc);
        this.event(job,"open",`[${doc.id}] 원문 열기: ${doc.title}`);
        try{
          await page.goto(result.url,{waitUntil:'domcontentloaded',timeout:14000});job.url=page.url();job.title=await page.title();await page.waitForTimeout(600);await capture();
          await page.evaluate(()=>window.scrollTo(0,700));await page.waitForTimeout(250);await capture();
          const contentFrame=page.frames().find(f=>f.name()==='mainFrame')||page;
          Object.assign(doc,await contentFrame.evaluate(extractDocument),{url:page.url(),readAt:new Date().toISOString()});
          if(doc.status!=='read'){doc.error='원문을 읽을 수 없습니다. 접근 제한이나 본문 길이를 확인해주세요.';this.event(job,"read-error",`[${doc.id}] 원문 읽기 실패`);}else this.event(job,"read",`[${doc.id}] 본문 확인${doc.published?' · 게시일 '+doc.published:''}`);
        }catch{doc.status='unavailable';doc.error='페이지 접근 또는 본문 읽기 실패';this.event(job,"read-error",`[${doc.id}] 원문을 읽지 못해 근거에서 제외`);}
      }
      const count=job.documents.filter(d=>d.status==='read').length;
      if(ask&&count){this.event(job,"synthesize","읽은 원문을 대조하고 출처를 붙여 답변 작성");try{job.summary=await summarizeResearch(job.query,job.mode,job.documents,ask);}catch(e){job.summaryError=e.message;this.event(job,"summary-error","AI 정리를 완료하지 못했습니다. 읽은 근거는 아래에서 확인할 수 있습니다.");}}
      else job.summaryError=count?'AI 실행 서비스에 자동 연결하지 못했습니다. 아래에는 실제 읽은 원문을 표시합니다.':'읽을 수 있는 원문이 없어 답변을 만들지 않았습니다.';
      job.note=`검색원 ${groups.length}회 확인 · 후보 ${job.results.length}개 · 원문 ${count}/${job.documents.length}개 읽음`;
      this.event(job,"done","조사 완료");
    }catch(error){job.status='error';job.error=job.stage==='connect'?'Chromium에 연결할 수 없습니다. 설치 안내에 따라 CDP 브라우저를 실행해주세요.':error instanceof Problem?error.message:'조사를 완료하지 못했습니다. 실행 기록과 네트워크 상태를 확인해주세요.';this.event(job,"error",job.error);}
    finally{if(page)await page.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});if(job.status==='running')job.status='done';this.busy=false;}
  }
  async run(job) {
    let browser, page;
    try {
      this.event(job, "connect", "Chromium 연결 확인");
      const chromium = this.chromium || require("playwright-core").chromium;
      browser = await chromium.connectOverCDP(this.endpoint, { timeout: 5000 });
      const context = browser.contexts()[0] || await browser.newContext();
      page = await context.newPage();
      await page.setViewportSize({ width: 1280, height: 800 });
      const capture = async () => {
        job.frame = await page.screenshot({ type: "jpeg", quality: 65, animations: "disabled", timeout: 7000 });
        job.revision++;
      };
      this.event(job, "navigate", `${job.source}에서 검색: ${job.query}`);
      await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: 30000 });
      job.url = page.url(); job.title = await page.title();
      await capture();
      this.event(job, "observe", "실제 페이지 화면 확인");
      await page.waitForTimeout(1000);
      await capture();
      this.event(job, "scroll", "페이지를 내려 검색 결과 확인");
      for (const y of [450, 900]) {
        await page.evaluate(y => window.scrollTo({ top: y, behavior: "instant" }), y);
        await page.waitForTimeout(600); await capture();
      }
      job.results = await page.evaluate(extractSearchResults);
      this.event(job, "extract", `${job.results.length}개 링크 추출`);
      if (!job.results.length) {
        job.note = "링크를 추출하지 못했습니다. 실제 화면에서 검색 결과 또는 사이트의 접근 제한을 확인해주세요.";
      }
      await page.evaluate(() => window.scrollTo(0, 0)); await capture();
      this.event(job, "done", "브라우저 탐색 완료");
    } catch (error) {
      job.status = "error";
      job.error = job.stage === "connect"
        ? "Chromium에 연결할 수 없습니다. 설치 안내에 따라 CDP 브라우저를 실행해주세요."
        : "페이지 탐색을 완료하지 못했습니다. 사이트의 접근 제한 또는 네트워크를 확인해주세요.";
      this.event(job, "error", job.error);
    } finally {
      // A worker tab only. Disconnect the CDP client, leaving Chromium running.
      if (page) await page.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
      if (job.status === "running") job.status = "done";
      this.busy = false;
    }
  }
}
module.exports = { BrowserJobs, SOURCES, extractSearchResults };
