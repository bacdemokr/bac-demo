'use strict';
const { spawn } = require('node:child_process');
const { loadConnections } = require('../app/api-config');
let token;
try {
  token = loadConnections().github.token;
  if (!token) throw Error('GitHub 토큰을 api.json 또는 app/.gh_token에 설정해주세요.');
} catch (error) { console.error(error.message); process.exit(1); }
const child = spawn('docker', ['run', '-i', '--rm', '-e', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'ghcr.io/github/github-mcp-server:latest'], { stdio: 'inherit', env: { ...process.env, GITHUB_PERSONAL_ACCESS_TOKEN: token } });
child.on('error', () => { console.error('Docker를 실행할 수 없습니다. Docker 설치와 실행 상태를 확인해주세요.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
