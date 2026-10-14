#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { loadAPIConfig } = require('../app/api-config');
const root = path.resolve(__dirname, '..');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const help = `사용법: ./bac start [--port 8000] [--config api.json] [--no-browser]
        ./bac status [--port 8000]

start   앱 실행, 필요한 패키지 설치 및 로컬 브라우저 준비
status  앱 실행 상태 확인
종료    실행 중인 터미널에서 Ctrl+C

설정 파일 없이 실행할 수 있습니다. 기존 api.json과 .env는 자동으로 읽습니다.
AI는 화면에서 로컬 모델 또는 NVIDIA API 하나만 연결하면 됩니다.
실행 중인 로컬 OpenClaw는 자동 확인하며, GitHub·Telegram·AgentMail은 선택 사항입니다.`;
async function json(url) {
  try { const res = await fetch(url, { signal: AbortSignal.timeout(800), redirect: 'error' }); return res.ok ? await res.json() : null; }
  catch { return null; }
}
function occupied(host, port) {
  return new Promise(resolve => {
    const socket = net.connect({ host, port });
    socket.setTimeout(800);
    const done = result => { socket.destroy(); resolve(result); };
    socket.once('connect', () => done(true)); socket.once('error', () => done(false)); socket.once('timeout', () => done(false));
  });
}
function findBrowser() {
  const candidates = process.env.CHROME_EXECUTABLE ? [process.env.CHROME_EXECUTABLE] : process.platform === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ] : ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'].flatMap(name => (process.env.PATH || '').split(path.delimiter).map(dir => path.join(dir, name)));
  return candidates.find(file => { try { fs.accessSync(file, fs.constants.X_OK); return true; } catch { return false; } });
}
async function main(args = process.argv.slice(2)) {
  const command = args.shift() || 'help';
  if (['help', '--help', '-h'].includes(command)) { console.log(help); return; }
  if (!['start', 'status'].includes(command)) throw Error(help);
  const env = { ...process.env };
  let autoBrowser = true;
  while (args.length) {
    const flag = args.shift();
    if (flag === '--no-browser') autoBrowser = false;
    else if ((flag === '--port' || flag === '--config') && args[0] && !args[0].startsWith('--')) env[flag === '--port' ? 'PORT' : 'BAC_API_CONFIG'] = args.shift();
    else throw Error(help);
  }
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 20 || (major === 20 && minor < 6)) throw Error('Node.js 20.6 이상이 필요합니다.');
  const port = Number(env.PORT || 8000), host = env.HOST || '127.0.0.1';
  if (!/^\d+$/.test(String(env.PORT || 8000)) || !Number.isInteger(port) || port < 1 || port > 65535) throw Error('포트는 1-65535 사이의 숫자로 지정해주세요.');
  const localHost = ['0.0.0.0', '::'].includes(host) ? '127.0.0.1' : host;
  const url = `http://${localHost.includes(':') ? '[' + localHost + ']' : localHost}:${port}`;
  const current = await json(url + '/api/health');
  if (current?.app === 'agentic-ai-demo') { console.log(`이미 실행 중입니다: ${url}`); return; }
  if (command === 'status') { console.log(`앱이 실행 중이지 않습니다: ${url}`); return; }
  if (await occupied(localHost, port)) throw Error(`${port}번 포트를 다른 프로그램이 사용하고 있습니다. ./bac start --port 8001로 실행할 수 있습니다.`);
  loadAPIConfig({ root, env }); // Fail before installing dependencies or spawning processes.
  if (!env.BAC_API_CONFIG && !fs.existsSync(path.join(root, 'api.json'))) {
    try {
      fs.writeFileSync(path.join(root, 'api.json'), fs.readFileSync(path.join(root, 'api.example.json')), { flag: 'wx', mode: 0o600 });
      console.log('연결 정보를 넣을 빈 api.json을 준비했습니다.');
    } catch (error) { if (error.code !== 'EEXIST') throw Error('api.json을 준비하지 못했습니다. 프로젝트 폴더의 쓰기 권한을 확인해주세요.'); }
  }
  try { for (const name of ['json5', 'playwright-core']) require.resolve(name, { paths: [root] }); }
  catch {
    console.log('첫 실행에 필요한 앱 패키지를 설치합니다.');
    await new Promise((resolve, reject) => {
      const installer = spawn('npm', ['ci', '--no-audit', '--no-fund'], { cwd: root, env, stdio: 'inherit' });
      installer.once('error', () => reject(Error('npm을 실행할 수 없습니다. Node.js 설치를 확인해주세요.')));
      installer.once('exit', code => code === 0 ? resolve() : reject(Error('패키지 설치를 완료하지 못했습니다. 네트워크 상태를 확인해주세요.')));
    });
  }
  const owned = new Set(); let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    const children = [...owned];
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    for (let i = 0; i < 20 && children.some(child => child.exitCode === null && child.signalCode === null); i++) await wait(100);
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  };
  const signal = () => { stop().then(() => { process.exitCode = 0; }); };
  process.on('SIGINT', signal); process.on('SIGTERM', signal);
  const instanceId = randomUUID();
  const app = spawn(process.execPath, [path.join(root, 'app/server.js')], { cwd: root, env: { ...env, PORT: String(port), BAC_INSTANCE_ID: instanceId }, stdio: ['ignore', 'inherit', 'inherit'] });
  owned.add(app);
  const appExit = new Promise(resolve => {
    app.once('error', () => resolve(1)); app.once('exit', code => resolve(code ?? 0));
  });
  try {
    let ready = false;
    for (let i = 0; i < 100 && !stopped && app.exitCode === null && app.signalCode === null; i++) {
      if ((await json(url + '/api/health'))?.instanceId === instanceId) { ready = true; break; }
      await wait(150);
    }
    if (stopped) return;
    if (!ready) throw Error('앱을 시작하지 못했습니다. 위의 실행 상태를 확인해주세요.');
    if (autoBrowser) {
      let endpoint;
      try { endpoint = new URL(env.BROWSER_CDP_URL || 'http://127.0.0.1:9222'); }
      catch { throw Error('BROWSER_CDP_URL 주소를 확인해주세요.'); }
      const version = await json(endpoint.href.replace(/\/$/, '') + '/json/version');
      if (version?.webSocketDebuggerUrl) console.log('실행 중인 브라우저에 연결했습니다.');
      else if (endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(endpoint.hostname) && endpoint.pathname === '/' && !endpoint.username && !endpoint.password) {
        const executable = findBrowser(), cdpPort = Number(endpoint.port || 80);
        if (!executable) console.log('브라우저 탐색은 Chrome 또는 Chromium 설치 후 사용할 수 있습니다.');
        else if (await occupied(endpoint.hostname, cdpPort)) console.log('브라우저 포트가 사용 중입니다. 연결 설정에서 도구 상태를 확인해주세요.');
        else {
          const profile = path.join(root, '.bac', 'browser-profile'); fs.mkdirSync(profile, { recursive: true, mode: 0o700 });
          const browser = spawn(executable, ['--headless=new', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
          owned.add(browser); browser.on('error', () => {});
          let connected = false;
          for (let i = 0; i < 35 && !stopped && browser.exitCode === null && browser.signalCode === null; i++) {
            if ((await json(endpoint.href + 'json/version'))?.webSocketDebuggerUrl) { connected = true; break; }
            await wait(150);
          }
          if (!stopped) console.log(connected ? '브라우저 탐색이 준비되었습니다.' : '브라우저를 시작하지 못했습니다. 앱 화면은 계속 사용할 수 있습니다.');
        }
      } else console.log('설정한 브라우저 서비스의 연결을 확인해주세요.');
    }
    if (stopped) return;
    console.log(`\n앱 주소: ${url}\n종료하려면 Ctrl+C를 누르세요.`);
    process.exitCode = await appExit;
  } finally { await stop(); process.removeListener('SIGINT', signal); process.removeListener('SIGTERM', signal); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main, findBrowser };
