'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { loadGitHubCredential, validateGitHub } = require('./github-connection');

class ConfigError extends Error {}
const fields = {
  github: ['token', 'owner', 'repo'],
  telegram: ['botToken', 'chatId'],
  agentmail: ['apiKey', 'inboxId'],
};
function loadAPIConfig({ root = path.resolve(__dirname, '..'), env = process.env } = {}) {
  const file = env.BAC_API_CONFIG ? path.resolve(root, env.BAC_API_CONFIG) : path.join(root, 'api.json');
  let raw;
  try {
    if (fs.statSync(file).size > 40000) throw new ConfigError('api.json이 너무 큽니다.');
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT' && !env.BAC_API_CONFIG) return {};
    if (error instanceof ConfigError) throw error;
    throw new ConfigError('api.json을 읽을 수 없습니다. 파일 위치와 권한을 확인해주세요.');
  }
  let data;
  try { data = JSON.parse(raw); } catch { throw new ConfigError('api.json의 JSON 형식을 확인해주세요.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(k => !Object.hasOwn(fields, k)))
    throw new ConfigError('api.json에는 github, telegram, agentmail 설정만 넣어주세요.');
  const config = {};
  for (const [provider, keys] of Object.entries(fields)) {
    if (data[provider] === undefined) continue;
    const value = data[provider];
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k)))
      throw new ConfigError(`api.json의 ${provider} 설정 항목을 확인해주세요.`);
    config[provider] = {};
    for (const key of keys) {
      let v = value[key] ?? '';
      if (provider === 'telegram' && key === 'chatId' && Number.isSafeInteger(v)) v = String(v);
      if (typeof v !== 'string' || v.length > 512 || /[\x00-\x1f\x7f]/.test(v))
        throw new ConfigError(`api.json의 ${provider}.${key} 값을 확인해주세요.`);
      config[provider][key] = v.trim();
    }
  }
  const g = config.github || {}, t = config.telegram || {}, m = config.agentmail || {};
  try {
    validateGitHub({ token: g.token || 'validation-placeholder', owner: g.token?(g.owner||(g.repo?'':'account')):g.owner || env.GH_OWNER || 'bacdemokr', repo: g.token?(g.repo||'connection'):g.repo || env.GH_REPO || 'bac-demo' });
  } catch { throw new ConfigError('api.json의 GitHub 토큰 또는 저장소 이름을 확인해주세요.'); }
  if (t.botToken && (!/^\d{5,15}:[A-Za-z0-9_-]{20,100}$/.test(t.botToken) || !/^-?\d{1,20}$/.test(t.chatId)))
    throw new ConfigError('api.json의 Telegram botToken과 chatId를 함께 확인해주세요.');
  if (m.apiKey && (!m.inboxId || m.inboxId.length > 254 || /[\s/\\?#]/.test(m.inboxId)))
    throw new ConfigError('api.json의 AgentMail apiKey와 inboxId를 함께 확인해주세요.');
  return config;
}
function loadConnections({ root = path.resolve(__dirname, '..'), env = process.env } = {}) {
  const config = loadAPIConfig({ root, env });
  const g = config.github || {}, t = config.telegram || {}, m = config.agentmail || {};
  const read = file => { try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; } };
  const telegramToken = env.TG_BOT_TOKEN || read(path.join(root, 'app', '.tg_token'));
  return {
    github: { ...(g.token ? { token: g.token, source: 'config' } : loadGitHubCredential({ appDir: path.join(root, 'app'), env })), owner: g.token?g.owner||'':g.owner || env.GH_OWNER || '', repo: g.token?g.repo||'':g.repo || env.GH_REPO || '' },
    telegram: t.botToken ? { token: t.botToken, chatId: t.chatId, source: 'config' } : { token: telegramToken, chatId: env.TG_CHAT_ID || t.chatId || '', source: telegramToken ? (env.TG_BOT_TOKEN ? 'environment' : 'file') : 'none' },
    agentmail: m.apiKey ? { apiKey: m.apiKey, inboxId: m.inboxId, source: 'config' } : { apiKey: env.AGENTMAIL_API_KEY || '', inboxId: env.AGENTMAIL_INBOX_ID || m.inboxId || '', source: env.AGENTMAIL_API_KEY ? 'environment' : 'none' },
  };
}
module.exports = { loadAPIConfig, loadConnections, ConfigError };
