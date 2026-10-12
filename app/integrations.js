"use strict";

class Problem extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

// Fixed providers, no redirects, and no upstream bodies or token URLs in errors.
async function providerRequest(fetcher, url, options, provider) {
  let response;
  try { response = await fetcher(url, { redirect: "error", signal: AbortSignal.timeout(12000), ...options }); }
  catch { throw new Problem(`${provider}에 연결할 수 없습니다. 네트워크와 연결 설정을 확인해주세요.`, 502); }
  if (/text\/html/i.test(response.headers?.get?.('content-type') || '')) {
    let html='';try { html=await response.text(); } catch {}
    const blocked=body=>/<title[^>]*>\s*Website Filtered\s*<\/title>/i.test(body);
    let filtered=blocked(html);
    // Some filters return a generic POST 404 but a named block page for GET.
    // Probe the same API origin without credentials; never retry a message send.
    if(!filtered&&provider==='Telegram')try{
      const probe=await fetcher('https://api.telegram.org/',{redirect:'error',signal:AbortSignal.timeout(2000)});
      filtered=blocked(await probe.text());
    }catch{}
    if (filtered) throw new Problem(`${provider} API 접근이 현재 네트워크의 웹 필터에서 차단되었습니다. 허용된 네트워크에서 다시 연결해주세요.`, 502);
    throw new Problem(`${provider}에서 올바른 응답을 받지 못했습니다.`, 502);
  }
  let data;
  try { data = await response.json(); } catch { throw new Problem(`${provider}에서 올바른 응답을 받지 못했습니다.`, 502); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Problem(`${provider}에서 올바른 응답을 받지 못했습니다.`, 502);
  if (!response.ok || data.ok === false) {
    const status = data.error_code || response.status;
    const detail = status === 401 ? "인증 정보를 확인해주세요."
      : status === 403 ? "이 계정 또는 봇의 접근 권한을 확인해주세요."
      : status === 404 ? "Inbox ID 또는 봇 정보를 확인해주세요."
      : status === 429 ? "요청이 많습니다. 잠시 후 다시 시도해주세요."
      : "Chat ID 또는 요청 내용을 확인해주세요.";
    throw new Problem(`${provider} 요청 실패 (${status}). ${detail}`, 502);
  }
  return data;
}

class TelegramBridge {
  constructor({ token = "", chatId = "", source = 'environment', fetcher = fetch } = {}) {
    this.fetcher = fetcher;
    this.connection = token ? { token, chatId: String(chatId), source, bot: "", verified: false } : null;
    this.revision = 0; this.attempt = 0; this.inbox = []; this.seq = 0; this.offset = 0;
    this.controller = null; this.timer = null; this.error = "";
  }
  public() {
    const c = this.connection;
    return { configured: !!c, connected: !!c?.verified, source:c?.source||'none', bot: c?.bot || "", chatId: c?.chatId || "", error: this.error };
  }
  async request(c, method, payload = {}, signal) {
    const data = await providerRequest(this.fetcher, `https://api.telegram.org/bot${c.token}/${method}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      ...(signal ? { signal } : {}),
    }, "Telegram");
    if (data.ok !== true || data.result === undefined) throw new Problem("Telegram 응답을 확인할 수 없습니다.", 502);
    return data.result;
  }
  async configure({ token, chatId, disconnect }) {
    // Invalidate even an in-flight verification when a newer change arrives.
    const attempt = ++this.attempt;
    if (disconnect === true) { ++this.revision; this.stop(); this.connection = null; this.inbox = []; this.error = ""; return this.public(); }
    if (typeof token !== "string" || !/^\d{5,15}:[A-Za-z0-9_-]{20,100}$/.test(token.trim())) throw new Problem("BotFather에서 받은 Bot token 전체를 입력해주세요.");
    if (!/^-?\d{1,20}$/.test(String(chatId || "").trim())) throw new Problem("숫자로 된 Chat ID를 입력해주세요.");
    const c = { token: token.trim(), chatId: String(chatId).trim(), source:'runtime', verified: true };
    const bot = await this.request(c, "getMe");
    if (!bot.is_bot || !bot.username) throw new Problem("Telegram 봇 정보를 확인할 수 없습니다.", 502);
    const chat = await this.request(c, "getChat", { chat_id: c.chatId });
    if (String(chat.id) !== c.chatId) throw new Problem("Telegram Chat ID를 확인할 수 없습니다.", 502);
    if (attempt !== this.attempt) throw new Problem("연결 설정이 변경되었습니다. 다시 확인해주세요.", 409);
    ++this.revision; this.stop(); this.connection = { ...c, bot: bot.username }; this.inbox = []; this.offset = 0; this.error = "";
    this.poll(true); return this.public();
  }
  async start() {
    const c = this.connection, revision = this.revision;
    if (!c) return;
    try {
      const bot = await this.request(c, "getMe");
      if (this.connection !== c || revision !== this.revision) return;
      if (!bot.is_bot || !bot.username) throw new Problem("Telegram 봇 정보를 확인할 수 없습니다.", 502);
      if (!/^-?\d{1,20}$/.test(c.chatId)) throw new Problem("Telegram Chat ID를 설정해주세요.", 409);
      const chat = await this.request(c, "getChat", {chat_id:c.chatId});
      if (this.connection !== c || revision !== this.revision) return;
      if (String(chat.id) !== c.chatId) throw new Problem("Telegram Chat ID를 확인할 수 없습니다.", 502);
      c.bot = bot.username; c.verified = true; this.poll(true);
    } catch (error) { if (this.connection === c) this.error = error.message; }
  }
  stop() { clearTimeout(this.timer); this.controller?.abort(); this.controller = null; }
  async poll(initial = false) {
    const c = this.connection, revision = this.revision;
    if (!c?.verified) return;
    const controller = new AbortController(); this.controller = controller;
    let delay = 300;
    try {
      const updates = await this.request(c, "getUpdates", { offset: initial ? -1 : this.offset, timeout: initial ? 0 : 25 }, AbortSignal.any([controller.signal, AbortSignal.timeout(35000)]));
      if (!Array.isArray(updates)) throw new Problem("Telegram 수신 응답이 올바르지 않습니다.", 502);
      if (this.connection !== c || revision !== this.revision) return;
      this.error = "";
      for (const update of updates) {
        this.offset = Math.max(this.offset, update.update_id + 1);
        const message = update.message;
        // Only the explicitly selected destination can inject messages into this UI.
        if (initial || !message?.text || String(message.chat?.id) !== c.chatId) continue;
        this.inbox.push({ id: ++this.seq, from: message.from?.first_name || "Telegram", text: message.text, t: Date.now() });
        if (this.inbox.length > 200) this.inbox.shift();
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (this.connection === c) this.error = error.message;
      delay = 4000;
    } finally {
      if (this.connection === c && revision === this.revision && !controller.signal.aborted) {
        this.timer = setTimeout(() => this.poll(), delay); this.timer.unref();
      }
    }
  }
  async send(text) {
    const c = this.connection;
    if (!c?.verified || !c.chatId) throw new Problem("설정에서 Telegram Bot token과 Chat ID를 연결해주세요.", 409);
    if (typeof text !== "string" || !text.trim() || text.length > 4000) throw new Problem("메시지는 1-4000자로 입력해주세요.");
    const result = await this.request(c, "sendMessage", { chat_id: c.chatId, text, link_preview_options: { is_disabled: true } });
    return { ok: true, messageId: result.message_id };
  }
  receive(since) { return { messages: this.inbox.filter(m => m.id > since), lastId: this.seq }; }
}

class AgentMailBridge {
  constructor({ apiKey = "", inboxId = "", source = 'environment', fetcher = fetch } = {}) {
    this.fetcher = fetcher; this.revision = 0;
    this.connection = apiKey && inboxId ? { apiKey, inboxId, source, verified: false } : null;
    this.error = "";
  }
  public() { return { configured: !!this.connection, connected: !!this.connection?.verified, source:this.connection?.source||'none', inboxId: this.connection?.inboxId || "", error: this.error }; }
  async request(c, suffix = "", payload) {
    return providerRequest(this.fetcher, `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(c.inboxId)}${suffix}`, {
      method: payload ? "POST" : "GET", headers: { Authorization: `Bearer ${c.apiKey}`, "Content-Type": "application/json" },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    }, "AgentMail");
  }
  async configure({ apiKey, inboxId, disconnect }) {
    const revision = ++this.revision;
    if (disconnect === true) { this.connection = null; this.error = ""; return this.public(); }
    if (typeof apiKey !== "string" || !apiKey.trim() || apiKey.length > 512 || /[\r\n]/.test(apiKey)) throw new Problem("AgentMail API key를 입력해주세요.");
    if (typeof inboxId !== "string" || !inboxId.trim() || inboxId.length > 254 || /[\s/\\?#]/.test(inboxId)) throw new Problem("기존 AgentMail Inbox ID를 입력해주세요.");
    const c = { apiKey: apiKey.trim(), inboxId: inboxId.trim(), source:'runtime', verified: true };
    const result = await this.request(c);
    if (!result.inbox_id) throw new Problem("AgentMail 받은편지함 정보를 확인할 수 없습니다.", 502);
    if (revision !== this.revision) throw new Problem("연결 설정이 변경되었습니다.", 409);
    this.connection = c; this.error = ""; return this.public();
  }
  async start() {
    const c = this.connection, revision = this.revision;
    if (!c) return;
    try {
      const result = await this.request(c);
      if (this.connection === c && revision === this.revision) {
        if (!result.inbox_id) throw new Problem("AgentMail 받은편지함 정보를 확인할 수 없습니다.", 502);
        c.verified = true;
      }
    } catch (error) { if (this.connection === c) this.error = error.message; }
  }
  requireConnection() {
    if (!this.connection?.verified) throw new Problem("설정에서 AgentMail API key와 Inbox ID를 연결해주세요.", 409);
    return this.connection;
  }
  async messages() {
    const data = await this.request(this.requireConnection(), "/messages?limit=12");
    if (!Array.isArray(data.messages)) throw new Problem("AgentMail 메시지 목록을 확인할 수 없습니다.", 502);
    return { messages: data.messages.map(m => ({ id: m.message_id, from: m.from, subject: m.subject || "(제목 없음)", preview: m.preview || "", at: m.timestamp })) };
  }
  async send({ to, subject, text }) {
    const c = this.requireConnection();
    if (typeof to !== "string" || to.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to)) throw new Problem("받는 사람의 이메일 주소를 입력해주세요.");
    if (typeof subject !== "string" || !subject.trim() || subject.length > 200 || /[\r\n]/.test(subject)) throw new Problem("제목은 1-200자로 입력해주세요.");
    if (typeof text !== "string" || !text.trim() || text.length > 20000) throw new Problem("메일 본문은 1-20000자로 입력해주세요.");
    // No retry: an uncertain delivery must never create an automatic duplicate.
    const result = await this.request(c, "/messages/send", { to: [to], subject, text });
    if (!result.message_id) throw new Problem("메일 발송 결과를 확인할 수 없습니다. 받은편지함에서 확인해주세요.", 502);
    return { ok: true, messageId: result.message_id, threadId: result.thread_id };
  }
}

module.exports = { Problem, TelegramBridge, AgentMailBridge };
