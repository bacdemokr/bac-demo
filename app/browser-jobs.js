"use strict";
const { randomUUID } = require("crypto");
const { Problem } = require("./integrations");

const SOURCES = {
  naver: { name: "Naver", url: q => `https://search.naver.com/search.naver?query=${encodeURIComponent(q)}` },
  google: { name: "Google", url: q => `https://www.google.com/search?q=${encodeURIComponent(q)}` },
  daum: { name: "Daum", url: q => `https://search.daum.net/search?w=tot&q=${encodeURIComponent(q)}` },
};

class BrowserJobs {
  constructor({ endpoint = "http://127.0.0.1:9222", chromium, sources = SOURCES } = {}) {
    this.endpoint = endpoint; this.chromium = chromium; this.sources = sources; this.jobs = new Map(); this.busy = false;
  }
  create({ query, provider = "naver" }) {
    if (typeof query !== "string" || !query.trim() || query.length > 240) throw new Problem("검색어는 1-240자로 입력해주세요.");
    if (!Object.hasOwn(this.sources, provider)) throw new Problem("지원하는 검색 소스를 선택해주세요.");
    if (this.busy) throw new Problem("브라우저가 탐색 중입니다. 현재 작업이 끝난 뒤 실행해주세요.", 409);
    for (const [id, job] of this.jobs) if (Date.now() - job.at > 600000) this.jobs.delete(id);
    while (this.jobs.size >= 12) this.jobs.delete(this.jobs.keys().next().value);
    const source = this.sources[provider];
    const job = { id: randomUUID(), query: query.trim(), provider, source: source.name, url: source.url(query.trim()), status: "running", events: [], results: [], frame: null, revision: 0, at: Date.now() };
    this.jobs.set(job.id, job); this.busy = true;
    this.run(job).finally(() => { this.busy = false; });
    return this.public(job.id);
  }
  event(job, stage, text) { job.stage = stage; job.events.push({ stage, text, at: Date.now() }); }
  public(id) {
    const job = this.jobs.get(id);
    if (!job) throw new Problem("브라우저 작업이 만료되었습니다. 다시 실행해주세요.", 404);
    const { frame, ...data } = job;
    return { ...data, screenshot: frame ? `/api/browser/jobs/${id}/frame.jpg?v=${job.revision}` : null };
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
      job.results = await page.evaluate(() => {
        const seen = new Set();
        return [...document.querySelectorAll("a[href]")].flatMap(a => {
          const title = (a.innerText || "").replace(/\s+/g, " ").trim();
          let url;
          try {
            url = new URL(a.href);
            // Google redirect links expose the actual source in the q parameter.
            if (url.pathname === "/url" && url.searchParams.get("q")) url = new URL(url.searchParams.get("q"));
          } catch { return []; }
          if (!/^https?:$/.test(url.protocol) || title.length < 15 || title.length > 250 || seen.has(url.href)) return [];
          if (/^(search\.naver\.com|www\.google\.com|accounts\.google\.com|search\.daum\.net)$/.test(url.hostname)) return [];
          seen.add(url.href);
          const snippet = (a.closest("article,li,.total_wrap,.g,.c-container")?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 450);
          return [{ title, url: url.href, snippet }];
        }).slice(0, 12);
      });
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
module.exports = { BrowserJobs, SOURCES };
