/* BaC Multi-Agent Demo - game engine */
(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, DPR = 1;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  // ---------- Agents ----------
  let AGENTS = [];      // from /api/agents
  let chars = [];       // sprite state
  // Transient subagent sprites (PM / Dev) shown during MultiagentBot runs.
  let maKids = [];      // { role, label, color, x, y, tx, ty, bob, active }
  let maBox = null;     // { x, y, tx, ty, t } the handoff box in flight
  let maParent = null;  // the orchestrator char currently running

  // conversation history per agent id (sent to backend for memory)
  const history = {};

  function rand(a, b) { return a + Math.random() * (b - a); }

  let motionPaused = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const emit = (type, detail) => window.dispatchEvent(new CustomEvent("bac:" + type, { detail }));
  function arena() {
    const mobile = W <= 900;
    const left = mobile ? 24 : (W >= 1500 ? 380 : 330);
    const right = W - (mobile ? 24 : 40);
    const top = mobile ? 365 : 210;
    const bottom = H - (mobile ? 310 : 240);
    return { x: (left + right) / 2, y: (top + bottom) / 2, rx: (right - left) * .34, ry: Math.max(95, (bottom - top) * .36), left, right, top, bottom };
  }
  function home(i) {
    const a = arena(), angle = (i / Math.max(AGENTS.length, 1)) * Math.PI * 2 - Math.PI / 2;
    return { x: a.x + Math.cos(angle) * a.rx, y: a.y + Math.sin(angle) * a.ry };
  }
  function buildChars() {
    chars = AGENTS.map((a, i) => ({ ...a, ...home(i), ...{ tx: home(i).x, ty: home(i).y },
      home: i, dir: 1, bob: i * 1.7, speed: 12, wait: rand(1, 4), bubble: null, hover: false, busy: false }));
  }
  function pickTarget(c) {
    const h = home(c.home);
    c.tx = h.x + rand(-13, 13); c.ty = h.y + rand(-7, 7); c.wait = rand(2, 5);
  }
  let bgCanvas = null;
  function buildBackground() {
    bgCanvas = document.createElement("canvas"); bgCanvas.width = W; bgCanvas.height = H;
    const b = bgCanvas.getContext("2d"), a = arena();
    b.fillStyle = "#0b1018"; b.fillRect(0, 0, W, H);
    const glow = b.createRadialGradient(a.x, a.y, 10, a.x, a.y, Math.max(300, a.rx * 1.8));
    glow.addColorStop(0, "#15352c"); glow.addColorStop(.6, "#0e201f"); glow.addColorStop(1, "#0b1018");
    b.fillStyle = glow; b.fillRect(0, 0, W, H);
    // Perspective floor grid, clipped to the playground.
    b.save(); b.beginPath(); b.rect(a.left, a.top - 35, a.right-a.left, a.bottom-a.top+100); b.clip();
    b.strokeStyle = "#4c76691c"; b.lineWidth = 1;
    const horizon = a.top - 100;
    for (let x = a.left - 700; x <= a.right + 700; x += 72) {
      b.beginPath(); b.moveTo(a.x + (x-a.x)*.2, horizon); b.lineTo(x, H-160); b.stroke();
    }
    for (let y = a.top; y < H-170; y += 38) { b.beginPath(); b.moveTo(a.left, y); b.lineTo(a.right, y); b.stroke(); }
    for (const scale of [1, 1.27, 1.55]) {
      b.beginPath(); b.ellipse(a.x, a.y + 17, a.rx*scale, a.ry*scale, 0, 0, Math.PI*2);
      b.strokeStyle = scale === 1 ? "#63947832" : "#507a6120"; b.stroke();
    }
    b.restore();
    // Core pedestal.
    const hub = b.createRadialGradient(a.x, a.y, 1, a.x, a.y, 92);
    hub.addColorStop(0, "#a6ef8040"); hub.addColorStop(1, "#83e67c00"); b.fillStyle=hub;
    b.beginPath(); b.ellipse(a.x,a.y,100,60,0,0,Math.PI*2); b.fill();
    b.beginPath(); b.ellipse(a.x,a.y+8,55,27,0,0,Math.PI*2); b.fillStyle="#162b24"; b.fill();
    b.strokeStyle="#648e5345"; b.stroke();
    b.font='24px -apple-system,sans-serif'; b.fillStyle="#b8f279"; b.textAlign="center"; b.fillText("✳",a.x,a.y+4);
  }
  function drawNetwork(t) {
    const a = arena();
    ctx.save();
    for (const c of chars) {
      const pulse = c.busy || c === activeChar;
      ctx.beginPath(); ctx.moveTo(a.x,a.y+8); ctx.lineTo(c.x,c.y+20);
      ctx.strokeStyle = pulse ? c.color + "60" : "#789c7720";
      ctx.lineWidth = pulse ? 1.2 : .7; ctx.setLineDash(pulse ? [] : [3,7]); ctx.stroke();
      ctx.setLineDash([]);
      if (pulse) {
        for (let k=0;k<2;k++) {
          const f=(t*.3+k*.5)%1, x=a.x+(c.x-a.x)*f, y=a.y+8+(c.y+12-a.y)*f;
          ctx.fillStyle=c.color; ctx.shadowColor=c.color; ctx.shadowBlur=10;
          ctx.beginPath();ctx.arc(x,y,2,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
        }
      }
    }
    ctx.restore();
  }

  // ---------- Draw a Claw mascot character (color-tinted) ----------
  function drawChar(c, t) {
    const bob = Math.sin(t * 2 + c.bob) * (c.busy ? 4 : 2.5);
    const x = c.x, y = c.y + bob;

    ctx.save();
    // shadow
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.beginPath();
    const shY = c.baby ? c.y + 15 : c.y + 36;
    const shRx = c.baby ? 11 : 24, shRy = c.baby ? 3 : 7;
    ctx.ellipse(c.x, shY, shRx, shRy, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.shadowColor = c.color; ctx.shadowBlur = c.busy || c.active ? 24 : 10;
    ctx.strokeStyle = c.color + (c.busy ? "aa" : "40"); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(c.x, c.y + (c.baby ? 17 : 34), c.baby ? 18 : 40, c.baby ? 6 : 12, 0, 0, Math.PI*2); ctx.stroke();
    ctx.restore();
    // selected and hovered agents get a soft halo
    if (c.hover || c === activeChar) {
      ctx.strokeStyle = c.color + "aa";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(c.x, y - 7, 41, 48, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.translate(x, y);
    ctx.scale(c.dir, 1);
    ctx.rotate(Math.sin(t * (c.busy || c.active ? 6 : 2) + c.bob) * .025);
    if (c.baby) ctx.scale(0.5, 0.5);   // PM/Dev subagents are half-size "babies"
    else ctx.scale(1.2, 1.2);          // normal agents 1.2x larger

    const dark = shade(c.color, -0.30);
    const light = shade(c.color, 0.30);
    const sway = Math.sin(t * 3 + c.bob) * 0.10;   // antenna sway
    const legp = Math.sin(t * 7 + c.bob) * 1.5;    // little leg shuffle
    const R = 22;                                  // body radius

    // ---- legs (two short bars) ----
    ctx.fillStyle = dark;
    roundRect(ctx, -8, R - 4, 5, 9 + legp, 2); ctx.fill();
    roundRect(ctx, 3, R - 4, 5, 9 - legp, 2); ctx.fill();

    // ---- side arm stubs (round) ----
    ctx.fillStyle = c.color;
    ctx.beginPath(); ctx.ellipse(-R + 1, 2, 7, 9, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(R - 1, 2, 7, 9, 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.ellipse(-R - 1, 4, 4, 5, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(R + 1, 4, 4, 5, 0.3, 0, Math.PI * 2); ctx.fill();

    // ---- antennae (two, tiny stubs) ----
    ctx.strokeStyle = c.color; ctx.lineWidth = 3; ctx.lineCap = "round";
    const ax = 6, ay = -R - 1;
    ctx.beginPath();
    ctx.moveTo(-5, -R + 4);
    ctx.lineTo(-ax + sway * 5, ay);
    ctx.stroke();
    ctx.fillStyle = c.color;
    ctx.beginPath(); ctx.arc(-ax + sway * 5, ay, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(5, -R + 4);
    ctx.lineTo(ax + sway * 5, ay);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(ax + sway * 5, ay, 2.4, 0, Math.PI * 2); ctx.fill();

    // ---- body (big round blob, soft gradient) ----
    const grad = ctx.createRadialGradient(-7, -9, 3, 0, 2, R + 6);
    grad.addColorStop(0, light);
    grad.addColorStop(0.7, c.color);
    grad.addColorStop(1, dark);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();
    // subtle top highlight
    ctx.fillStyle = "rgba(255,255,255,.10)";
    ctx.beginPath(); ctx.ellipse(-6, -8, 9, 7, -0.4, 0, Math.PI * 2); ctx.fill();

    // ---- eyes (embedded: black disc + small black pupil, no mint) ----
    for (const ex of [-7.5, 7.5]) {
      ctx.fillStyle = "#111";
      ctx.beginPath(); ctx.ellipse(ex, -4, 5, Math.sin(t * .65 + c.bob) > .994 ? 1 : 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.7)";
      ctx.beginPath(); ctx.arc(ex + 1.6, -5.6, 1, 0, Math.PI * 2); ctx.fill();
    }

    ctx.restore();

    // name tag
    const tagY = c.baby ? c.y + 18 : c.y + 46;
    ctx.font = "500 11px -apple-system, sans-serif";
    ctx.fillStyle = "rgba(0,0,0,.5)";
    const tw2 = ctx.measureText(c.name).width + 14;
    roundRect(ctx, c.x - tw2 / 2, tagY, tw2, 19, 9); ctx.fill();
    ctx.fillStyle = c.color;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(c.name, c.x, tagY + 10);

    // speech bubble
    if (c.bubble && c.bubble.until > performance.now()) {
      drawBubble(c, c.bubble.text);
    } else {
      c.bubble = null;
    }
  }

  function drawBubble(c, text) {
    ctx.font = "11px -apple-system, sans-serif";
    const maxW = W <= 900 ? 140 : 240;
    const lines = wrapText(text, maxW);
    const lh = 16, padX = 12, padY = 9;
    const bw = Math.min(maxW, Math.max(...lines.map(l => ctx.measureText(l).width))) + padX * 2;
    const bh = lines.length * lh + padY * 2;
    const bx = Math.max(12, Math.min(W - bw - 12, c.x - bw / 2));
    const by = c.y - 52 - bh;

    ctx.fillStyle = "rgba(255,255,255,.97)";
    roundRect(ctx, bx, by, bw, bh, 14); ctx.fill();
    // tail
    ctx.beginPath();
    ctx.moveTo(c.x - 10, by + bh - 1);
    ctx.lineTo(c.x, by + bh + 12);
    ctx.lineTo(c.x + 10, by + bh - 1);
    ctx.closePath(); ctx.fill();

    ctx.fillStyle = "#1a1f2e";
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    lines.forEach((l, i) => ctx.fillText(l, bx + padX, by + padY + i * lh));
  }

  function wrapText(text, maxW) {
    const words = text.split(/(\s+)/);
    const lines = []; let cur = "";
    for (const w of words) {
      if (ctx.measureText(cur + w).width > maxW && cur) { lines.push(cur.trim()); cur = w; }
      else cur += w;
      if (lines.length >= 4) break;
    }
    if (cur && lines.length < 4) lines.push(cur.trim());
    if (lines.length >= 4) lines[3] = lines[3].slice(0, 24) + "…";
    return lines;
  }

  // helpers
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = Math.max(0, Math.min(255, r + r * amt));
    g = Math.max(0, Math.min(255, g + g * amt));
    b = Math.max(0, Math.min(255, b + b * amt));
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  }

  // ---------- Main loop ----------
  let last = performance.now();
  function loop(now) {
    const dt = motionPaused ? 0 : Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = motionPaused ? 0 : now / 1000;

    if (bgCanvas) ctx.drawImage(bgCanvas, 0, 0, W, H);

    drawNetwork(t);
    for (const c of chars) {
      // wander
      if (activeChar !== c) {
        const dx = c.tx - c.x, dy = c.ty - c.y;
        const d = Math.hypot(dx, dy);
        if (d < 6) {
          c.wait -= dt;
          if (c.wait <= 0) pickTarget(c);
        } else {
          c.x += (dx / d) * c.speed * dt;
          c.y += (dy / d) * c.speed * dt;
          if (Math.abs(dx) > 2) c.dir = dx > 0 ? 1 : -1;
        }
      }
    }
    // draw sorted by y (depth)
    [...chars].sort((a, b) => a.y - b.y).forEach(c => drawChar(c, t));

    // ---- MultiagentBot transient subagents + handoff box ----
    for (const k of maKids) {
      // ease toward target slot
      k.x += (k.tx - k.x) * Math.min(1, dt * 6);
      k.y += (k.ty - k.y) * Math.min(1, dt * 6);
      drawChar(k, t);
      drawTaskLabel(k);
    }
    if (maBox) {
      // While "held", keep the box glued to that subagent (follows its bob/position).
      if (maBox.hold) {
        const holder = maBox.hold === "dev" ? maKids.find(k => k.role === "dev")
                     : maBox.hold === "pm" ? maKids.find(k => k.role === "pm") : null;
        if (holder) { maBox.tx = holder.x + 14; maBox.ty = holder.y - 6; }
      }
      maBox.x += (maBox.tx - maBox.x) * Math.min(1, dt * 4);
      maBox.y += (maBox.ty - maBox.y) * Math.min(1, dt * 4);
      drawBox(maBox.x, maBox.y);
    }

    requestAnimationFrame(loop);
  }

  function drawBox(x, y) {
    ctx.save();
    ctx.translate(x, y);
    const s = 11;
    ctx.fillStyle = "#c98a3c";
    roundRect(ctx, -s, -s, s * 2, s * 2, 3); ctx.fill();
    ctx.strokeStyle = "#8a5a1e"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-s, 0); ctx.lineTo(s, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(0, s); ctx.stroke();
    ctx.restore();
  }

  function drawTaskLabel(k) {
    if (!k.label) return;
    ctx.font = "600 11px -apple-system, sans-serif";
    const tw = ctx.measureText(k.label).width + 14;
    const bx = k.x - tw / 2, by = k.y - 70;
    ctx.fillStyle = k.active ? k.color : "rgba(60,60,70,.85)";
    roundRect(ctx, bx, by, tw, 18, 9); ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(k.label, k.x, by + 9);
  }

  // ---------- Interaction ----------
  let activeChar = null;

  function hitTest(mx, my) {
    // topmost (largest y) first
    const sorted = [...chars].sort((a, b) => b.y - a.y);
    for (const c of sorted) {
      if (Math.abs(mx - c.x) < 32 && my - c.y < 40 && my - c.y > -54) return c;
    }
    return null;
  }

  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const c = hitTest(e.clientX - rect.left, e.clientY - rect.top);
    chars.forEach(ch => ch.hover = false);
    if (c) { c.hover = true; canvas.style.cursor = "pointer"; }
    else canvas.style.cursor = "default";
  });

  canvas.addEventListener("click", (e) => {
    const rect = canvas.getBoundingClientRect();
    const c = hitTest(e.clientX - rect.left, e.clientY - rect.top);
    // Ignore clicks on the bot that's already open (prevents wiping an
    // in-flight conversation / clearing the panel mid-request).
    if (c && c !== activeChar) openChat(c);
  });

  // ---------- Chat UI ----------
  const chatEl = document.getElementById("chat");
  const msgsEl = document.getElementById("msgs");
  const inputEl = document.getElementById("input");
  const sendBtn = document.getElementById("send");
  const hintEl = document.getElementById("hint");

  function openChat(c) {
    stopTgRecv();
    activeChar = c;
    sendBtn.disabled = !!c.busy;
    chatEl.setAttribute("aria-hidden", "false");
    document.getElementById("chat-dot").style.background = c.color;
    document.getElementById("chat-name").textContent = c.name;
    document.getElementById("chat-role").textContent = c.role;
    emit("agent", c);
    msgsEl.innerHTML = "";
    chatEl.classList.add("open");
    hintEl.style.opacity = "0";

    // Fresh start every click: wipe this character's conversation history.
    history[c.id] = [];

    inputEl.focus();

    // Spark Monitor: don't just greet - auto-pull a live status summary.
    if (c.live === "sysinfo" || c.id === "sysmon") {
      runTurn(c, "현재 시스템 상태를 한국어로 간단히 알려주세요.", { auto: true });
    }
    // ArxivBot: the cron job already scanned arXiv and cached a pre-formatted
    // announcement. On click we just read it back instantly (no LLM round-trip),
    // so the Top 3 appear immediately - with a brief "pulling it up" beat.
    if (c.live === "arxiv") {
      showArxivTop3(c);
      // Start the per-minute cron only once the user has engaged with ArxivBot
      // (saves resources - no background polling until you click it).
      startArxivCron();
    }
    // TelegramBot: start listening for inbound Telegram messages.
    if (c.live === "telegram") startTgRecv(c);
    // MultiagentBot: offer ready-made feature ideas as clickable chips.
    if (c.live === "multiagent") renderMaSuggestions(c);
    // Other agents wait for the user to ask before acting.
  }

  // Small standalone modules suitable for a live coding demo.
  const MA_SUGGESTIONS = [
    { label: "📊 Health summary", req: "Build a dependency-free JavaScript function that summarizes GPU temperature and disk usage with configurable warning thresholds" },
    { label: "📚 Paper formatter", req: "Build a dependency-free JavaScript function that formats paper titles, authors, and links into a Markdown reading list" },
    { label: "⏱️ Task timer", req: "Build a dependency-free JavaScript module that tracks elapsed time for named tasks" },
  ];
  function renderMaSuggestions(c) {
    const wrap = document.createElement("div");
    wrap.className = "ma-chips";
    for (const s of MA_SUGGESTIONS) {
      const b = document.createElement("button");
      b.className = "ma-chip";
      b.textContent = s.label;
      b.onclick = () => {
        if (activeChar !== c) return;
        wrap.querySelectorAll("button").forEach((x) => (x.disabled = true));
        addMsg("me", s.req);
        runMultiagent(c, s.req);
      };
      wrap.appendChild(b);
    }
    msgsEl.appendChild(wrap);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  function closeChat() {
    chatEl.classList.remove("open");
    chatEl.setAttribute("aria-hidden", "true");
    emit("agent", null);
    stopTgRecv();
    maCleanup();
    activeChar = null;
    if (chars.length) hintEl.style.opacity = "1";
  }
  document.getElementById("chat-close").addEventListener("click", closeChat);

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  // Minimal, safe inline markdown -> HTML for bot messages: escapes first,
  // then renders **bold**/*italic*/_italic_, autolinks URLs, and line breaks.
  function renderInline(text) {
    let h = escapeHtml(text);
    h = h.replace(/(https?:\/\/[^\s<>"']+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:#5b8def;text-decoration:underline">$1</a>');
    h = h.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
    h = h.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?]|$)/g, "$1<b>$2</b>");
    h = h.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?]|$)/g, "$1<i>$2</i>");
    h = h.replace(/\n/g, "<br>");
    return h;
  }

  function addMsg(role, text) {
    const d = document.createElement("div");
    const isBot = role.indexOf("me") !== 0;
    d.className = "msg " + (isBot ? "bot" : "me") +
      (role.indexOf("headline") >= 0 ? " headline" : "");
    // Bot messages get light markdown (bold/italic/links); user text stays plain.
    if (isBot && role.indexOf("headline") < 0) d.innerHTML = renderInline(text);
    else d.textContent = text;
    msgsEl.appendChild(d);
    msgsEl.scrollTop = msgsEl.scrollHeight;
    return d;
  }

  function addImage(src) {
    const a = document.createElement("a");
    a.href = src; a.target = "_blank";
    const img = document.createElement("img");
    img.src = src; img.className = "shot";
    img.alt = "live Naver result";
    a.appendChild(img);
    msgsEl.appendChild(a);
    img.onload = () => { msgsEl.scrollTop = msgsEl.scrollHeight; };
    return a;
  }

  async function runTurn(c, text, opts) {
    if (c.busy) return;
    c.busy = true;
    emit("activity", { agent: c.name, text: "Gateway에 요청 전달" });
    const isAuto = opts && opts.auto;
    // Auto turns (e.g. the click-triggered status/map request) are hidden from
    // the chat panel so it doesn't look like the user typed them.
    history[c.id].push({ role: "user", content: text, hidden: !!isAuto });
    const mine = c;                 // the character this turn belongs to
    const mineId = c.id;            // stable id (object refs can change on rebuild)
    const isActive = () => activeChar && activeChar.id === mineId;
    sendBtn.disabled = true;
    const label = c.live === "search" ? "🔍 Searching Naver…"
                : "…";
    // Only show the typing indicator if this character's panel is open.
    const typing = isActive() ? addMsg("bot", label) : null;
    if (typing) typing.classList.add("typing");
    let j = null;
    let lastErr = null;
    // The browser environment aborts slow fetches after a few seconds, so we
    // never hold a long connection. Instead: start an async job (returns a
    // jobId instantly), then poll for the result with short sub-second
    // requests until it's done.
    try {
      const cleanMsgs = (history[mineId] || []).map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : String(m.content ?? ""),
      }));
      const bodyStr = JSON.stringify({ agent: mineId, messages: cleanMsgs, searchJobId: opts?.searchJobId });
      // Disguise as a static asset GET: base64 payload in the path.
      const b64 = btoa(unescape(encodeURIComponent(bodyStr)))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      console.log("[runTurn] starting job", { agent: mineId, bytes: bodyStr.length });
      const startR = await fetch("/bac-data/" + b64 + ".json?_=" + Date.now());
      const startJ = await startR.json();
      const jobId = startJ.jobId;
      if (!jobId) throw new Error("no jobId returned");
      console.log("[runTurn] job started", jobId);
      // Poll up to ~150s (300 * 500ms) for completion.
      for (let i = 0; i < 300; i++) {
        await new Promise((rs) => setTimeout(rs, 500));
        if (!isActive()) { console.log("[runTurn] navigated away, stop polling"); break; }
        const pr = await fetch("/bac-poll/" + jobId + ".json?_=" + Date.now());
        const pj = await pr.json();
        if (pj.status === "done") { j = pj; console.log("[runTurn] job done", { hasReply: !!pj.reply }); break; }
        if (pj.status === "unknown") { lastErr = new Error("job expired"); break; }
        // else status === "pending": keep polling
      }
    } catch (err) {
      lastErr = err;
      console.warn("[runTurn] job/poll failed:", err && err.message);
    }
    if (j === null) {
      console.warn("chat failed:", lastErr && lastErr.message);
      if (isActive() && typing) typing.remove();
      c.busy = false;
      if (isActive()) { sendBtn.disabled = false; addMsg("bot", "응답을 받지 못했습니다. Gateway 연결을 확인하고 다시 시도해주세요."); }
      emit("activity", { agent: c.name, text: "요청 실패 또는 대화 이동" });
      return;
    }
    try {
      const reply = j.reply || j.error || "(no response)";
      history[mineId].push({ role: "assistant", content: reply });
      if (!j.error) emit("result", { agent: c.name, text: reply });
      emit("activity", { agent: c.name, text: j.error ? "요청 실패" : "응답 수신" });
      // Render if this character's panel is still open (compare by id).
      if (isActive()) {
        if (typing) typing.remove();
        // Show the concise SUMMARY headline in the chat, then the detail.
        if (j.bubble) addMsg("bot headline", j.bubble);
        addMsg("bot", reply);
        console.log("[runTurn] rendered reply into panel");
        if (j.screenshot) addImage(j.screenshot);
        // Only user-initiated turns update the floating bubble.
        if (!isAuto) {
          const short = j.bubble || reply.replace(/\n+/g, " ").slice(0, 90);
          mine.bubble = { text: short, until: performance.now() + 8000 };
        }
      } else {
        console.log("[runTurn] NOT rendered - panel not active for", mineId, "activeChar=", activeChar && activeChar.id);
      }
    } catch (err) {
      console.error("render failed:", err);
    } finally {
      c.busy = false;
      if (isActive()) { sendBtn.disabled = false; inputEl.focus(); }
    }
  }

  async function sendMsg() {
    const text = inputEl.value.trim();
    if (!text || !activeChar || activeChar.busy || sendBtn.disabled) return;
    const c = activeChar;
    inputEl.value = "";
    addMsg("me", text);
    if (c.live === "telegram") { tgSendMsg(c, text); return; }
    if (c.live === "multiagent") { runMultiagent(c, text); return; }
    if (c.live === "search" && window.BacShowcase) { window.BacShowcase.browse(text); return; }
    if (c.live === "agentmail") { window.BacShowcase?.inbox(); return; }
    runTurn(c, text);
  }
  document.getElementById("inbar").addEventListener("submit", e => { e.preventDefault(); sendMsg(); });

  // ---------- Telegram two-way bridge (client) ----------
  let tgPollTimer = null;
  let tgLastId = 0;
  async function tgSendMsg(c, text) {
    sendBtn.disabled = true;
    try {
      const r = await fetch("/api/integrations/telegram/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      const j = await r.json();
      if (activeChar === c) {
        if (j.ok) {
          emit("activity", { agent: c.name, text: "Telegram에 메시지 전달" });
          c.bubble = { text: "Sent to Telegram 📤", until: performance.now() + 4000 };
        } else {
          addMsg("bot", j.note || ("Could not send: " + (j.error || "unknown error")));
        }
      }
    } catch (err) {
      if (activeChar === c) addMsg("bot", "Telegram으로 보내지 못했습니다. 연결 설정을 확인해주세요.");
    } finally {
      if (activeChar === c) { sendBtn.disabled = false; inputEl.focus(); }
    }
  }
  function startTgRecv(c) {
    stopTgRecv();
    tgLastId = 0; // only surface messages from now on
    // First call establishes the current high-water mark.
    (async () => {
      try {
        const r = await fetch("/bac-tg-recv/0.json?_=" + Date.now());
        const j = await r.json();
        tgLastId = j.lastId || 0;
      } catch {}
    })();
    tgPollTimer = setInterval(async () => {
      if (!activeChar || activeChar.id !== c.id) { stopTgRecv(); return; }
      try {
        const r = await fetch("/bac-tg-recv/" + tgLastId + ".json?_=" + Date.now());
        const j = await r.json();
        if (j.messages && j.messages.length) {
          for (const m of j.messages) {
            tgLastId = Math.max(tgLastId, m.id);
            if (activeChar && activeChar.id === c.id) {
              addMsg("bot", m.text);
              c.bubble = { text: m.text.replace(/\n+/g, " ").slice(0, 80), until: performance.now() + 8000 };
            }
          }
        } else if (typeof j.lastId === "number") {
          tgLastId = Math.max(tgLastId, j.lastId === 0 ? tgLastId : tgLastId);
        }
      } catch (err) {
        // network hiccup; keep trying quietly
      }
    }, 1500);
  }
  function stopTgRecv() {
    if (tgPollTimer) { clearInterval(tgPollTimer); tgPollTimer = null; }
  }

  // ---------- MultiagentBot orchestration (client) ----------
  function maCleanup() {
    maKids = []; maBox = null; maParent = null;
  }

  async function runMultiagent(c, request) {
    if (c.busy) return;
    c.busy = true;
    maCleanup();
    maParent = c;
    sendBtn.disabled = true;
    const seen = new Set();

    // Spawn two subagent sprites flanking the orchestrator.
    // Place PM and Dev on the SAME lower row (children below the parent),
    // PM on the left and Dev on the right, well separated so bubbles don't overlap.
    const pm = {
      id: "_ma_pm", role: "pm", name: "PM", label: "PM", baby: true,
      color: "#5b8def", x: c.x, y: c.y, tx: arena().x - (W <= 900 ? 65 : 105), ty: arena().y - 55,
      bob: Math.random() * 6, dir: 1, active: false, hover: false, bubble: null,
    };
    const dev = {
      id: "_ma_dev", role: "dev", name: "Dev", label: "Dev", baby: true,
      color: "#34c98a", x: c.x, y: c.y, tx: arena().x + (W <= 900 ? 65 : 105), ty: arena().y - 55,
      bob: Math.random() * 6, dir: -1, active: false, hover: false, bubble: null,
    };
    maKids = [pm, dev];

    function bubbleFor(actor, text, ms) {
      const target = actor === "pm" ? pm : actor === "dev" ? dev : c;
      // Subagents (PM/Dev) keep their bubble up much longer so the audience
      // can read what they did before the next action; orchestrator is shorter.
      const dur = ms != null ? ms : (actor === "pm" || actor === "dev") ? 12000 : 7000;
      const until = dur === Infinity ? Infinity : performance.now() + dur;
      target.bubble = { text: text.replace(/\n+/g, " ").slice(0, 90), until };
    }
    const wait = (ms) => new Promise((rs) => setTimeout(rs, ms));

    let jobId = null;
    try {
      const bodyStr = JSON.stringify({ agent: "multiagent", messages: [{ role: "user", content: request }] });
      const b64 = btoa(unescape(encodeURIComponent(bodyStr)))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const sr = await fetch("/bac-ma-start/" + b64 + ".json?_=" + Date.now());
      jobId = (await sr.json()).jobId;
    } catch (e) { console.warn("[ma] start failed", e && e.message); }
    if (!jobId) {
      addMsg("bot", "Couldn't start the team. Try again?");
      sendBtn.disabled = false; c.busy = false; maCleanup(); return;
    }

    const isActive = () => activeChar && activeChar.id === c.id;
    let done = false;
    for (let i = 0; i < 120 && !done; i++) {
      await new Promise((rs) => setTimeout(rs, 700));
      if (!isActive()) { maCleanup(); c.busy = false; return; }
      let pj;
      try {
        const pr = await fetch("/bac-ma-poll/" + jobId + ".json?_=" + Date.now());
        pj = await pr.json();
      } catch { continue; }
      if (pj.status === "unknown") break;
      for (const st of (pj.stages || [])) {
        const key = st.stage + "|" + st.text;
        if (seen.has(key)) continue;
        seen.add(key);
        await handleStage(st);
      }
      if (pj.status === "done") done = true;
    }

    async function handleStage(st) {
      if (!isActive()) return;
      emit("activity", { agent: st.actor || "Team", text: st.text });
      switch (st.stage) {
        case "spawn":
          // Orchestrator: short, intuitive "what's happening" line
          bubbleFor("orchestrator", "Got it - spinning up my team 👥");
          // Let the parent speak alone first, then PM jumps in after a beat
          await wait(2200);
          break;
        case "pm-start":
          pm.active = true; pm.label = "PM • planning…";
          bubbleFor("pm", "On it - figuring out the plan 🧠");
          break;
        case "pm-done":
          pm.active = false; pm.label = "PM ✓";
          addMsg("bot headline", "🧠 PM plan");
          addMsg("bot", st.plan || st.text);
          bubbleFor("pm", "Plan's ready - handing it to Dev ✅");
          // hold so the audience can read the plan before the handoff
          await wait(5000);
          break;
        case "handoff":
          // box flies from PM to Dev, then STAYS in Dev's hands while it works
          maBox = { x: pm.x, y: pm.y - 10, tx: dev.x, ty: dev.y - 10, hold: "dev" };
          bubbleFor("dev", "Thanks! Picking this up 📦");
          await wait(1800);
          break;
        case "dev-start":
          dev.active = true; dev.label = "Dev • building…";
          // keep this bubble up for the WHOLE build (same lifetime as the box in
          // Dev's hands) - stays until dev-done replaces it
          bubbleFor("dev", "Writing the code now ⌨️", Infinity);
          break;
        case "dev-done":
          dev.active = false; dev.label = st.prUrl ? "Dev ✓ PR #" + st.prNum : "Dev ✗";
          maBox = null;   // box is "delivered" - remove only now that the PR is open
          addMsg("bot", st.text);
          if (st.prUrl) {
            const a = document.createElement("a");
            a.href = st.prUrl; a.target = "_blank"; a.textContent = "🔗 View PR #" + st.prNum;
            a.className = "msg bot"; a.style.color = "#5b8def"; a.style.textDecoration = "underline";
            msgsEl.appendChild(a); msgsEl.scrollTop = msgsEl.scrollHeight;
          }
          bubbleFor("dev", st.prUrl ? "Done! Opened a PR 🚀" : "Hit a snag 😅");
          // hold so the audience can see what Dev shipped before the merge
          await wait(5000);
          break;
        case "merge":
          // kids slide back into the orchestrator, then vanish
          pm.tx = c.x; pm.ty = c.y; dev.tx = c.x; dev.ty = c.y;
          bubbleFor("orchestrator", "All wrapped up - nice work team 🎉");
          addMsg("bot headline", "🎉 " + st.text);
          setTimeout(() => { if (maParent === c) maCleanup(); }, 2500);
          break;
        case "error":
        case "pm-fallback":
          if (st.text) addMsg("bot", st.text);
          break;
      }
    }

    c.busy = false;
    if (isActive()) { sendBtn.disabled = false; inputEl.focus(); }
    if (!done && isActive()) addMsg("bot", "팀 작업이 시간 안에 완료되지 않았습니다. Gateway와 GitHub 연결을 확인해주세요.");
  }

  // ---------- Boot ----------
  async function boot() {
    buildBackground();
    try {
      const r = await fetch("/api/agents");
      const j = await r.json();
      AGENTS = j.agents || [];
    } catch {
      AGENTS = [];
    }
    buildChars();
    emit("ready", chars);
    requestAnimationFrame(loop);
  }

  // ArxivBot "cron job": every minute, refresh the Top-3 papers and pop a
  // self-initiated bubble (no click needed). Says "Updated!" ONLY when the
  // Top 3 actually changed since last scan; otherwise shows a "checked" note,
  // so the cron is visibly alive without faking an update.
  // ArxivBot click: read the cron-cached Top 3 announcement and show it fast.
  // No LLM call - the cron already did the work; this is just a file/cache read.
  async function showArxivTop3(c) {
    const typing = addMsg("bot", "논문 조회 중...");
    try {
      const r = await fetch("/bac-arxiv/top3.json?_=" + Date.now());
      const j = await r.json();
      emit("result", { agent: c.name, text: j.text });
      emit("activity", { agent: c.name, text: j.source === "live" ? "arXiv RSS에서 논문 수신" : "저장된 참고 논문 표시" });
      // tiny beat so it reads as "fetching", then swap in the real cards
      setTimeout(() => {
        if (j.text) typing.innerHTML = renderInline((j.source === "live" ? "" : "참고 논문 모음 - 최신 피드가 비어 있거나 연결되지 않았습니다.\n\n") + j.text);
        else typing.textContent = "논문이 없습니다.";
        msgsEl.scrollTop = msgsEl.scrollHeight;
      }, 450);
    } catch {
      typing.textContent = "논문 조회 실패. 다시 시도하세요.";
    }
  }

  // ArxivBot "cron job": kicks in the first time the user clicks ArxivBot, then
  // re-scans arXiv every minute and surfaces a fresh Top 3 (rotating through
  // today's agentic papers). Guarded so repeated clicks don't stack timers.
  let arxivCronStarted = false;
  function startArxivCron() {
    if (arxivCronStarted) return;
    const arx = chars.find((c) => c.live === "arxiv");
    if (!arx) return;
    arxivCronStarted = true;
    let previous = "";
    const ping = async () => {
      try {
        const r = await fetch("/bac-arxiv/top3.json?_=" + Date.now()), j = await r.json();
        const signature = (j.papers || []).map(p => p.link).sort().join("|");
        const changed = previous && signature !== previous; previous = signature;
        emit("activity", { agent: arx.name, text: j.source === "live" ? "예약 확인: arXiv 피드" : "예약 확인: 참고 논문 모음" });
        if (changed && activeChar?.id !== arx.id) arx.bubble = { text: "새 논문", until: performance.now() + 5000 };
      } catch { emit("activity", { agent: arx.name, text: "예약 확인 실패" }); }
    };
    setInterval(ping, 60000); // re-scan once a minute from first click onward
  }
  window.addEventListener("resize", () => {
    chars.forEach((c,i) => { const h=home(i); c.x=c.tx=h.x; c.y=c.ty=h.y; }); buildBackground();
  });
  window.BacDemo = {
    getAgents: () => chars, getActive: () => activeChar,
    openAgent(id) { const c=chars.find(a=>a.id===id); if(c && c!==activeChar) openChat(c); },
    runTurn, addMsg,
    motion(value) { motionPaused=value; },
    isPaused: () => motionPaused,
    busy(id,value) { const c=chars.find(a=>a.id===id); if(c)c.busy=value; },
    bubble(id,text) { const c=chars.find(a=>a.id===id); if(c) c.bubble={text,until:performance.now()+6000}; }
  };
  boot();
})();
