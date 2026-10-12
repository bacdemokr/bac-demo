/* Agentic AI Demo - canvas and conversations */
(() => {
  const canvas = document.getElementById("game");
  const wrap = document.getElementById("wrap");
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, DPR = 1;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
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
  const mobileView = () => window.innerWidth <= 900;
  const compactView = () => mobileView() && wrap.classList.contains("chat-open");
  const characterScale=()=>compactView()?(H<380?.65:.76):1;
  function arena() {
    const mobile = mobileView(), compact = compactView();
    const docked = wrap.classList.contains("chat-open");
    const preferredLeft = mobile ? 24 : docked && window.innerWidth <= 1100 ? 185 : docked && window.innerWidth <= 1350 ? 210 : window.innerWidth >= 1500 ? 380 : 330;
    const right = Math.max(1, W - Math.min(mobile ? 24 : 40, W / 8));
    const left = Math.min(preferredLeft, Math.max(0, right - 120));
    const top = compact ? Math.min(155, H * .48) : mobile ? 365 : Math.min(210, H * .25);
    const rosterTop = document.getElementById("agent-roster").offsetTop;
    const bottom = compact ? H - 58 : mobile ? H - 310 : Math.min(H - 240, rosterTop > 0 ? rosterTop - 80 : H - 240);
    const minRadius = compact ? 32 : docked ? Math.max(55, 150 - Math.max(0, right - left - 380) * .4) : 55;
    return { x: (left + right) / 2, y: (top + bottom) / 2, rx: (right - left) * .34, ry: Math.max(minRadius, (bottom - top) * .36), left, right, top, bottom };
  }
  function home(i) {
    const a = arena();
    if (compactView()) {
      const columns = Math.ceil(AGENTS.length / 2), firstRow = i < columns, count = firstRow ? columns : AGENTS.length - columns;
      const column = firstRow ? i : i - columns;
      return { x: a.left + (a.right - a.left) * (column + .5) / count, y: firstRow ? Math.max(146, document.getElementById("agent-roster").offsetTop + document.getElementById("agent-roster").offsetHeight + 36) : Math.max(231, H - 64) };
    }
    const angle = (i / Math.max(AGENTS.length, 1)) * Math.PI * 2 - Math.PI / 2;
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
    const scale = characterScale();
    ctx.save();
    ctx.translate(c.x, c.y); ctx.scale(scale, scale); ctx.translate(-c.x, -c.y);
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
    ctx.restore();
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
      // Reduced motion keeps the working team visible without movement.
      if(motionPaused){k.x=k.tx;k.y=k.ty;}else{
        k.x += (k.tx - k.x) * Math.min(1, dt * 6);
        k.y += (k.ty - k.y) * Math.min(1, dt * 6);
      }
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

  // ---------- Conversation state ----------
  let activeChar=null,chatOpener=null;
  const chatEl=document.getElementById('chat'),msgsEl=document.getElementById('msgs'),inputEl=document.getElementById('input'),sendBtn=document.getElementById('send'),hintEl=document.getElementById('hint');
  const sessions=new Map();
  function session(c){if(!sessions.has(c.id)){sessions.set(c.id,{nodes:[],draft:'',initialized:false});history[c.id]=[];}return sessions.get(c.id);}
  function escapeHtml(value){return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
  function renderInline(text){return escapeHtml(text).replace(/(https?:\/\/[^\s<>"']+)/g,'<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>').replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>').replace(/\n/g,'<br>');}
  function append(c,role,text){
    const node=document.createElement('div');node.className='msg '+role;
    if(role.startsWith('me'))node.textContent=text;else node.innerHTML=renderInline(text);
    const state=session(c);state.nodes.push(node);if(state.nodes.length>60)state.nodes.shift().remove();
    if(activeChar===c){const bottom=msgsEl.scrollHeight-msgsEl.scrollTop-msgsEl.clientHeight<50;msgsEl.append(node);if(bottom)msgsEl.scrollTop=msgsEl.scrollHeight;}
    return node;
  }
  function addMsg(role,text){if(activeChar)return append(activeChar,role==='me'?'me':'bot',text);}
  function update(node,text,error=false){node.classList.remove('typing');node.classList.toggle('error',error);node.innerHTML=renderInline(text);}
  function sync(){sendBtn.disabled=!activeChar||activeChar.busy||!(window.BacShowcase?.canRun(activeChar.id)??true);emit('state',activeChar);}
  function stash(){if(activeChar)session(activeChar).draft=inputEl.value;}
  function openChat(c){
    if(c===activeChar)return;
    stash();if(!chatEl.contains(document.activeElement))chatOpener=document.activeElement;
    activeChar=c;chatEl.inert=false;chatEl.setAttribute('aria-hidden','false');wrap.classList.add('chat-open');chatEl.classList.add('open');
    document.getElementById('chat-dot').style.background=c.color;document.getElementById('chat-name').textContent=c.name;
    const state=session(c);msgsEl.replaceChildren(...state.nodes);msgsEl.scrollTop=msgsEl.scrollHeight;inputEl.value=state.draft;
    hintEl.style.opacity='0';emit('agent',c);sync();if(mobileView())scrollTo(0,0);inputEl.focus({preventScroll:true});
    if(!state.initialized){state.initialized=true;if(c.id==='sysmon')showSystem(c);if(c.id==='arxiv'){showPapers(c);startArxivCron();}if(c.id==='multiagent')suggestions(c);}
  }
  function closeChat({restoreFocus=true}={}){
    if(!activeChar)return;stash();const focused=chatEl.contains(document.activeElement);activeChar=null;
    chatEl.classList.remove('open');wrap.classList.remove('chat-open');chatEl.inert=true;chatEl.setAttribute('aria-hidden','true');hintEl.style.opacity='1';emit('agent',null);
    if(focused){if(restoreFocus&&chatOpener?.isConnected&&chatOpener!==document.body)chatOpener.focus({preventScroll:true});else document.activeElement.blur();}
  }
  function hitTest(x,y){const scale=characterScale();return [...chars].sort((a,b)=>b.y-a.y).find(c=>Math.abs(x-c.x)<32*scale&&y-c.y<40*scale&&y-c.y>-54*scale);}
  canvas.addEventListener('mousemove',e=>{const r=canvas.getBoundingClientRect(),c=hitTest(e.clientX-r.left,e.clientY-r.top);chars.forEach(a=>a.hover=a===c);canvas.style.cursor=c?'pointer':'default';});
  canvas.addEventListener('mouseleave',()=>chars.forEach(c=>c.hover=false));
  canvas.addEventListener('click',e=>{const r=canvas.getBoundingClientRect(),c=hitTest(e.clientX-r.left,e.clientY-r.top);if(c)openChat(c);else closeChat({restoreFocus:false});});
  document.getElementById('chat-close').onclick=()=>closeChat();
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!document.querySelector('dialog[open]'))closeChat();});
  document.addEventListener('click',e=>{if(!activeChar||document.querySelector('dialog[open]')||e.target.closest('#chat,dialog,#game,[data-agent],[data-mission="team"],[data-mission="research"],#motion-toggle'))return;closeChat({restoreFocus:false});});
  inputEl.addEventListener('input',()=>{if(activeChar)session(activeChar).draft=inputEl.value;});
  async function runTurn(c,text){
    if(c.busy)return;if(!(window.BacShowcase?.canRun(c.id)??true)){window.BacShowcase?.settings('tools');return;}
    session(c);c.busy=true;sync();
    history[c.id].push({role:'user',content:text});
    const loading=append(c,'bot typing','응답 중...');emit('activity',{agent:c.name,text:'요청 시작'});
    try{
      const messages=history[c.id].slice(-20);let size=messages.reduce((n,m)=>n+m.content.length,0);while(size>28000&&messages.length>1)size-=messages.shift().content.length;
      const result=await window.DemoAPI.task({agent:c.id,messages});
      if(result.error)throw new Error(result.error);
      history[c.id].push({role:'assistant',content:result.reply});update(loading,result.reply);
      if(result.githubChanged)emit('github-changed',{});
      emit('result',{agent:c.name,text:result.reply});emit('activity',{agent:c.name,text:'응답 완료'});
      c.bubble={text:(result.bubble||result.reply).replace(/\n/g,' ').slice(0,80),until:performance.now()+5000};
    }catch(error){update(loading,error.message,true);history[c.id].pop();emit('activity',{agent:c.name,text:error.message});}
    finally{c.busy=false;sync();}
  }
  async function sendMsg(){
    const c=activeChar,text=inputEl.value.trim();if(!c||!text||c.busy||sendBtn.disabled)return;
    inputEl.value='';session(c).draft='';append(c,'me',text);
    if(c.id==='multiagent')runMultiagent(c,text);else runTurn(c,text);
  }
  document.getElementById('inbar').onsubmit=e=>{e.preventDefault();sendMsg();};
  async function showSystem(c){
    if(c.busy)return;c.busy=true;sync();const node=append(c,'bot typing','시스템 상태 확인 중...');
    try{const info=await window.DemoAPI.request('/api/sysinfo');const gpu=info.gpu;
      const text=(gpu?`GPU: ${gpu.name}\n사용률: ${gpu.utilization_pct}%\n메모리: ${gpu.mem_used_mib} / ${gpu.mem_total_mib} MiB\n온도: ${gpu.temp_c}°C`:'GPU 지표를 사용할 수 없습니다.')+(info.disk?`\n\n디스크: ${info.disk.used} / ${info.disk.size}\n사용률: ${info.disk.use_pct}\n사용 가능: ${info.disk.avail}`:'\n디스크 지표를 사용할 수 없습니다.');
      update(node,text);emit('result',{agent:c.name,text});emit('activity',{agent:c.name,text:'로컬 시스템 지표 확인'});
    }catch(error){update(node,error.message,true);}finally{c.busy=false;sync();}
  }
  async function showPapers(c){
    if(c.paperLoading)return;c.paperLoading=true;sync();const node=append(c,'bot typing','논문 조회 중...');
    try{const data=await window.DemoAPI.request('/bac-arxiv/top3.json');const label=data.source==='live'?'':data.source==='cached'?'저장된 논문 모음\n\n':'참고 논문 모음\n\n';lastPapers=JSON.stringify(data.papers.map(p=>p.link));const text=label+(data.text||'논문이 없습니다.');update(node,text);emit('result',{agent:c.name,text});emit('activity',{agent:c.name,text:data.source==='live'?'arXiv 피드 확인':'논문 모음 확인'});}
    catch(error){update(node,error.message,true);}finally{c.paperLoading=false;sync();}
  }
  const MA_SUGGESTIONS=[{label:'시스템 지표 요약',request:'Build a dependency-free CommonJS function summarizing GPU temperature and disk usage.'},{label:'논문 목록 포맷',request:'Build a dependency-free CommonJS function formatting paper titles and links into Markdown.'},{label:'작업 타이머',request:'Build a dependency-free CommonJS timer module for tracking named tasks.'}];
  function suggestions(c){const block=document.createElement('div');block.className='ma-chips';for(const s of MA_SUGGESTIONS){const b=document.createElement('button');b.className='ma-chip';b.textContent=s.label;b.onclick=()=>{if(c.busy)return;if(!(window.BacShowcase?.canRun(c.id)??false)){window.BacShowcase?.settings('tools');return;}append(c,'me',s.request);runMultiagent(c,s.request);};block.append(b);}session(c).nodes.push(block);if(activeChar===c)msgsEl.append(block);}
  function maCleanup(){maKids=[];maBox=null;maParent=null;}
  async function runMultiagent(c,request,existingJob){
    if(c.busy)return;c.busy=true;sync();maCleanup();maParent=c;
    const a=arena(),distance=Math.min(105,(a.right-a.left)/4);
    const pm={role:'pm',name:'PM',label:'PM',baby:true,color:'#5b8def',x:c.x,y:c.y,tx:a.x-distance,ty:a.y-55,bob:0,dir:1};
    const dev={role:'dev',name:'Dev',label:'Dev',baby:true,color:'#34c98a',x:c.x,y:c.y,tx:a.x+distance,ty:a.y-55,bob:2,dir:-1};maKids=[pm,dev];
    const loading=append(c,'bot typing','협업 작업 진행 중...');let seen=0;
    try{
      const id=existingJob||(await window.DemoAPI.request('/api/team/jobs',{requestId:crypto.randomUUID(),messages:[{role:'user',content:request}]})).jobId;c.teamJobId=id;
      const result=await window.DemoAPI.poll('/api/team/jobs/'+id,{timeout:240000,onUpdate:data=>{
        for(const st of data.stages.slice(seen)){emit('activity',{agent:st.actor||c.name,text:st.text});
          if(st.stage==='pm-start'){pm.active=true;pm.label='PM: 계획';}
          if(st.stage==='pm-done'){pm.active=false;pm.label='PM: 완료';append(c,'bot',st.plan||st.text);}
          if(st.stage==='handoff')maBox={x:pm.x,y:pm.y,tx:dev.x,ty:dev.y,hold:'dev'};
          if(st.stage==='dev-start'){dev.active=true;dev.label='Dev: 구현';}
          if(st.stage==='dev-done'){dev.active=false;dev.label=st.prUrl?'Dev: PR 완료':'Dev: 실패';maBox=null;append(c,'bot',st.text+(st.prUrl?'\n'+st.prUrl:''));if(st.prUrl)emit('result',{agent:c.name,text:st.text+'\n'+st.prUrl});}
          if(st.stage==='error')append(c,'bot error',st.text);
        }seen=data.stages.length;
      }});
      const failed=result.stages.some(s=>s.stage==='error')||!result.stages.some(s=>s.stage==='dev-done'&&s.prUrl);
      update(loading,failed?'협업 작업을 완료하지 못했습니다. 위 실행 기록을 확인하세요.':'협업 작업 완료',failed);c.teamJobId=null;
    }catch(error){update(loading,error.message,true);}
    finally{c.busy=false;sync();setTimeout(()=>{if(maParent===c&&!c.busy)maCleanup();},1800);}
  }
  let arxivCronStarted=false,arxivChecking=false,lastPapers='';
  function startArxivCron(){if(arxivCronStarted)return;arxivCronStarted=true;setInterval(async()=>{if(document.hidden||arxivChecking)return;arxivChecking=true;try{const data=await window.DemoAPI.request('/bac-arxiv/top3.json');const signature=JSON.stringify(data.papers.map(p=>p.link));if(lastPapers&&signature!==lastPapers){const c=chars.find(c=>c.id==='arxiv');c.bubble={text:'논문 목록 변경',until:performance.now()+5000};emit('activity',{agent:c.name,text:'논문 목록 변경'});}lastPapers=signature;}catch{}finally{arxivChecking=false;}},60000);}

  // ---------- Boot ----------
  let loopStarted=false;
  async function boot() {
    buildBackground();
    try {
      const j = await window.DemoAPI.request("/api/agents");
      if (!Array.isArray(j.agents) || !j.agents.length) throw Error();
      AGENTS = j.agents;
      document.getElementById('stage-error').hidden=true;
    } catch {
      document.getElementById('stage-error').hidden=false;
      if(!loopStarted){loopStarted=true;requestAnimationFrame(loop);}
      return;
    }
    buildChars();
    emit("ready", chars);
    if(!loopStarted){loopStarted=true;requestAnimationFrame(loop);}
  }

  function reflow() {
    resize();
    chars.forEach((c,i) => { const h=home(i); c.x=c.tx=h.x; c.y=c.ty=h.y; });
    const a = arena(), offset = Math.min(mobileView() ? 65 : 105,(a.right-a.left)/4);
    for (const k of maKids) { k.tx = a.x + (k.role === "pm" ? -offset : offset); k.ty = a.y - 55; }
    buildBackground();
  }
  // The stage changes size when the panel docks, even without a window resize.
  const stageObserver = new ResizeObserver(reflow);
  stageObserver.observe(canvas);
  stageObserver.observe(document.getElementById("agent-roster"));
  window.addEventListener("resize", () => {
    // Animate docking, but apply viewport changes immediately across breakpoints.
    canvas.style.transition = "none";
    reflow();
    requestAnimationFrame(() => canvas.style.removeProperty("transition"));
  });
  window.BacDemo = {
    getAgents: () => chars, getActive: () => activeChar,
    openAgent(id) { const c=chars.find(a=>a.id===id); if(c && c!==activeChar) openChat(c); },
    runTurn, addMsg, closeChat, sync, refreshSystem:()=>{const c=chars.find(c=>c.id==='sysmon');if(c)showSystem(c);}, refreshPapers:()=>{const c=chars.find(c=>c.id==='arxiv');if(c)showPapers(c);}, resumeTeam(id){const c=chars.find(c=>c.id==='multiagent');if(c&&!c.busy)runMultiagent(c,'',id);},
    motion(value) { motionPaused=value; },
    isPaused: () => motionPaused,
    busy(id,value) { const c=chars.find(a=>a.id===id); if(c)c.busy=value; },
    bubble(id,text) { const c=chars.find(a=>a.id===id); if(c) c.bubble={text,until:performance.now()+6000}; }
  };
  document.getElementById('stage-retry').onclick=boot;
  boot();
})();
