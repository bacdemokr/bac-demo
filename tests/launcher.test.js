'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..'), wait = ms => new Promise(r => setTimeout(r, ms));
async function freePort() { const s = http.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
function launch(cwd, args, env) {
  const child = spawn(path.join(cwd, 'bac'), args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
  return { child, logs: () => logs, done: new Promise(r => child.once('exit', (code, signal) => r({ code, signal }))) };
}
test('launcher loads .env and all JSON providers, installs missing dependencies, reuses an app, and stops only its app', { timeout: 30000 }, async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'bac-launch-')), calls = [], token = 'json-gh-private', botToken = '123456789:' + 'x'.repeat(30), mailKey = 'json-mail-private';
  const provider = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk; calls.push({ path: req.url, method: req.method, auth: req.headers.authorization });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/user') return res.end(JSON.stringify({ login: 'fixture-user' }));
    if (req.url === '/repos/json-owner/json-repo') return res.end(JSON.stringify({ name: 'json-repo', owner: { login: 'json-owner' }, default_branch: 'main', permissions: { push: true } }));
    if (req.url.endsWith('/getMe')) return res.end(JSON.stringify({ ok: true, result: { is_bot: true, username: 'json_bot' } }));
    if (req.url.endsWith('/getChat')) return res.end(JSON.stringify({ ok: true, result: { id: 12345 } }));
    if (req.url.endsWith('/getUpdates')) return res.end(JSON.stringify({ ok: true, result: [] }));
    if (req.url.startsWith('/v0/inboxes/')) return res.end(JSON.stringify({ inbox_id: 'json@agentmail.to' }));
    res.writeHead(404); res.end('{}');
  });
  await new Promise(r => provider.listen(0, '127.0.0.1', r));
  let running;
  try {
    for (const name of ['app', 'scripts']) await fs.cp(path.join(root, name), path.join(temporary, name), { recursive: true, filter: file => !path.basename(file).startsWith('.') });
    for (const name of ['bac', 'package.json', 'package-lock.json', 'api.example.json']) await fs.copyFile(path.join(root, name), path.join(temporary, name));
    await fs.chmod(path.join(temporary, 'bac'), 0o755);
    // Simulate npm ci offline; the startup path must install rather than skip missing dependencies.
    const bin = path.join(temporary, 'bin'); await fs.mkdir(bin);
    await fs.writeFile(path.join(bin, 'npm'), '#!' + process.execPath + '\n' + `const fs=require('node:fs'),path=require('node:path');if(process.argv.slice(2).join(' ')!=='ci --no-audit --no-fund')process.exit(1);fs.mkdirSync('node_modules');for(const name of ['json5','playwright-core'])fs.symlinkSync(path.join(process.env.NPM_FIXTURE_SOURCE,'node_modules',name),path.join('node_modules',name),'dir');fs.writeFileSync('install-marker','installed');\n`, { mode: 0o755 });
    const port = await freePort(), base = 'http://127.0.0.1:' + port;
    await fs.writeFile(path.join(temporary, '.env'), `PORT=${port}\nGATEWAY_URL=http://127.0.0.1:1\nGATEWAY_TOKEN=\n`);
    const file = path.join(temporary, 'api.json'), raw = JSON.stringify({ github: { token, owner: 'json-owner', repo: 'json-repo' }, telegram: { botToken, chatId: '12345' }, agentmail: { apiKey: mailKey, inboxId: 'json@agentmail.to' } }); await fs.writeFile(file, raw, { mode: 0o600 });
    const env = { PORT: '', HOST: '127.0.0.1', BAC_API_CONFIG: '', GATEWAY_URL: '', GATEWAY_TOKEN: '', OPENCLAW_CONFIG_PATH: '', PATH: bin + path.delimiter + process.env.PATH, NPM_FIXTURE_SOURCE: root, NODE_OPTIONS: '--require=' + path.join(root, 'tests/api-fetch-fixture.cjs'), API_FIXTURE_URL: 'http://127.0.0.1:' + provider.address().port };
    // Empty PORT from the environment would override .env, so remove it for this test.
    delete env.PORT;
    const savedPort = process.env.PORT; delete process.env.PORT;
    try { running = launch(temporary, ['start', '--no-browser'], env); } finally { if (savedPort !== undefined) process.env.PORT = savedPort; }
    let status;
    for (let i = 0; i < 150; i++) {
      if (running.child.exitCode !== null) throw Error(running.logs());
      try { status = await (await fetch(base + '/api/showcase/status')).json(); if (status.github?.connected && status.telegram?.connected && status.agentmail?.connected) break; } catch {}
      await wait(50);
    }
    assert(status.github.connected && status.telegram.connected && status.agentmail.connected, running.logs());
    assert.equal(status.team.repository, 'json-owner/json-repo'); assert(['github', 'telegram', 'agentmail'].every(name => status[name].source === 'config'));
    const publicBody = JSON.stringify(status); for (const secret of [token, botToken, mailKey]) { assert(!publicBody.includes(secret)); assert(!running.logs().includes(secret)); }
    assert.equal(await fs.readFile(path.join(temporary, 'install-marker'), 'utf8'), 'installed');
    assert(!calls.some(c => c.path.includes('send') || (c.method !== 'GET' && !c.path.startsWith('/bot'))));
    assert(calls.find(c => c.path === '/user').auth === 'Bearer ' + token);
    // The separately registered MCP launcher can read the same JSON token, without a second token file.
    await fs.writeFile(path.join(bin, 'docker'), '#!' + process.execPath + '\n' + `require('node:fs').writeFileSync('docker-marker',JSON.stringify({args:process.argv.slice(2),token:process.env.GITHUB_PERSONAL_ACCESS_TOKEN}));\n`, { mode: 0o755 });
    const mcp = spawn('bash', [path.join(temporary, 'scripts/github-mcp.sh')], { cwd: temporary, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let mcpLogs = ''; mcp.stdout.on('data', d => mcpLogs += d); mcp.stderr.on('data', d => mcpLogs += d);
    assert.equal(await new Promise(r => mcp.once('exit', r)), 0);
    const docker = JSON.parse(await fs.readFile(path.join(temporary, 'docker-marker'), 'utf8')); assert.equal(docker.token, token); assert(!mcpLogs.includes(token));
    assert.deepEqual(docker.args, ['run', '-i', '--rm', '-e', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'ghcr.io/github/github-mcp-server:latest']);
    for (const command of ['status', 'start']) { const again = launch(temporary, [command, '--port', String(port), '--no-browser'], env); assert.equal((await again.done).code, 0); assert(again.logs().includes('이미 실행 중')); }
    await fetch(base + '/api/integrations/telegram', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ disconnect: true }) });
    await fetch(base + '/api/integrations/agentmail', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ disconnect: true }) });
    assert.equal(await fs.readFile(file, 'utf8'), raw);
    const stopper=launch(temporary,['stop','--port',String(port)],env);assert.equal((await stopper.done).code,0,stopper.logs());assert(stopper.logs().includes('종료했습니다'));assert.equal((await running.done).code,0);await assert.rejects(fetch(base+'/api/health'));
    await assert.rejects(fs.stat(path.join(temporary,'.bac',`launcher-${port}.json`)));
    const againStop=launch(temporary,['stop','--port',String(port)],env);assert.equal((await againStop.done).code,0);assert(againStop.logs().includes('실행 중이지'));
    // The unrelated fixture service must stay alive.
    assert.equal((await fetch('http://127.0.0.1:' + provider.address().port + '/user')).status, 200);
    // A new checkout starts with no credential file; it should create a private blank template.
    await fs.unlink(file);
    await fs.unlink(path.join(temporary, '.env'));
    const bareEnv={...env,GATEWAY_URL:'http://127.0.0.1:1',OPENCLAW_CONFIG_PATH:path.join(temporary,'no-openclaw.json'),OPENCLAW_STATE_DIR:'',GITHUB_TOKEN:'',TG_BOT_TOKEN:'',TG_CHAT_ID:'',AGENTMAIL_API_KEY:'',AGENTMAIL_INBOX_ID:''};
    running = launch(temporary, ['start', '--port', String(port), '--no-browser'], bareEnv);
    for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await wait(50);}
    const blank=JSON.parse(await fs.readFile(file,'utf8'));assert.equal(blank.github.token,'');assert.equal(blank.telegram.botToken,'');assert.equal(blank.agentmail.apiKey,'');assert.equal((await fs.stat(file)).mode&0o777,0o600);
    const bareStatus=await(await fetch(base+'/api/showcase/status')).json();
    assert.equal(bareStatus.ai.configured,false);assert.equal(bareStatus.github.connected,false);assert.equal(bareStatus.telegram.connected,false);assert.equal(bareStatus.agentmail.connected,false);
    assert.equal((await fetch(base+'/')).status,200);assert.equal((await fetch(base+'/api/sysinfo')).status,200);
    const chat=await fetch(base+'/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({agent:'sysmon',messages:[{role:'user',content:'상태 요약해줘'}]})});assert.equal(chat.status,409);
    assert(!running.logs().includes('MISSING'));assert(running.logs().includes('연결 하나'));
    running.child.kill('SIGTERM');assert.equal((await running.done).code,0);
  } finally {
    if (running && running.child.exitCode === null) { running.child.kill('SIGTERM'); await running.done; }
    provider.closeAllConnections(); await new Promise(r => provider.close(r)); await fs.rm(temporary, { recursive: true, force: true });
  }
});
test('launcher refuses unrelated occupied ports and malformed config without printing credentials', { timeout: 10000 }, async () => {
  const server = http.createServer((req, res) => { res.writeHead(404); res.end('{}'); }); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'bac-invalid-'));
  try {
    const busy = launch(root, ['start', '--port', String(server.address().port), '--no-browser'], {}); assert.equal((await busy.done).code, 1); assert(busy.logs().includes('다른 프로그램'));
    const file = path.join(temporary, 'bad.json'); await fs.writeFile(file, 'private-do-not-print{');
    const invalid = launch(root, ['start', '--port', String(await freePort()), '--config', file, '--no-browser'], {}); assert.equal((await invalid.done).code, 1); assert(invalid.logs().includes('JSON 형식')); assert(!invalid.logs().includes('private-do-not-print'));
    assert.equal((await fetch('http://127.0.0.1:' + server.address().port)).status, 404);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); await fs.rm(temporary, { recursive: true, force: true }); }
});
test('stop closes owned browser ports, preserves reused services, and rejects stale ownership and unauthenticated requests', {timeout:30000}, async()=>{
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'bac-stop-'));let running;
 const external=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({webSocketDebuggerUrl:'ws://127.0.0.1/external'}));});
 await new Promise(r=>external.listen(0,'127.0.0.1',r));
 try{
  for(const name of ['app','scripts'])await fs.cp(path.join(root,name),path.join(temporary,name),{recursive:true,filter:file=>!path.basename(file).startsWith('.')});
  for(const name of ['bac','api.example.json'])await fs.copyFile(path.join(root,name),path.join(temporary,name));
  await fs.chmod(path.join(temporary,'bac'),0o755);await fs.symlink(path.join(root,'node_modules'),path.join(temporary,'node_modules'),'dir');
  const browser=path.join(temporary,'fixture-chrome');
  await fs.writeFile(browser,'#!'+process.execPath+'\n'+`const http=require('node:http');const port=Number(process.argv.find(a=>a.startsWith('--remote-debugging-port=')).split('=')[1]);http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({webSocketDebuggerUrl:'ws://127.0.0.1/owned'}));}).listen(port,'127.0.0.1');\n`,{mode:0o755});
  const port=await freePort(),cdpPort=await freePort(),base='http://127.0.0.1:'+port;
  const env={HOST:'127.0.0.1',BAC_API_CONFIG:'',OPENCLAW_CONFIG_PATH:path.join(temporary,'missing-openclaw.json'),OPENCLAW_STATE_DIR:'',GATEWAY_URL:'http://127.0.0.1:1',GATEWAY_TOKEN:'',GITHUB_TOKEN:'',TG_BOT_TOKEN:'',TG_CHAT_ID:'',AGENTMAIL_API_KEY:'',AGENTMAIL_INBOX_ID:'',CHROME_EXECUTABLE:browser,BROWSER_CDP_URL:'http://127.0.0.1:'+cdpPort};
  const waitReady=async()=>{for(let i=0;i<150;i++){if(running.child.exitCode!==null)throw Error(running.logs());if(running.logs().includes('앱 주소:'))return;await wait(50);}throw Error(running.logs());};
  running=launch(temporary,['start','--port',String(port)],env);await waitReady();
  const record=path.join(temporary,'.bac',`launcher-${port}.json`),state=JSON.parse(await fs.readFile(record,'utf8'));assert.equal((await fs.stat(record)).mode&0o777,0o600);
  assert.equal((await fetch(`http://127.0.0.1:${state.controlPort}/stop`,{method:'POST'})).status,403);assert.equal((await fetch(base+'/api/health')).status,200);
  await fs.writeFile(record,JSON.stringify({...state,instanceId:'stale-instance'}));
  const stale=launch(temporary,['stop','--port',String(port)],env);assert.equal((await stale.done).code,1);assert.equal((await fetch(base+'/api/health')).status,200);
  await fs.writeFile(record,JSON.stringify(state));
  const stopped=launch(temporary,['stop','--port',String(port)],env);assert.equal((await stopped.done).code,0,stopped.logs());assert.equal((await running.done).code,0);
  await assert.rejects(fetch(base+'/api/health'));await assert.rejects(fetch(`http://127.0.0.1:${cdpPort}/json/version`));await assert.rejects(fetch(`http://127.0.0.1:${state.controlPort}/stop`));
  env.BROWSER_CDP_URL='http://127.0.0.1:'+external.address().port;
  running=launch(temporary,['start','--port',String(port)],env);await waitReady();assert(running.logs().includes('실행 중인 브라우저'));
  // A broken credentials file must never prevent stopping an already running app.
  await fs.writeFile(path.join(temporary,'api.json'),'invalid-private-value{');
  const reused=launch(temporary,['stop','--port',String(port)],env);assert.equal((await reused.done).code,0,reused.logs());await running.done;assert.equal((await fetch(env.BROWSER_CDP_URL+'/json/version')).status,200);
  const unrelated=launch(temporary,['stop','--port',String(external.address().port)],env);assert.equal((await unrelated.done).code,1);assert.equal((await fetch(env.BROWSER_CDP_URL)).status,200);
 }finally{
  if(running&&running.child.exitCode===null){running.child.kill('SIGTERM');await running.done;}
  external.closeAllConnections();await new Promise(r=>external.close(r));await fs.rm(temporary,{recursive:true,force:true});
 }
});
