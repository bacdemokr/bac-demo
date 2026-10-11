"use strict";
const { Problem, TelegramBridge, AgentMailBridge } = require("./integrations");
const { BrowserJobs } = require("./browser-jobs");

function respond(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}
async function readJSON(req) {
  if (req.headers["sec-fetch-site"] === "cross-site") throw new Problem("같은 데모 화면에서 요청해주세요.", 403);
  if (req.headers.origin) {
    let origin;
    try { origin = new URL(req.headers.origin); } catch { throw new Problem("잘못된 요청 출처입니다.", 403); }
    if (origin.host !== req.headers.host) throw new Problem("같은 데모 화면에서 요청해주세요.", 403);
  }
  if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")) throw new Problem("JSON 요청이 필요합니다.", 415);
  const chunks = []; let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 40000) throw new Problem("요청이 너무 큽니다.", 413);
    chunks.push(Buffer.from(chunk));
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    return data;
  } catch { throw new Problem("올바른 JSON 내용을 보내주세요."); }
}

function createShowcase({ telegramToken = "", gateway = "", gatewayToken = "", gatewayInfo = () => ({}), fetcher = fetch, browser, browserAsk, capabilities = () => ({}) } = {}) {
  const telegram = new TelegramBridge({ token: telegramToken, chatId: process.env.TG_CHAT_ID, fetcher });
  const mail = new AgentMailBridge({ apiKey: process.env.AGENTMAIL_API_KEY, inboxId: process.env.AGENTMAIL_INBOX_ID, fetcher });
  browser ||= new BrowserJobs({ endpoint: process.env.BROWSER_CDP_URL || "http://127.0.0.1:9222", ask:browserAsk });
  const resolve=value=>typeof value==='function'?value():value;
  async function probe(url, headers = {}) {
    try { const r = await fetcher(url, { headers, redirect: "error", signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; }
  }
  async function handle(req, res) {
    const url = new URL(req.url, "http://localhost"), p = url.pathname;
    if (!p.startsWith("/api/showcase/") && !p.startsWith("/api/integrations/") && !p.startsWith("/api/browser/")) return false;
    try {
      if (p === "/api/showcase/status" && req.method === "GET") {
        const [gatewayReachable, browserConnected] = await Promise.all([
          probe(resolve(gateway) + "/health", resolve(gatewayToken) ? { Authorization: `Bearer ${resolve(gatewayToken)}` } : {}),
          probe(browser.endpoint + "/json/version"),
        ]);
        respond(res, 200, { gateway: { ...gatewayInfo(), reachable: gatewayReachable, configured: !!resolve(gatewayToken), url:resolve(gateway) }, browser: { connected: browserConnected }, telegram: telegram.public(), agentmail: mail.public(), ...capabilities() });
      } else if (p === "/api/integrations/telegram" && req.method === "GET") respond(res, 200, telegram.public());
      else if (p === "/api/integrations/telegram" && req.method === "POST") respond(res, 200, await telegram.configure(await readJSON(req)));
      else if (p === "/api/integrations/telegram/send" && req.method === "POST") respond(res, 200, await telegram.send((await readJSON(req)).text));
      else if (p === "/api/integrations/telegram/messages" && req.method === "GET") respond(res, 200, telegram.receive(Number(url.searchParams.get("since")) || 0));
      else if (p === "/api/integrations/agentmail" && req.method === "GET") respond(res, 200, mail.public());
      else if (p === "/api/integrations/agentmail" && req.method === "POST") respond(res, 200, await mail.configure(await readJSON(req)));
      else if (p === "/api/integrations/agentmail/messages" && req.method === "GET") respond(res, 200, await mail.messages());
      else if (p === "/api/integrations/agentmail/send" && req.method === "POST") respond(res, 200, await mail.send(await readJSON(req)));
      else if (p === "/api/browser/jobs" && req.method === "POST") respond(res, 202, browser.create(await readJSON(req)));
      else if (/^\/api\/browser\/jobs\/[\w-]+(?:\/frame.jpg)?$/.test(p) && req.method === "GET") {
        const id = p.split("/")[4];
        if (p.endsWith("/frame.jpg")) {
          const frame = browser.jobs.get(id)?.frame;
          if (!frame) throw new Problem("브라우저 화면이 아직 없습니다.", 404);
          res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "no-store" }); res.end(frame);
        } else respond(res, 200, browser.public(id));
      } else respond(res, 404, { error: "지원하지 않는 요청입니다." });
    } catch (error) { respond(res, error.status || 500, { error: error instanceof Problem ? error.message : "작업을 완료하지 못했습니다. 다시 시도해주세요." }); }
    return true;
  }
  return { handle, browser, telegram, mail, start() { telegram.start(); mail.start(); } };
}
module.exports = { createShowcase, readJSON };
