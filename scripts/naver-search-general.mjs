// naver-search-general.mjs — general Naver web search via CDP remote control.
// Usage: node scripts/naver-search-general.mjs "query"
// Output: prints a single JSON line: {query,title,results:[...],screenshot}
import { createRequire } from 'module';
import path from 'path';
const require = createRequire(import.meta.url);
// WORKSPACE = OpenClaw workspace holding node_modules/playwright-core.
// Override with the WORKSPACE env var; defaults to the parent of this scripts/ dir.
const WORKSPACE = process.env.WORKSPACE || path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const { chromium } = require(path.join(WORKSPACE, 'node_modules/playwright-core/index.js'));

// Screenshot is written into the demo app's public/ dir so the browser can load it.
// Override with SHOT_DIR env (defaults to ./app/public next to this repo).
const SHOT_DIR = process.env.SHOT_DIR || path.resolve(path.dirname(new URL(import.meta.url).pathname), '../app/public');
const query = process.argv[2] || 'OpenClaw';
const shot = path.join(SHOT_DIR, 'naver_shot.png');

const out = { query, title: '', results: [], screenshot: null, error: null };
try {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0] || await browser.newContext();
  // Use a DEDICATED worker tab for searches so we never hijack the tab the
  // user is viewing (the demo page) and never drop the page count to 0
  // (snap Chromium quits when its last page closes).
  let page = ctx.pages().find(p => p.url().includes('search.naver.com'));
  if (!page) page = await ctx.newPage();
  await page.bringToFront();
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('https://search.naver.com/search.naver?query=' + encodeURIComponent(query),
    { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);
  out.title = await page.title();

  out.results = await page.evaluate(() => {
    const seen = new Set();
    const res = [];
    // Grab title + snippet from common Naver result containers
    const blocks = document.querySelectorAll(
      '.total_wrap, .api_txt_lines, .total_tit, .sds-comps-text, [class*="title_link"], [class*="api_subject_bx"]'
    );
    blocks.forEach(el => {
      const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (t && t.length > 12 && t.length < 300 && !seen.has(t)) {
        seen.add(t);
        res.push(t);
      }
    });
    return res.slice(0, 12);
  });

  await page.screenshot({ path: shot, animations: 'disabled', timeout: 15000 });
  out.screenshot = '/naver_shot.png';
  // Do NOT close the page or the browser — keep the tab alive so Chromium stays up.
} catch (e) {
  out.error = String(e && e.message || e);
}
console.log(JSON.stringify(out));
// Exit cleanly: the CDP websocket keeps the event loop alive otherwise,
// which makes the process hang until it is killed by a timeout.
process.exit(0);
