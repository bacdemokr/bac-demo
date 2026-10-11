'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { loadAPIConfig, loadConnections } = require('../app/api-config');
function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bac-api-'));
  fs.mkdirSync(path.join(root, 'app')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root;
}
test('one JSON file selects all providers over legacy credentials and does not change the file', t => {
  const root = temporary(t), config = { github: { token: 'json-gh-secret', owner: 'json-owner', repo: 'json-repo' }, telegram: { botToken: '123456789:' + 'x'.repeat(30), chatId: '-12345' }, agentmail: { apiKey: 'json-mail-secret', inboxId: 'json@agentmail.to' } };
  const file = path.join(root, 'api.json'), raw = JSON.stringify(config);
  fs.writeFileSync(file, raw); fs.writeFileSync(path.join(root, 'app/.gh_token'), 'old-gh-secret'); fs.writeFileSync(path.join(root, 'app/.tg_token'), 'old-tg-secret');
  const c = loadConnections({ root, env: { GH_OWNER: 'old-owner', GH_REPO: 'old-repo', GITHUB_TOKEN: 'old-env-secret', TG_BOT_TOKEN: 'old-env-bot', TG_CHAT_ID: '999', AGENTMAIL_API_KEY: 'old-env-mail', AGENTMAIL_INBOX_ID: 'old@agentmail.to' } });
  assert.equal(c.github.token, config.github.token); assert.equal(c.github.owner, 'json-owner'); assert.equal(c.github.repo, 'json-repo');
  assert.equal(c.telegram.token, config.telegram.botToken); assert.equal(c.telegram.chatId, '-12345'); assert.equal(c.agentmail.apiKey, config.agentmail.apiKey);
  assert(Object.values(c).every(p => p.source === 'config')); assert.equal(fs.readFileSync(file, 'utf8'), raw);
});
test('blank, omitted and missing JSON providers retain existing file and environment setup', t => {
  const root = temporary(t), env = { GH_OWNER: 'env-owner', GH_REPO: 'env-repo', GITHUB_TOKEN: 'env-secret', TG_BOT_TOKEN: 'env-bot', TG_CHAT_ID: '12345', AGENTMAIL_API_KEY: 'env-mail', AGENTMAIL_INBOX_ID: 'env@agentmail.to' };
  assert.deepEqual(loadAPIConfig({ root, env }), {});
  fs.writeFileSync(path.join(root, 'api.json'), JSON.stringify({ github: { token: '' }, telegram: { botToken: '' }, agentmail: { apiKey: '' } }));
  fs.writeFileSync(path.join(root, 'app/.gh_token'), 'file-secret');
  const c = loadConnections({ root, env }); assert.equal(c.github.token, 'file-secret'); assert.equal(c.github.source, 'file'); assert.equal(c.github.owner, 'env-owner');
  assert.equal(c.telegram.token, 'env-bot'); assert.equal(c.telegram.chatId, '12345'); assert.equal(c.agentmail.apiKey, 'env-mail');
});
test('custom configuration paths and numeric safe Chat IDs work; explicitly missing files fail', t => {
  const root = temporary(t), file = path.join(root, 'custom.json'); fs.writeFileSync(file, JSON.stringify({ telegram: { botToken: '123456789:' + 'x'.repeat(30), chatId: -12345 } }));
  assert.equal(loadAPIConfig({ root, env: { BAC_API_CONFIG: 'custom.json' } }).telegram.chatId, '-12345');
  assert.throws(() => loadAPIConfig({ root, env: { BAC_API_CONFIG: 'missing.json' } }), /읽을 수 없습니다/);
});
test('bad JSON, typos, unsafe values and incomplete providers fail without quoting secrets', t => {
  const root = temporary(t), file = path.join(root, 'api.json'), secret = 'sensitive-do-not-print';
  const samples = [secret + '{', null, [], { unknown: secret }, { github: { unknown: secret } }, { github: { token: secret + '\nheader', owner: 'owner', repo: 'repo' } }, { github: { token: secret, owner: '../owner' } }, { telegram: { botToken: secret, chatId: 'not-numeric' } }, { agentmail: { apiKey: secret } }, { agentmail: { apiKey: secret, inboxId: 'unsafe/path' } }];
  for (const sample of samples) {
    fs.writeFileSync(file, typeof sample === 'string' ? sample : JSON.stringify(sample));
    assert.throws(() => loadAPIConfig({ root, env: {} }), error => !error.message.includes(secret));
  }
});
