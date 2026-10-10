/**
 * BaC Multi-Agent Demo — tiny web server
 *
 * - Serves the Canvas game in ./public
 * - GET  /api/agents   -> character config
 * - GET  /api/sysinfo  -> live nvidia-smi + df -h key metrics
 * - POST /api/chat     -> proxy to OpenClaw Gateway /v1/chat/completions
 *
 * Run:  node server.js
 * Open: http://127.0.0.1:8080
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
// WORKSPACE = the OpenClaw workspace that holds ./scripts and ./node_modules
// (playwright-core). Override with the WORKSPACE env var. Defaults to the
// parent of this app dir (so the repo can live anywhere).
const WORKSPACE = process.env.WORKSPACE || path.resolve(__dirname, "..");

// ----- CONFIG (edit freely) ------------------------------------------------
const GATEWAY = process.env.GATEWAY_URL || "http://127.0.0.1:18789";
const OPUS_MODEL = process.env.DEMO_MODEL ||
  "custom-inference-api-nvidia-com/aws/anthropic/bedrock-claude-opus-4-8";
const TOKEN =
  process.env.GATEWAY_TOKEN ||
  // Persistent first (survives reboots; /tmp is wiped on boot by tmpfiles.d).
  (fs.existsSync(path.join(__dirname, ".gw_token"))
    ? fs.readFileSync(path.join(__dirname, ".gw_token"), "utf8").trim()
    : fs.existsSync("/tmp/gw_token.txt")
    ? fs.readFileSync("/tmp/gw_token.txt", "utf8").trim()
    : "");
const PORT = process.env.PORT || 8080;

// GitHub account used by the GitHubAgent (repo listing) and the multi-agent
// orchestrator (which opens a real PR). Override via env. The PAT you give the
// 'git' agent's GitHub MCP MUST belong to this same account.
const GH_OWNER = process.env.GH_OWNER || "bacdemokr";
const GH_REPO = process.env.GH_REPO || "bac-demo"; // target repo for demo PRs

// Dedicated Telegram bot token (a SEPARATE bot from OpenClaw's own, so our
// independent getUpdates poll never collides with OpenClaw's polling).
// Kept out of source: read from .tg_token file (or TG_BOT_TOKEN env).
const TG_TOKEN =
  process.env.TG_BOT_TOKEN ||
  (fs.existsSync(path.join(__dirname, ".tg_token"))
    ? fs.readFileSync(path.join(__dirname, ".tg_token"), "utf8").trim()
    : "");

// Characters shown in the game. `agent` = OpenClaw agent id to route to.
// `live` = which live-data injector to use (optional).
// Edit / add / remove freely.
const AGENTS = {
  sysmon: {
    name: "HealthAgent",
    color: "#e23b3b",
    role: "System Health",
    agent: "bac",
    model: OPUS_MODEL,
    live: "sysinfo",
    tagline: "Hi! I watch this Spark's GPU, memory & disk health. 📊",
    // English intro (the whole demo audience is non-Korean)
    intro:
      "Hi! I'm HealthAgent. I keep an eye on this machine's health — GPU, memory, and disk. Click me and I'll give you a quick status report.",
    // System prompt steers the agent: English only + uses the live metrics.
    system:
      "You are 'HealthAgent', a friendly system-health agent for an NVIDIA Spark device, shown at a BaC event. " +
      "ALWAYS reply in English, concise and friendly, suitable for a live demo audience. " +
      "You are given a LIVE SYSTEM SNAPSHOT (from nvidia-smi and df -h). " +
      "When asked about status, summarize the most important metrics in a few short bullet points: " +
      "GPU name, GPU utilization, GPU memory used/total, GPU temperature, and root-disk usage. " +
      "Call out anything that looks concerning (high temp, low free disk, high utilization). Keep it brief.\n" +
      "FORMAT: Begin your reply with a single line starting with 'SUMMARY: ' followed by a very short one-line headline (max ~10 words, e.g. 'SUMMARY: All healthy — GB10 idle, 44°C, disk 6%'). Then a blank line, then your bullet points.",
  },

  scout: {
    name: "NaverAgent",
    color: "#2db84d",
    role: "Naver Live Search",
    agent: "bac",
    model: process.env.BROWSER_MODEL || process.env.DEMO_MODEL || "ollama/gemma4:latest",
    live: "search",
    tagline: "Hi! I search Naver live in a real browser — just ask. 🔍",
    intro:
      "Hey! I'm NaverAgent. Ask me anything and I'll search it live on Naver (Korea's top search engine) using a real browser, then summarize what I find — in English.",
    system:
      "You are 'NaverAgent', a live web-search agent shown at a BaC event. " +
      "ALWAYS reply in English, even though the search results may be in Korean. " +
      "You are given LIVE NAVER SEARCH RESULTS (scraped just now from a real browser session). " +
      "Summarize the key findings for the user's query in a few concise bullet points, translating any Korean into English. " +
      "Mention that a screenshot of the live Naver results page is shown below. Be friendly and concise for a demo audience.\n" +
      "FORMAT: Begin your reply with a single line starting with 'SUMMARY: ' followed by a very short one-line headline answering the query (max ~12 words). Then a blank line, then your bullet points.",
  },

  github: {
    name: "GitHubAgent",
    color: "#a371f7",
    role: "GitHub Assistant",
    agent: "git",
    model: OPUS_MODEL,
    live: "github",
    tagline: "Hi! I manage your GitHub — repos, forks, PRs. 🐙",
    intro:
      "Hi! I'm GitHubAgent, connected to the GitHub account 'bacdemokr'. Ask me to list your repositories, fork a repo, open a pull request, and more.",
    system:
      "You are 'GitHubAgent', a GitHub assistant shown at a BaC event. " +
      "You operate on the GitHub account 'bacdemokr' (the authenticated account). ALWAYS reply in English, concise and friendly for a live demo. " +
      "Use the available GitHub tools to actually perform the user's request (fork, create branches, open or list pull requests, read issues, read files, etc.). " +
      "You are given a LIVE list of the account's repositories (fetched just now) in a system message — use it to answer questions about which repos exist. The account owner is 'bacdemokr'. " +
      "When you take an action (fork, PR, branch, etc.), you MUST ALWAYS reply afterward with a clear confirmation: state plainly that it succeeded (or failed), what you did, and include the resulting URL or PR/issue number. NEVER leave the reply empty or stop after just calling a tool — the user needs to see the outcome in chat. If a fork takes a moment, still confirm it was created and give the expected URL (https://github.com/bacdemokr/<repo>). " +
      "Keep answers short but never skip the confirmation.\n" +
      "FORMAT: Begin your reply with a single line starting with 'SUMMARY: ' followed by a very short one-line headline (max ~12 words). Then a blank line, then your details.",
  },

  telegram: {
    name: "TelegramAgent",
    color: "#29a9eb",
    role: "Telegram Bridge",
    live: "telegram",
    // No gateway agent / model: this bot is a direct two-way bridge to a real
    // Telegram chat, handled specially on the client (not via the LLM).
    tagline: "Hi! Chat with me here and it goes straight to Telegram — and back. 💬",
    intro:
      "Hi! I'm TelegramAgent, a live two-way bridge. Anything you type here is sent to a real Telegram chat, and replies from Telegram show up right here in real time.",
  },

  multiagent: {
    name: "OrchestratorAgent",
    color: "#f5a623",
    role: "Agent Orchestrator",
    live: "multiagent",
    // Orchestrator: spawns a PM subagent and a Dev subagent. PM plans, hands
    // the plan to Dev, Dev ships a real commit + PR to bacdemokr/bac-demo.
    tagline: "Ask me to build a feature — I'll have my PM plan it and my Dev ship a real PR. 🤖➡️💻",
    intro:
      "Hi! I'm the OrchestratorAgent. Tell me a feature to build and I'll spawn two teammates: a PM who writes the plan, then a Dev who implements it and opens a real pull request on the configured demo repo. Watch them hand off the work!",
  },

  arxiv: {
    name: "ArxivAgent",
    color: "#14b8a6",
    role: "Agentic AI Paper Radar",
    agent: "bac",
    model: OPUS_MODEL,
    live: "arxiv",
    // Demo purpose: show a CRON JOB. Every minute a cron job refreshes the
    // top-3 Agentic AI papers from arXiv and the character pops a bubble on its
    // own (no click needed). Clicking lists the current Top 3.
    tagline: "📚 I scan arXiv every minute for the hottest Agentic AI papers — click me!",
    intro:
      "Hi! I'm ArxivAgent. A cron job wakes me up every minute to scan arXiv for the most interesting new Agentic AI papers. I'll pop up on my own when there's an update — click me anytime to see my current Top 3 picks.",
    system:
      "You are 'ArxivAgent', an agent that tracks the latest Agentic-AI research on arXiv, shown at a BaC event. " +
      "ALWAYS reply in English, friendly and concise for a live demo audience. " +
      "You are given a LIVE list of the current Top 3 Agentic-AI papers (fetched just now from the arXiv cs.AI feed). " +
      "Format your reply like a polished SLACK message — visual and scannable, NOT a plain numbered list. Use this structure:\n" +
      "• Open with one short friendly line, e.g. '📚 *Here are my top Agentic AI picks right now:*'\n" +
      "• For EACH paper, use this block:\n" +
      "    *1\uFE0F\u20E3 <bold title>*\n" +
      "    👥 _authors (first 2–3, then 'et al.' if more)_\n" +
      "    💡 one-sentence plain-English takeaway\n" +
      "    🔗 the arXiv link\n" +
      "• Put a blank line between papers so they read as separate cards. Use 1\uFE0F\u20E3 2\uFE0F\u20E3 3\uFE0F\u20E3 for the three papers.\n" +
      "• End with one inviting line like '🚀 Curious about any of these? Ask me anything!'\n" +
      "Keep each takeaway to ONE short sentence. Do not invent papers or links — use only the provided list.\n" +
      "FORMAT: Begin your reply with a single line starting with 'SUMMARY: ' followed by a very short one-line headline (max ~12 words, e.g. 'SUMMARY: Top 3 fresh Agentic AI papers'). Then a blank line, then the Slack-style cards.",
  },
};
// ---------------------------------------------------------------------------

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

function send(res, code, body, headers = {}) {
  res.writeHead(code, { "Content-Type": "application/json", ...headers });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function serveStatic(req, res) {
  let urlPath = req.url.split("?")[0];
  if (urlPath === "/") urlPath = "/index.html";
  const filePath = path.join(__dirname, "public", path.normalize(urlPath));
  if (!filePath.startsWith(path.join(__dirname, "public"))) {
    return send(res, 403, { error: "forbidden" });
  }
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, { error: "not found" });
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function handleAgents(res) {
  const list = Object.entries(AGENTS).map(([id, a]) => ({
    id,
    name: a.name,
    color: a.color,
    role: a.role,
    intro: a.intro,
    tagline: a.tagline || a.intro,
    live: a.live || null,
  }));
  send(res, 200, { agents: list });
}

// ---- live system snapshot ----
function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 8000 }, (err, stdout) => {
      resolve(err ? "" : (stdout || "").trim());
    });
  });
}

async function getSysInfo() {
  // GPU via nvidia-smi (CSV, no units, easy to parse)
  const gpuRaw = await run("nvidia-smi", [
    "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw",
    "--format=csv,noheader,nounits",
  ]);
  let gpu = null;
  if (gpuRaw) {
    const [name, util, memUsed, memTotal, temp, power] = gpuRaw
      .split("\n")[0]
      .split(",")
      .map((s) => s.trim());
    gpu = {
      name,
      utilization_pct: util,
      mem_used_mib: memUsed,
      mem_total_mib: memTotal,
      temp_c: temp,
      power_w: power,
    };
  }

  // Disk via df -h for root
  const dfRaw = await run("df", ["-h", "/"]);
  let disk = null;
  if (dfRaw) {
    const line = dfRaw.split("\n")[1] || "";
    const p = line.split(/\s+/);
    disk = { filesystem: p[0], size: p[1], used: p[2], avail: p[3], use_pct: p[4], mount: p[5] };
  }

  return { gpu, disk, captured_at: new Date().toISOString() };
}

// ---- live Naver search (CDP browser) ----
function ensureCdp() {
  return new Promise((resolve) => {
    execFile("bash", [WORKSPACE + "/scripts/ensure-cdp.sh"], { timeout: 25000 }, () => resolve());
  });
}
function getSearch(query) {
  return new Promise(async (resolve) => {
    await ensureCdp();
    execFile(
      "node",
      [WORKSPACE + "/scripts/naver-search-general.mjs", query],
      { timeout: 45000, env: { ...process.env, WORKSPACE, SHOT_DIR: path.join(__dirname, "public") } },
      (err, stdout) => {
        if (err && !stdout) return resolve({ query, results: [], screenshot: null, error: String(err.message) });
        try {
          resolve(JSON.parse((stdout || "").trim().split("\n").pop()));
        } catch {
          resolve({ query, results: [], screenshot: null, error: "parse error" });
        }
      }
    );
  });
}

// ---- live arXiv Agentic-AI paper radar (cron-driven) ----
// Fetches the arXiv cs.AI RSS feed, filters for agentic-AI papers, returns the
// top 3. Result is cached so a once-a-minute cron refresh never hammers arXiv.
let ARXIV_CACHE = { at: 0, papers: [], text: "" };
let ARXIV_POOL = { all: [], nvPool: [], offset: 0, fetchedAt: 0 };
const ARXIV_FILE = "/tmp/arxiv_top3.json";

// Fallback Top-3 pool: arXiv publishes nothing on weekends/holidays, so the
// live cs.AI RSS feed can be empty. To keep the demo from ever showing a blank
// ArxivAgent, we fall back to these real, well-known Agentic-AI papers.
const ARXIV_FALLBACK = [
  {
    title: "ReAct: Synergizing Reasoning and Acting in Language Models",
    authors: "Shunyu Yao, Jeffrey Zhao, Dian Yu, et al.",
    link: "https://arxiv.org/abs/2210.03629",
    summary: "Interleaves chain-of-thought reasoning with tool-using actions, letting an LLM agent plan, act, and observe in a loop — a foundational pattern for modern agents.",
    nvidia: false,
  },
  {
    title: "Toolformer: Language Models Can Teach Themselves to Use Tools",
    authors: "Timo Schick, Jane Dwivedi-Yu, Roberto Dessì, et al.",
    link: "https://arxiv.org/abs/2302.04761",
    summary: "Shows an LLM can learn, in a self-supervised way, when and how to call external APIs (search, calculator, etc.) to improve its answers.",
    nvidia: false,
  },
  {
    title: "Reflexion: Language Agents with Verbal Reinforcement Learning",
    authors: "Noah Shinn, Federico Cassano, Beck Labash, et al.",
    link: "https://arxiv.org/abs/2303.11366",
    summary: "Agents reflect on their own failures in natural language and store those lessons as memory, improving over repeated attempts without weight updates.",
    nvidia: false,
  },
  {
    title: "Voyager: An Open-Ended Embodied Agent with Large Language Models",
    authors: "Guanzhi Wang, Yuqi Xie, Yunfan Jiang, et al.",
    link: "https://arxiv.org/abs/2305.16291",
    summary: "An NVIDIA-led LLM agent that autonomously explores Minecraft, writes and stores reusable skills as code, and continually learns — a landmark lifelong-learning agent.",
    nvidia: true,
  },
  {
    title: "MetaGPT: Meta Programming for a Multi-Agent Collaborative Framework",
    authors: "Sirui Hong, Mingchen Zhuge, Jonathan Chen, et al.",
    link: "https://arxiv.org/abs/2308.00352",
    summary: "Encodes human SOPs into a multi-agent team (PM, architect, engineer) that collaborates to build software — directly mirrors this demo's OrchestratorAgent.",
    nvidia: false,
  },
];
// Warm the in-memory cache from the last cron-written file on startup, so the
// very first click is instant (no network, no LLM).
try {
  const saved = JSON.parse(require("fs").readFileSync(ARXIV_FILE, "utf8"));
  if (saved && Array.isArray(saved.papers) && saved.papers.length) ARXIV_CACHE = saved;
} catch {}

// Build a friendly Slack-announcement style card text from the papers. This is
// precomputed once per refresh so a click just reads it back instantly.
function formatArxivAnnouncement(papers) {
  const nums = ["1\uFE0F\u20E3", "2\uFE0F\u20E3", "3\uFE0F\u20E3"];
  const shortAuthors = (a) => {
    const list = (a || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!list.length) return "";
    return list.length > 2 ? list.slice(0, 2).join(", ") + ", et al." : list.join(", ");
  };
  const lines = [];
  lines.push("\uD83D\uDCE2 *Agentic AI \u2014 Today's Top 3 on arXiv*");
  lines.push("_Fresh from my latest scan \u2014 here's what's worth a read \uD83D\uDC47_");
  papers.forEach((p, i) => {
    lines.push("");
    lines.push("\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015");
    lines.push(`${nums[i] || "\u2022"} *${p.title}*` + (p.nvidia ? "  \uD83D\uDFE9 *NVIDIA*" : ""));
    if (p.authors) lines.push(`\uD83D\uDC65 _${shortAuthors(p.authors)}_`);
    const oneLine = (p.summary || "").replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0];
    if (oneLine) lines.push(`\uD83D\uDCA1 ${oneLine}`);
    if (p.link) lines.push(`\uD83D\uDD17 ${p.link}`);
  });
  lines.push("");
  lines.push("\uD83D\uDE80 Want me to dig into any of these? Just ask \u2014 methods, results, anything!");
  return lines.join("\n");
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const https = require("https");
    const rq = https.get(url, { headers: { "User-Agent": "Mozilla/5.0 ArxivAgent (BaC demo)" } }, (rs) => {
      let d = ""; rs.on("data", (c) => (d += c)); rs.on("end", () => resolve(d));
    });
    rq.on("error", reject);
    rq.setTimeout(20000, () => { rq.destroy(new Error("timeout")); });
  });
}
// Pick a rotating Top 3 from the cached candidate pools. Each call advances
// the offset so the demo shows a *different* Top 3 every cron tick (NVIDIA
// paper guaranteed in slot 1, also rotating through the NVIDIA pool).
function selectRotatedTop3() {
  const { all, nvPool } = ARXIV_POOL;
  const off = ARXIV_POOL.offset;
  const picked = [];
  // Slot 1: a NVIDIA paper, rotating through the NVIDIA pool.
  if (nvPool.length) picked.push(nvPool[off % nvPool.length]);
  // Remaining slots: rotate a window through the agentic pool.
  if (all.length) {
    for (let i = 0; picked.length < 3 && i < all.length; i++) {
      const p = all[(off + i) % all.length];
      if (!picked.some((q) => q.link === p.link)) picked.push(p);
    }
  }
  // Pad from NVIDIA pool if still short.
  for (let i = 0; picked.length < 3 && i < nvPool.length; i++) {
    const p = nvPool[i];
    if (!picked.some((q) => q.link === p.link)) picked.push(p);
  }
  return picked.slice(0, 3);
}

async function getArxivTop3(force) {
  const now = Date.now();
  // Reuse the candidate pool unless it's stale (>10 min) or empty. We only hit
  // the network occasionally; rotation happens locally so every minute differs.
  const poolStale = !ARXIV_POOL.all.length || now - ARXIV_POOL.fetchedAt > 600000;
  if (poolStale && !(ARXIV_POOL.refetching)) {
    ARXIV_POOL.refetching = true;
    try {
      const xml = await fetchUrl("https://rss.arxiv.org/rss/cs.AI");
      const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
      const strip = (s) => s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
      // arXiv RSS descriptions are prefixed with boilerplate like
      // "arXiv:2606.05080v1 Announce Type: new Abstract: <real text>". Strip it.
      const cleanAbstract = (s) =>
        strip(s).replace(/^arXiv:\S+\s*/i, "").replace(/^Announce Type:\s*\S+\s*/i, "").replace(/^Abstract:\s*/i, "").trim();
      const KW = /\b(agent|agentic|multi-?agent|tool[- ]use|tool[- ]calling|orchestrat|autonomous|llm agent|reasoning|planning)\b/i;
      // NVIDIA signal: company name or its well-known model/tooling families.
      const NV = /\b(nvidia|nemo|megatron|cuda|tensorrt|cosmos|gr00t|isaac|nim)\b/i;
      const all = [];
      const nvPool = [];
      for (const it of items) {
        const tm = it.match(/<title>([\s\S]*?)<\/title>/);
        const dm = it.match(/<description>([\s\S]*?)<\/description>/);
        const lm = it.match(/<link>([\s\S]*?)<\/link>/);
        const am = it.match(/<dc:creator>([\s\S]*?)<\/dc:creator>/);
        const title = tm ? strip(tm[1]) : "";
        if (!title) continue;
        const desc = dm ? cleanAbstract(dm[1]) : "";
        const authors = am ? strip(am[1]) : "";
        const blob = title + " " + desc + " " + authors;
        const isNv = NV.test(blob);
        const rec = { title, authors, link: lm ? strip(lm[1]) : "", summary: desc.slice(0, 240), nvidia: isNv };
        if (isNv) nvPool.push(rec);
        if (KW.test(title) || KW.test(desc)) all.push(rec);
      }
      if (all.length || nvPool.length) {
        ARXIV_POOL = { all, nvPool, offset: ARXIV_POOL.offset || 0, fetchedAt: now, refetching: false };
      } else {
        ARXIV_POOL.refetching = false;
      }
    } catch (e) {
      console.log("[arxiv] fetch failed:", e && e.message);
      ARXIV_POOL.refetching = false;
    }
  }
  // Advance rotation and build a fresh Top 3 + announcement text.
  // If the live feed gave us nothing (e.g. weekend/holiday), use the fallback
  // pool so the ArxivAgent is never blank.
  if (!ARXIV_POOL.all.length && !ARXIV_POOL.nvPool.length) {
    const nvPool = ARXIV_FALLBACK.filter((p) => p.nvidia);
    ARXIV_POOL = { all: ARXIV_FALLBACK.slice(), nvPool, offset: ARXIV_POOL.offset || 0, fetchedAt: now, refetching: false };
  }
  if (ARXIV_POOL.all.length || ARXIV_POOL.nvPool.length) {
    if (!force) ARXIV_POOL.offset = (ARXIV_POOL.offset + 1) % 9999;
    const papers = selectRotatedTop3();
    if (papers.length) {
      const text = formatArxivAnnouncement(papers);
      ARXIV_CACHE = { at: now, papers, text };
      try { require("fs").writeFileSync(ARXIV_FILE, JSON.stringify(ARXIV_CACHE)); } catch {}
    }
  }
  return ARXIV_CACHE.papers;
}

// Fetch the bacdemokr account's repositories from the public GitHub API.
let _repoCache = { at: 0, data: null };
function getRepos() {
  return new Promise((resolve) => {
    // small cache so rapid clicks don't hammer the API
    if (_repoCache.data && Date.now() - _repoCache.at < 30000) {
      return resolve(_repoCache.data);
    }
    fetch(`https://api.github.com/users/${GH_OWNER}/repos?per_page=100&sort=updated`, {
      headers: { "User-Agent": "bac-demo", Accept: "application/vnd.github+json" },
    })
      .then((r) => r.json())
      .then((arr) => {
        const list = Array.isArray(arr)
          ? arr.map((r) => ({
              name: r.name,
              description: r.description,
              language: r.language,
              stars: r.stargazers_count,
              url: r.html_url,
              fork: r.fork,
              updated: r.updated_at,
            }))
          : [];
        _repoCache = { at: Date.now(), data: list };
        resolve(list);
      })
      .catch(() => resolve(_repoCache.data || []));
  });
}

async function handleSysInfo(res) {
  const info = await getSysInfo();
  send(res, 200, info);
}

// POST /api/chat { agent, messages:[{role,content}] } -> { reply }
function handleChat(req, res) {
  // Accept a disguised static-asset GET: /bac-data/<base64url-json>.json
  // (the OpenClaw Control extension blocks API/chat-looking URLs, so this is
  // dressed up to look like a plain file fetch).
  const mAsset = req.url.match(/^\/bac-data\/([^/?]+?)\.json/);
  if (mAsset) {
    let parsed;
    try {
      let b64 = mAsset[1].replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      const json = Buffer.from(b64, "base64").toString("utf8");
      parsed = JSON.parse(json);
      console.log(`[bac-data] decoded OK, content=${JSON.stringify(parsed?.messages?.[0]?.content || "").slice(0,60)}`);
    } catch (e) {
      console.log(`[bac-data] decode FAILED: ${e.message} (b64len=${mAsset[1].length})`);
      return send(res, 400, { error: "bad json" });
    }
    return startJob(parsed, res);
  }
  // Accept BOTH POST (json body) and GET (?payload=<urlencoded json>).
  if (req.method === "GET") {
    let parsed;
    try {
      const q = new URL(req.url, "http://x").searchParams.get("payload") || "{}";
      parsed = JSON.parse(q);
    } catch {
      return send(res, 400, { error: "bad json" });
    }
    return startJob(parsed, res);
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    let parsed;
    try {
      parsed = JSON.parse(body || "{}");
    } catch {
      return send(res, 400, { error: "bad json" });
    }
    return startJob(parsed, res);
  });
}

async function handleChatParsed(parsed, done) {
  try {
    const charId = parsed.agent && AGENTS[parsed.agent] ? parsed.agent : Object.keys(AGENTS)[0];
    const cfg = AGENTS[charId];
    const agentId = cfg.agent || "main";
    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    if (!messages.length) return done(400, { error: "no messages" });

    // Build the message stack: system prompt (+ live data) then conversation.
    const sys = [];
    let extra = {}; // extra fields returned to client (e.g. screenshot)
    // Hard guard: keep small local models from falling back to the OpenClaw
    // assistant persona (session-status cards, "use a skill", "file not found").
    sys.push({
      role: "system",
      content:
        "CRITICAL: You are a single-purpose demo bot. Stay 100% in the role defined below. " +
        "NEVER mention OpenClaw, sessions, models, tokens, context windows, skills, cron, sub-agents, " +
        "working directories, or any local files. NEVER output a session-status card. " +
        "NEVER say you lack access or a tool. Treat the LIVE data given in these system messages as " +
        "ground truth and answer the user directly using ONLY that data and the role below.",
    });
    if (cfg.system) sys.push({ role: "system", content: cfg.system });
    if (cfg.live === "sysinfo") {
      const info = await getSysInfo();
      sys.push({
        role: "system",
        content:
          "LIVE SYSTEM SNAPSHOT (JSON):\n" + JSON.stringify(info, null, 2),
      });
      // Small local models treat a bare "status" as an OpenClaw session-status
      // request and bail out. Rewrite trivial prompts into an explicit health
      // question so the model actually summarizes the snapshot above.
      const lu = [...messages].reverse().find((m) => m.role === "user");
      if (lu && /^\s*(status|health|report|check|how('?s| is)?( it| things)?|\?|hi|hello)\s*\??\s*$/i.test(lu.content || "")) {
        lu.content =
          "Give me a quick health report of this machine, summarizing the GPU and disk metrics from the live snapshot above.";
      }
    }
    if (cfg.live === "search") {
      // last user message is the query
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      const query = (lastUser && lastUser.content) || "";
      const sr = await getSearch(query);
      if (sr.screenshot) extra.screenshot = sr.screenshot + "?t=" + Date.now();
      sys.push({
        role: "system",
        content:
          "LIVE NAVER SEARCH RESULTS for query \"" + query + "\" (JSON):\n" +
          JSON.stringify(sr.results || [], null, 2),
      });
    }
    if (cfg.live === "github") {
      const repos = await getRepos();
      sys.push({
        role: "system",
        content:
          "LIVE list of repositories on the 'bacdemokr' GitHub account (fetched just now):\n" +
          JSON.stringify(repos, null, 2),
      });
    }
    if (cfg.live === "arxiv") {
      const papers = await getArxivTop3();
      sys.push({
        role: "system",
        content:
          "LIVE Top 3 Agentic-AI papers (fetched just now from the arXiv cs.AI feed):\n" +
          JSON.stringify(papers, null, 2),
      });
    }

    const payload = JSON.stringify({
      model: `openclaw/${agentId}`,
      messages: [...sys, ...messages],
      // NOTE: intentionally NO `user` field. The endpoint is then stateless
      // per request, so the Gateway never accumulates or merges sessions
      // across characters. The client holds each character's history
      // separately and sends it in `messages`, so memory stays isolated.
    });

    const u = new URL(GATEWAY + "/v1/chat/completions");
    const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
        "Content-Length": Buffer.byteLength(payload),
        // Force a fresh, unique session per request as a hard isolation guard.
        "x-openclaw-session-key": `agent:${agentId}:bac-demo-${charId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      };
    if (cfg.model) headers["x-openclaw-model"] = cfg.model;
    const opts = {
      method: "POST",
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      headers,
    };
    console.log(`[gateway] -> POST ${u.href} agent=${agentId} model=${cfg.model || "(default)"}`);
    const greq = http.request(opts, (gres) => {
      console.log(`[gateway] <- status ${gres.statusCode}`);
      let out = "";
      gres.on("data", (c) => (out += c));
      gres.on("end", () => {
        console.log(`[gateway] <- end, ${out.length} bytes`);
        try {
          const j = JSON.parse(out);
          let reply =
            j.choices?.[0]?.message?.content ?? j.error?.message ?? "(no response)";
          // Extract a concise one-line SUMMARY for the floating speech bubble.
          let bubble = null;
          const m = reply.match(/^\s*SUMMARY:\s*(.+)$/im);
          if (m) {
            bubble = m[1].trim();
            // remove the SUMMARY line from the chat reply
            reply = reply.replace(/^\s*SUMMARY:.*$/im, "").replace(/^\s+/, "").trim();
          }
          // Never show a blank chat reply (e.g. when the agent only emitted a
          // SUMMARY line with no body). Fall back to the SUMMARY headline, and
          // if a screenshot is attached, add a friendly pointer to it.
          if (!reply || !reply.trim()) {
            reply = bubble || "Done. ✅";
            if (extra.screenshot) {
              reply = (bubble ? bubble + " " : "") + "The live view is shown below. 👇";
            }
          }
          done(200, { reply, bubble, ...extra });
        } catch {
          done(502, { error: "gateway parse error", raw: out.slice(0, 500) });
        }
      });
    });
    greq.on("error", (e) => { console.log(`[gateway] ERROR ${e.message}`); done(502, { error: "gateway unreachable: " + e.message }); });
    greq.setTimeout(120000, () => { console.log("[gateway] TIMEOUT after 120s"); greq.destroy(new Error("gateway timeout")); });
    greq.write(payload);
    greq.end();
  } catch (e) {
    console.log(`[handleChatParsed] THREW: ${e.message}`);
    try { done(500, { error: "server error: " + e.message }); } catch {}
  }
}

// ----- Async job system ----------------------------------------------------
// The browser environment aborts slow fetches (~a few seconds), so we never
// hold a long connection. Instead: start a job, return its id immediately,
// and let the client poll for the result with short requests.
const JOBS = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [id, j] of JOBS) if (now - j.t > 5 * 60 * 1000) JOBS.delete(id);
}, 60 * 1000).unref();

function startJob(parsed, res) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  JOBS.set(id, { t: Date.now(), done: false, result: null });
  console.log(`[job ${id}] start`);
  handleChatParsed(parsed, (code, body) => {
    const j = JOBS.get(id);
    if (j) { j.done = true; j.code = code; j.result = body; j.t = Date.now(); }
    console.log(`[job ${id}] done code=${code}`);
  });
  // Respond immediately with the job id (sub-second connection).
  send(res, 200, { jobId: id });
}

function pollJob(id, res) {
  const j = JOBS.get(id);
  if (!j) return send(res, 200, { status: "unknown" });
  if (!j.done) return send(res, 200, { status: "pending" });
  const out = { status: "done", ...(j.result || {}) };
  JOBS.delete(id);
  send(res, 200, out);
}

// ----- OrchestratorAgent orchestration -----------------------------------------
// Orchestrator spawns a PM subagent (plans) then a Dev subagent (ships a real
// PR to bacdemokr/bac-demo). The UI polls /bac-ma-poll for live stage updates
// so it can animate the birth -> handoff -> merge sequence with speech bubbles.
const MA_JOBS = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [id, j] of MA_JOBS) if (now - j.t > 10 * 60 * 1000) MA_JOBS.delete(id);
}, 60 * 1000).unref();

let REPO_INDEX = null;
function repoIndex() {
  if (REPO_INDEX) return REPO_INDEX;
  try {
    REPO_INDEX = JSON.parse(fs.readFileSync(path.join(__dirname, "repo-index.json"), "utf8"));
  } catch { REPO_INDEX = {}; }
  return REPO_INDEX;
}

function slugify(s) {
  return String(s || "feature").toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 32) || "feature";
}

// Extract pure source code from a possibly-chatty LLM response.
// 1) If there's a fenced ```code``` block, use the largest one.
// 2) Otherwise drop leading prose lines until the first code-looking line
//    and trailing prose after the last code-looking line.
function cleanCode(raw, ext) {
  if (!raw) return "";
  let s = String(raw).replace(/\r/g, "");
  const fences = [...s.matchAll(/```[a-z0-9]*\n([\s\S]*?)```/gi)].map((m) => m[1]);
  if (fences.length) {
    return fences.sort((a, b) => b.length - a.length)[0].trim();
  }
  const lines = s.split("\n");
  const codeLike = (l) => /^\s*(\/\/|\/\*|\*|#|import |export |const |let |var |function |class |module\.exports|require\(|async |\(|\{|\}|return |if \(|for \(|@|<)/.test(l) || /[;{}]\s*$/.test(l);
  let start = 0;
  while (start < lines.length && !codeLike(lines[start]) && lines[start].trim() !== "") start++;
  let end = lines.length - 1;
  while (end > start && !codeLike(lines[end]) && lines[end].trim() !== "") end--;
  const out = lines.slice(start, end + 1).join("\n").trim();
  return out || s.trim();
}

// Call a specific Gateway agent once and return the assistant text.
function callAgent(agentId, sys, userText, model, timeoutMs) {
  return new Promise((resolve) => {
    const messages = [];
    if (sys) messages.push({ role: "system", content: sys });
    messages.push({ role: "user", content: userText });
    const payload = JSON.stringify({ model: `openclaw/${agentId}`, messages });
    const u = new URL(GATEWAY + "/v1/chat/completions");
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
      "Content-Length": Buffer.byteLength(payload),
      "x-openclaw-session-key": `agent:${agentId}:bac-ma-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    };
    if (model) headers["x-openclaw-model"] = model;
    const opts = { method: "POST", hostname: u.hostname, port: u.port, path: u.pathname, headers };
    const greq = http.request(opts, (gres) => {
      let out = "";
      gres.on("data", (c) => (out += c));
      gres.on("end", () => {
        try {
          const jj = JSON.parse(out);
          resolve(jj.choices?.[0]?.message?.content ?? jj.error?.message ?? "");
        } catch { resolve(""); }
      });
    });
    greq.on("error", () => resolve(""));
    greq.setTimeout(timeoutMs || 40000, () => greq.destroy(new Error("timeout")));
    greq.write(payload); greq.end();
  });
}

function maStartJob(parsed, res) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const lastUser = [...(parsed.messages || [])].reverse().find((m) => m.role === "user");
  const request = (lastUser && lastUser.content) || "Add a small useful feature";
  const job = { id, t: Date.now(), stages: [], done: false, request };
  MA_JOBS.set(id, job);
  console.log(`[ma ${id}] start: ${request.slice(0, 60)}`);
  runMultiagent(job).catch((e) => {
    job.stages.push({ stage: "error", actor: "orchestrator", text: "Failed: " + e.message });
    job.done = true;
  });
  send(res, 200, { jobId: id });
}

function maPoll(id, res) {
  const j = MA_JOBS.get(id);
  if (!j) return send(res, 200, { status: "unknown" });
  send(res, 200, { status: j.done ? "done" : "running", stages: j.stages });
}

function push(job, stage, actor, text, extra) {
  job.stages.push({ stage, actor, text, ...(extra || {}) });
  job.t = Date.now();
  console.log(`[ma ${job.id}] ${stage}/${actor}: ${String(text).slice(0, 70)}`);
}

async function runMultiagent(job) {
  const idx = repoIndex();
  const ds = (idx.demoStrategy) || {};
  const targetDir = ds.targetDir || "demo-features/";
  const slug = slugify(job.request);
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  const branch = `bacdemo/${slug}-${stamp}`;

  // Stage 0: orchestrator spawns the team
  push(job, "spawn", "orchestrator", `Spinning up the team for: "${job.request}". Meet my PM and my Dev! 👶👶`);

  // Stage 1: PM plans
  push(job, "pm-start", "pm", `On it — planning "${job.request}"… 🧠`);
  const pmSys =
    "You are the PM (product manager) on a fast live demo at BaC. " +
    "Reply in English, VERY concise. You are given a JSON index of the configured demo repo (a Node.js " +
    "application). For a safe live demo, the feature is implemented as ONE small, self-contained, " +
    "RUNNABLE code module under '" + targetDir + "' (do NOT touch real src/). " +
    "Write a crisp plan (3-5 short bullet points) describing the actual functions/behavior the Dev must " +
    "implement — real code, not just docs. End with one line: 'FILE: <filename>.js' naming the single " +
    "JavaScript file the Dev should create under " + targetDir + ".\n\n" +
    "REPO INDEX:\n" + JSON.stringify(idx).slice(0, 2000);
  let plan = await callAgent("pm", pmSys, `Feature request: ${job.request}`, OPUS_MODEL);
  if (!plan || !plan.trim()) {
    plan = `- Implement "${job.request}" as a tiny standalone, runnable JS module.\n- Keep it dependency-free.\n- Export the main function(s) and document usage at the top.\nFILE: ${slug}.js`;
    push(job, "pm-fallback", "pm", "(PM was slow — orchestrator drafted the plan.)");
  }
  let fileName = `${slug}.js`;
  const fm = plan.match(/FILE:\s*([^\s`]+)/i);
  if (fm) fileName = fm[1].replace(/^.*\//, "").trim();
  // Make sure it's a code file, not a doc.
  if (/\.(md|txt)$/i.test(fileName)) fileName = fileName.replace(/\.(md|txt)$/i, ".js");
  if (!/\.[a-z]+$/i.test(fileName)) fileName += ".js";
  const planClean = plan.replace(/FILE:\s*[^\s`]+/i, "").trim();
  push(job, "pm-done", "pm", planClean, { plan: planClean, fileName });

  // Stage 2: handoff (PM physically hands the box to Dev)
  push(job, "handoff", "pm", `Here you go, Dev — build ${fileName}. 📦➡️`, { fileName });

  // Stage 3: Dev actually WRITES THE CODE -> real commit + PR
  push(job, "dev-start", "dev", `Got the plan! Coding ${targetDir}${fileName} now… 🔨`);
  const filePath = targetDir + fileName;
  const ext = (fileName.match(/\.([a-z]+)$/i) || [, "js"])[1].toLowerCase();
  const devSys =
    "You are a CODE GENERATOR, not a chatbot. Output ONLY the raw contents of a single " + ext.toUpperCase() + " file. " +
    "ABSOLUTELY NO prose, NO explanations, NO markdown, NO code fences, NO greetings, NO summaries — " +
    "your entire response must be valid " + ext.toUpperCase() + " source that could be saved directly to disk and run. " +
    "Implement the PM's plan as real, working, dependency-free Node-compatible code. " +
    "Start with a short // comment describing usage, then the implementation, then a tiny self-test at the bottom. " +
    "The FIRST character of your output must be the first character of the code (e.g. '/' or 'c' or 'f'), never a word like 'I' or 'Here'.";
  let code = await callAgent("dev", devSys, `Feature: ${job.request}\n\nPM plan:\n${planClean}\n\nReturn ONLY the raw contents of ${fileName}.`, OPUS_MODEL, 75000);
  console.log(`[ma ${job.id}] dev raw len=${(code||"").length}`);
  code = cleanCode(code, ext);
  console.log(`[ma ${job.id}] dev clean len=${(code||"").length}`);
  if (!code || !code.trim()) {
  code = `// ${job.request}\n// (Dev fallback stub — generated by BaC OrchestratorAgent demo)\nmodule.exports = function () {\n  throw new Error("not yet implemented");\n};\n`;
  }
  const header = `// ${job.request}\n// Built live by the BaC OrchestratorAgent demo (PM → Dev). ${now.toISOString()}\n\n`;
  const content = header + code + "\n";
  let prUrl = null, prNum = null, devErr = null;
  try {
    // create branch from main
    await ghReq("POST", `/repos/${GH_OWNER}/${GH_REPO}/git/refs`, await (async () => {
      const main = await ghReq("GET", `/repos/${GH_OWNER}/${GH_REPO}/git/ref/heads/main`);
      return { ref: `refs/heads/${branch}`, sha: main.object.sha };
    })());
    // create the file on the branch
    await ghReq("PUT", `/repos/${GH_OWNER}/${GH_REPO}/contents/${encodeURIComponent(filePath).replace(/%2F/g, "/")}`, {
      message: `feat: ${job.request}`,
      content: Buffer.from(content).toString("base64"),
      branch,
    });
    // open PR
    const pr = await ghReq("POST", `/repos/${GH_OWNER}/${GH_REPO}/pulls`, {
      title: `feat: ${job.request}`,
      head: branch,
      base: ds.prBase || "main",
      body: `Live demo PR (OrchestratorAgent).\n\n**PM plan:**\n\n${planClean}\n\n**Dev:** implemented working code in \`${filePath}\`.`,
    });
    prUrl = pr.html_url; prNum = pr.number;
  } catch (e) { devErr = e.message; }

  if (prUrl) {
    push(job, "dev-done", "dev", `Done! Opened PR #${prNum} with ${filePath}. ✅`, { prUrl, prNum, filePath });
  } else {
    push(job, "dev-done", "dev", `Couldn't open the PR (${devErr || "unknown"}).`, {});
  }

  // Stage 4: merge back to orchestrator
  const summary = prUrl
    ? `Team shipped it! PM planned “${job.request}” and Dev opened PR #${prNum}. 🎉`
    : `PM planned it, but the Dev hit a snag opening the PR.`;
  push(job, "merge", "orchestrator", summary, { prUrl, prNum });
  job.done = true;
}

// Minimal GitHub REST helper (uses the same token as the git agent).
// Persistent file first (survives reboots), then env, then legacy /tmp.
let GH_TOKEN = null;
function ghToken() {
  if (GH_TOKEN !== null) return GH_TOKEN;
  const persistent = path.join(__dirname, ".gh_token");
  try { GH_TOKEN = fs.readFileSync(persistent, "utf8").trim(); }
  catch {
    GH_TOKEN = process.env.GITHUB_TOKEN || "";
    if (!GH_TOKEN) {
      try { GH_TOKEN = fs.readFileSync("/tmp/gh_token.txt", "utf8").trim(); } catch {}
    }
  }
  return GH_TOKEN;
}
function ghReq(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      method, hostname: "api.github.com", path: p,
      headers: {
        "User-Agent": "bac-demo",
        Authorization: `Bearer ${ghToken()}`,
        Accept: "application/vnd.github+json",
        ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
      },
    };
    const rq = require("https").request(opts, (rs) => {
      let out = "";
      rs.on("data", (c) => (out += c));
      rs.on("end", () => {
        let j = {};
        try { j = out ? JSON.parse(out) : {}; } catch {}
        if (rs.statusCode >= 200 && rs.statusCode < 300) resolve(j);
        else reject(new Error(`gh ${rs.statusCode}: ${(j && j.message) || out.slice(0, 100)}`));
      });
    });
    rq.on("error", reject);
    rq.setTimeout(25000, () => rq.destroy(new Error("gh timeout")));
    if (data) rq.write(data);
    rq.end();
  });
}

// ----- Telegram two-way bridge ---------------------------------------------
// A dedicated bot independently long-polls getUpdates and buffers inbound
// messages. The UI sends via /bac-tg-send and receives via /bac-tg-recv.
const TG_API = TG_TOKEN ? `https://api.telegram.org/bot${TG_TOKEN}` : null;
const TG_INBOX = [];          // { id, from, text, t } received from Telegram
let TG_MSG_SEQ = 0;           // monotonically increasing id we hand to the UI
let TG_LAST_CHAT = null;      // last chat id that messaged us (reply target)

function tgApi(method, params) {
  return new Promise((resolve) => {
    if (!TG_API) return resolve({ ok: false, error: "no token" });
    const u = new URL(`${TG_API}/${method}`);
    const body = JSON.stringify(params || {});
    const opts = {
      method: "POST",
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    };
    const rq = require("https").request(opts, (rs) => {
      let out = "";
      rs.on("data", (c) => (out += c));
      rs.on("end", () => { try { resolve(JSON.parse(out)); } catch { resolve({ ok: false }); } });
    });
    rq.on("error", (e) => resolve({ ok: false, error: e.message }));
    rq.setTimeout(70000, () => rq.destroy(new Error("tg timeout")));
    rq.write(body); rq.end();
  });
}

let tgOffset = 0;
async function tgPollLoop() {
  if (!TG_API) { console.log("[tg] no token — bridge disabled"); return; }
  // Drop any backlog so we only surface messages from now on.
  try {
    const init = await tgApi("getUpdates", { timeout: 0, offset: -1 });
    if (init.ok && init.result && init.result.length) {
      tgOffset = init.result[init.result.length - 1].update_id + 1;
    }
  } catch {}
  console.log(`[tg] bridge live (offset=${tgOffset})`);
  for (;;) {
    try {
      const up = await tgApi("getUpdates", { timeout: 50, offset: tgOffset });
      if (up && up.ok && Array.isArray(up.result)) {
        for (const u of up.result) {
          tgOffset = u.update_id + 1;
          const m = u.message || u.edited_message;
          if (!m || !m.text) continue;
          TG_LAST_CHAT = m.chat && m.chat.id;
          const from = (m.from && (m.from.first_name || m.from.username)) || "Telegram";
          TG_INBOX.push({ id: ++TG_MSG_SEQ, from, text: m.text, t: Date.now() });
          if (TG_INBOX.length > 200) TG_INBOX.shift();
          console.log(`[tg] <- ${from}: ${m.text.slice(0, 60)}`);
        }
      } else if (up && up.error) {
        await new Promise((r) => setTimeout(r, 3000));
      }
    } catch (e) {
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function tgSend(text, res) {
  const target = TG_LAST_CHAT || process.env.TG_CHAT_ID || null;
  if (!target) {
    return send(res, 200, {
      ok: false,
      note: "No Telegram chat yet — send /start (or any message) to the bot first so it knows who to reply to.",
    });
  }
  const r = await tgApi("sendMessage", { chat_id: target, text });
  console.log(`[tg] -> ${target}: ${String(text).slice(0, 60)} ok=${r && r.ok}${r && !r.ok ? " err=" + (r.description || r.error || "?") : ""}`);
  send(res, 200, { ok: !!(r && r.ok), error: (r && (r.description || r.error)) || null });
}

function tgRecv(sinceId, res) {
  const since = parseInt(sinceId, 10) || 0;
  const msgs = TG_INBOX.filter((m) => m.id > since)
    .map((m) => ({ id: m.id, from: m.from, text: m.text }));
  send(res, 200, { messages: msgs, lastId: TG_MSG_SEQ });
}

const server = http.createServer((req, res) => {
  console.log(`[req] ${req.method} len=${req.url.length} ${req.url.slice(0, 60)}`);
  // Poll for an async job result: /bac-poll/<jobId>.json
  const mPoll = req.url.match(/^\/bac-poll\/([^/?.]+)\.json/);
  if (mPoll) return pollJob(mPoll[1], res);
  // OrchestratorAgent: start orchestration (UI -> server), disguised as static asset.
  const mMaStart = req.url.match(/^\/bac-ma-start\/([^/?]+?)\.json/);
  if (mMaStart) {
    let parsed = null;
    try {
      let b64 = mMaStart[1].replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      parsed = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    } catch { return send(res, 400, { error: "bad json" }); }
    return maStartJob(parsed, res);
  }
  const mMaPoll = req.url.match(/^\/bac-ma-poll\/([^/?.]+)\.json/);
  if (mMaPoll) return maPoll(mMaPoll[1], res);
  // ArxivAgent: current Top-3 Agentic-AI papers (polled once a minute by the UI).
  if (req.url.startsWith("/bac-arxiv/top3")) {
    return getArxivTop3().then((papers) =>
      send(res, 200, { papers, text: ARXIV_CACHE.text || "", at: ARXIV_CACHE.at })
    );
  }
  // Telegram bridge: send (UI -> Telegram), disguised as a static asset.
  const mTgSend = req.url.match(/^\/bac-tg-send\/([^/?]+?)\.json/);
  if (mTgSend) {
    let text = "";
    try {
      let b64 = mTgSend[1].replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      const parsed = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
      text = String(parsed.text || "");
    } catch { return send(res, 400, { error: "bad json" }); }
    return tgSend(text, res);
  }
  // Telegram bridge: receive (Telegram -> UI). /bac-tg-recv/<sinceId>.json
  const mTgRecv = req.url.match(/^\/bac-tg-recv\/([0-9]+)\.json/);
  if (mTgRecv) return tgRecv(mTgRecv[1], res);
  if (req.url.startsWith("/api/agents")) return handleAgents(res);
  if (req.url.startsWith("/api/sysinfo")) return handleSysInfo(res);
  if (req.url.startsWith("/bac-data/")) return handleChat(req, res);
  if (req.url.startsWith("/bac/chat")) return handleChat(req, res);
  if (req.url.startsWith("/api/chat") && req.method === "POST") return handleChat(req, res);
  return serveStatic(req, res);
});

server.listen(PORT, process.env.HOST || "127.0.0.1", () => {
  console.log(`BaC demo on http://127.0.0.1:${PORT}`);
  console.log(`Proxying to ${GATEWAY} (token ${TOKEN ? "loaded" : "MISSING"})`);
  console.log(`Telegram bridge token ${TG_TOKEN ? "loaded" : "MISSING"}`);
  tgPollLoop();
});

// Long agent turns (fork/PR can take ~10s+). Make sure the server never
// preemptively closes a slow connection out from under the browser.
server.requestTimeout = 0;        // no overall request timeout
server.headersTimeout = 0;        // no headers timeout
server.keepAliveTimeout = 120000; // keep idle connections alive 2 min
server.timeout = 0;               // no socket inactivity timeout
