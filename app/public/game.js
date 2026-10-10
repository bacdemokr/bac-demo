/* BaC Multi-Agent Demo — game engine */
(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, DPR = 1;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
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

  function buildChars() {
    chars = AGENTS.map((a, i) => {
      const x = rand(W * 0.15, W * 0.85);
      const y = rand(H * 0.42, H * 0.88);
      return {
        ...a,
        x, y,
        tx: x, ty: y,            // wander target
        dir: 1,                  // facing (1 right, -1 left)
        bob: Math.random() * Math.PI * 2,
        speed: rand(22, 34),
        wait: rand(0, 2),
        bubble: null,            // {text, until}
        hover: false,
      };
    });
  }

  function pickTarget(c) {
    c.tx = rand(W * 0.1, W * 0.9);
    c.ty = rand(H * 0.4, H * 0.9);
    c.wait = rand(1.5, 4.5);
  }

  // ---------- Background: pixel BaC lobby ----------
  // Inspired by the wooden-lattice ceiling + concrete staircase photo.
  let bgCanvas = null;
  function buildBackground() {
    bgCanvas = document.createElement("canvas");
    bgCanvas.width = W; bgCanvas.height = H;
    const b = bgCanvas.getContext("2d");

    // floor gradient (polished concrete)
    const g = b.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#10131f");
    g.addColorStop(0.45, "#1b2030");
    g.addColorStop(1, "#2b3142");
    b.fillStyle = g; b.fillRect(0, 0, W, H);

    // ----- wooden lattice ceiling (top third) -----
    const ceilH = H * 0.34;
    b.save();
    b.beginPath(); b.rect(0, 0, W, ceilH); b.clip();
    // dark ceiling base
    b.fillStyle = "#0c0e16"; b.fillRect(0, 0, W, ceilH);
    // criss-cross wooden beams (warm tones)
    const woods = ["#7a4a23", "#8a5526", "#9c632f", "#6b3f1e"];
    const step = 46;
    for (let i = -ceilH; i < W + ceilH; i += step) {
      b.strokeStyle = woods[(i / step | 0) % woods.length];
      b.lineWidth = 7;
      b.beginPath(); b.moveTo(i, 0); b.lineTo(i + ceilH * 1.6, ceilH); b.stroke();
      b.beginPath(); b.moveTo(i, 0); b.lineTo(i - ceilH * 1.6, ceilH); b.stroke();
    }
    // warm glow lights between beams
    for (let i = 0; i < W; i += step * 1.5) {
      const gx = i + step * 0.5;
      const rg = b.createRadialGradient(gx, ceilH * 0.5, 2, gx, ceilH * 0.5, 26);
      rg.addColorStop(0, "rgba(255,210,120,.55)");
      rg.addColorStop(1, "rgba(255,210,120,0)");
      b.fillStyle = rg; b.beginPath();
      b.arc(gx, ceilH * 0.5, 26, 0, Math.PI * 2); b.fill();
    }
    b.restore();

    // ceiling bottom edge shadow
    const eg = b.createLinearGradient(0, ceilH - 30, 0, ceilH + 30);
    eg.addColorStop(0, "rgba(0,0,0,0)");
    eg.addColorStop(1, "rgba(0,0,0,.5)");
    b.fillStyle = eg; b.fillRect(0, ceilH - 30, W, 60);

    // ----- back wall + pillars -----
    const wallY = ceilH, wallH = H * 0.2;
    b.fillStyle = "#171b28"; b.fillRect(0, wallY, W, wallH);
    // wooden pillars
    b.fillStyle = "#6b3f1e";
    const pcount = Math.max(4, Math.floor(W / 220));
    for (let p = 0; p <= pcount; p++) {
      const px = (W / pcount) * p - 14;
      b.fillRect(px, wallY - 8, 22, wallH + 16);
      b.fillStyle = "rgba(255,255,255,.05)";
      b.fillRect(px, wallY - 8, 6, wallH + 16);
      b.fillStyle = "#6b3f1e";
    }

    // ----- central staircase -----
    const stairTop = wallY + wallH;
    const stairW = Math.min(W * 0.4, 460);
    const cx = W / 2;
    const steps = 9;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const sw = stairW * (1 + t * 0.55);
      const sy = stairTop + (H - stairTop) * (s / steps) * 0.9;
      const sh = (H - stairTop) / steps * 0.9;
      b.fillStyle = s % 2 ? "#23293a" : "#2a3144";
      b.fillRect(cx - sw / 2, sy, sw, sh + 1);
      b.fillStyle = "rgba(0,0,0,.25)";
      b.fillRect(cx - sw / 2, sy + sh - 3, sw, 3);
    }

    // ----- "Build-a-Claw" sign, tucked into the lower-left corner -----
    b.save();
    b.textAlign = "left";
    b.textBaseline = "alphabetic";
    const fsize = Math.max(22, Math.min(48, W * 0.038));
    const bx = 28, by = H - 28;
    b.font = `800 ${fsize}px "Trebuchet MS", Verdana, sans-serif`;
    // soft glow halo behind the text
    b.shadowColor = "rgba(120,180,255,.5)";
    b.shadowBlur = 18;
    b.fillStyle = "rgba(150,195,255,.18)";
    b.fillText("Build-a-Claw", bx, by);
    // crisp light stroke on top, subtle so it reads as part of the scene
    b.shadowBlur = 0;
    b.lineWidth = 1.5;
    b.strokeStyle = "rgba(190,215,255,.24)";
    b.strokeText("Build-a-Claw", bx, by);
    b.restore();

    // soft vignette
    const vg = b.createRadialGradient(cx, H * 0.55, H * 0.3, cx, H * 0.55, H * 0.85);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,.55)");
    b.fillStyle = vg; b.fillRect(0, 0, W, H);
  }

  // ---------- Draw a Claw mascot character (color-tinted) ----------
  function drawChar(c, t) {
    const bob = Math.sin(t * 3 + c.bob) * 2;
    const x = c.x, y = c.y + bob;

    ctx.save();
    // shadow
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.beginPath();
    const shY = c.baby ? c.y + 15 : c.y + 36;
    const shRx = c.baby ? 11 : 24, shRy = c.baby ? 3 : 7;
    ctx.ellipse(c.x, shY, shRx, shRy, 0, 0, Math.PI * 2);
    ctx.fill();

    // hover ring
    if (c.hover) {
      ctx.strokeStyle = "rgba(255,255,255,.85)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(c.x, y - 7, 41, 48, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.translate(x, y);
    ctx.scale(c.dir, 1);
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
      ctx.beginPath(); ctx.arc(ex, -4, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.7)";
      ctx.beginPath(); ctx.arc(ex + 1.6, -5.6, 1, 0, Math.PI * 2); ctx.fill();
    }

    ctx.restore();

    ctx.restore();

    // name tag
    const tagY = c.baby ? c.y + 18 : c.y + 46;
    ctx.font = "600 14px -apple-system, sans-serif";
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
    ctx.font = "16px -apple-system, sans-serif";
    const maxW = 240;
    const lines = wrapText(text, maxW);
    const lh = 20, padX = 14, padY = 11;
    const bw = Math.min(maxW, Math.max(...lines.map(l => ctx.measureText(l).width))) + padX * 2;
    const bh = lines.length * lh + padY * 2;
    const bx = c.x - bw / 2;
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
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;

    if (bgCanvas) ctx.drawImage(bgCanvas, 0, 0, W, H);

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
    const c = hitTest(e.clientX, e.clientY);
    chars.forEach(ch => ch.hover = false);
    if (c) { c.hover = true; canvas.style.cursor = "pointer"; }
    else canvas.style.cursor = "default";
  });

  canvas.addEventListener("click", (e) => {
    const c = hitTest(e.clientX, e.clientY);
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
    activeChar = c;
    document.getElementById("chat-dot").style.background = c.color;
    document.getElementById("chat-name").textContent = c.name;
    document.getElementById("chat-role").textContent = c.role;
    msgsEl.innerHTML = "";
    chatEl.classList.add("open");
    hintEl.style.opacity = "0";

    // Fresh start every click: wipe this character's conversation history.
    history[c.id] = [];

    // speech bubble pops above the character: short tagline (not the full intro/first reply)
    c.bubble = { text: c.tagline || c.intro, until: performance.now() + 6000 };

    addMsg("bot", c.intro);
    inputEl.focus();

    // Spark Monitor: don't just greet — auto-pull a live status summary.
    if (c.live === "sysinfo" || c.id === "sysmon") {
      runTurn(c, "Give me a concise current system status summary.", { auto: true });
    }
    // ArxivBot: the cron job already scanned arXiv and cached a pre-formatted
    // announcement. On click we just read it back instantly (no LLM round-trip),
    // so the Top 3 appear immediately — with a brief "pulling it up" beat.
    if (c.live === "arxiv") {
      showArxivTop3(c);
      // Start the per-minute cron only once the user has engaged with ArxivBot
      // (saves resources — no background polling until you click it).
      startArxivCron();
    }
    // TelegramBot: start listening for inbound Telegram messages.
    if (c.live === "telegram") startTgRecv(c);
    // MultiagentBot: offer ready-made feature ideas as clickable chips.
    if (c.live === "multiagent") renderMaSuggestions(c);
    // Other agents: just greet. Wait for the user to ask before acting.
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
    const hint = document.createElement("div");
    hint.className = "msg bot";
    hint.style.opacity = ".8";
    hint.textContent = "Pick a feature for my team to build — or type your own:";
    msgsEl.appendChild(hint);
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
    stopTgRecv();
    maCleanup();
    activeChar = null;
    if (chars.length) hintEl.style.opacity = "1";
  }
  document.getElementById("chat-close").addEventListener("click", closeChat);

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  // Minimal, safe inline markdown -> HTML for bot messages: escapes first,
  // then renders **bold**/*italic*/_italic_, autolinks URLs, and line breaks.
  function renderInline(text) {
    let h = escapeHtml(text);
    h = h.replace(/(https?:\/\/[^\s<>"']+)/g,
      '<a href="$1" target="_blank" style="color:#5b8def;text-decoration:underline">$1</a>');
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
      const bodyStr = JSON.stringify({ agent: mineId, messages: cleanMsgs });
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
      sendBtn.disabled = false;
      return;
    }
    try {
      const reply = j.reply || j.error || "(no response)";
      history[mineId].push({ role: "assistant", content: reply });
      // Render if this character's panel is still open (compare by id).
      if (isActive()) {
        if (typing) typing.remove();
        // Show the concise SUMMARY headline in the chat, then the detail.
        if (j.bubble) addMsg("bot headline", j.bubble);
        addMsg("bot", reply);
        console.log("[runTurn] rendered reply into panel");
        if (j.screenshot) addImage(j.screenshot);
        // Only user-initiated turns update the floating bubble; the auto
        // status/intro turn keeps the short feature tagline shown on click.
        if (!isAuto) {
          const short = j.bubble || reply.replace(/\n+/g, " ").slice(0, 90);
          mine.bubble = { text: short, until: performance.now() + 8000 };
        }
      } else {
        console.log("[runTurn] NOT rendered — panel not active for", mineId, "activeChar=", activeChar && activeChar.id);
      }
    } catch (err) {
      console.error("render failed:", err);
    } finally {
      sendBtn.disabled = false;
      if (isActive()) inputEl.focus();
    }
  }

  async function sendMsg() {
    const text = inputEl.value.trim();
    if (!text || !activeChar) return;
    const c = activeChar;
    inputEl.value = "";
    addMsg("me", text);
    if (c.live === "telegram") { tgSendMsg(c, text); return; }
    if (c.live === "multiagent") { runMultiagent(c, text); return; }
    runTurn(c, text);
  }
  sendBtn.addEventListener("click", sendMsg);
  inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter") sendMsg(); });

  // ---------- Telegram two-way bridge (client) ----------
  let tgPollTimer = null;
  let tgLastId = 0;
  function b64urlOf(obj) {
    return btoa(unescape(encodeURIComponent(JSON.stringify(obj))))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  async function tgSendMsg(c, text) {
    sendBtn.disabled = true;
    try {
      const r = await fetch("/bac-tg-send/" + b64urlOf({ text }) + ".json?_=" + Date.now());
      const j = await r.json();
      if (activeChar === c) {
        if (j.ok) {
          c.bubble = { text: "Sent to Telegram 📤", until: performance.now() + 4000 };
        } else {
          addMsg("bot", j.note || ("Could not send: " + (j.error || "unknown error")));
        }
      }
    } catch (err) {
      console.warn("[tg] send failed:", err && err.message);
    } finally {
      sendBtn.disabled = false;
      if (activeChar === c) inputEl.focus();
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
    maCleanup();
    maParent = c;
    sendBtn.disabled = true;
    const seen = new Set();

    // Spawn two subagent sprites flanking the orchestrator.
    // Place PM and Dev on the SAME lower row (children below the parent),
    // PM on the left and Dev on the right, well separated so bubbles don't overlap.
    const pm = {
      id: "_ma_pm", role: "pm", name: "PM", label: "PM", baby: true,
      color: "#5b8def", x: c.x, y: c.y, tx: c.x - 130, ty: c.y + 110,
      bob: Math.random() * 6, dir: 1, active: false, hover: false, bubble: null,
    };
    const dev = {
      id: "_ma_dev", role: "dev", name: "Dev", label: "Dev", baby: true,
      color: "#34c98a", x: c.x, y: c.y, tx: c.x + 130, ty: c.y + 110,
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
      sendBtn.disabled = false; maCleanup(); return;
    }

    const isActive = () => activeChar && activeChar.id === c.id;
    let done = false;
    for (let i = 0; i < 120 && !done; i++) {
      await new Promise((rs) => setTimeout(rs, 700));
      if (!isActive()) { maCleanup(); sendBtn.disabled = false; return; }
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
      switch (st.stage) {
        case "spawn":
          // Orchestrator: short, intuitive "what's happening" line
          bubbleFor("orchestrator", "Got it — spinning up my team 👥");
          // Let the parent speak alone first, then PM jumps in after a beat
          await wait(2200);
          break;
        case "pm-start":
          pm.active = true; pm.label = "PM • planning…";
          bubbleFor("pm", "On it — figuring out the plan 🧠");
          break;
        case "pm-done":
          pm.active = false; pm.label = "PM ✓";
          addMsg("bot headline", "🧠 PM plan");
          addMsg("bot", st.plan || st.text);
          bubbleFor("pm", "Plan's ready — handing it to Dev ✅");
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
          // Dev's hands) — stays until dev-done replaces it
          bubbleFor("dev", "Writing the code now ⌨️", Infinity);
          break;
        case "dev-done":
          dev.active = false; dev.label = st.prUrl ? "Dev ✓ PR #" + st.prNum : "Dev ✗";
          maBox = null;   // box is "delivered" — remove only now that the PR is open
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
          bubbleFor("orchestrator", "All wrapped up — nice work team 🎉");
          addMsg("bot headline", "🎉 " + st.text);
          setTimeout(() => { if (maParent === c) maCleanup(); }, 2500);
          break;
        case "error":
        case "pm-fallback":
          if (st.text) addMsg("bot", st.text);
          break;
      }
    }

    sendBtn.disabled = false;
    if (isActive()) inputEl.focus();
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
    requestAnimationFrame(loop);
  }

  // ArxivBot "cron job": every minute, refresh the Top-3 papers and pop a
  // self-initiated bubble (no click needed). Says "Updated!" ONLY when the
  // Top 3 actually changed since last scan; otherwise shows a "checked" note,
  // so the cron is visibly alive without faking an update.
  // ArxivBot click: read the cron-cached Top 3 announcement and show it fast.
  // No LLM call — the cron already did the work; this is just a file/cache read.
  async function showArxivTop3(c) {
    const typing = addMsg("bot", "\uD83D\uDCE1 Pulling up my latest arXiv scan\u2026");
    try {
      const r = await fetch("/bac-arxiv/top3.json?_=" + Date.now());
      const j = await r.json();
      // tiny beat so it reads as "fetching", then swap in the real cards
      setTimeout(() => {
        if (j.text) typing.innerHTML = renderInline(j.text);
        else typing.textContent = "Hmm, my scan came back empty \u2014 try again in a moment!";
        msgsEl.scrollTop = msgsEl.scrollHeight;
      }, 450);
    } catch {
      typing.textContent = "Couldn't reach my paper feed just now \u2014 try again in a sec!";
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
    const ping = async () => {
      try { await fetch("/bac-arxiv/top3.json?_=" + Date.now()); } catch {}
      // Don't talk over an open chat with this bot.
      if (activeChar && activeChar.id === arx.id) return;
      const updated = [
        "📚 New Agentic AI papers — updated!",
        "🔔 Fresh Top 3 just in — click me!",
        "✨ Updated! New picks from arXiv — take a look!",
        "📡 Just re-scanned arXiv — new Top 3 ready!",
      ];
      const text = updated[Math.floor(Math.random() * updated.length)];
      arx.bubble = { text, until: performance.now() + 7000 };
    };
    setInterval(ping, 60000); // re-scan once a minute from first click onward
  }
  window.addEventListener("resize", () => { buildBackground(); });
  boot();
})();
