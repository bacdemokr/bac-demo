'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {Problem}=require('./integrations');

function loadGitHubCredential({appDir=__dirname,env=process.env,legacyFile='/tmp/gh_token.txt'}={}){
  const read=file=>{try{return fs.readFileSync(file,'utf8').trim();}catch{return '';}};
  const file=read(path.join(appDir,'.gh_token'));
  if(file)return {token:file,source:'file'};
  if(env.GITHUB_TOKEN)return {token:env.GITHUB_TOKEN.trim(),source:'environment'};
  const legacy=read(legacyFile);return {token:legacy,source:legacy?'file':'none'};
}
function validateGitHub({token,owner,repo}){
  if(typeof token!=='string'||!token.trim()||token.length>512||/[\s\x00-\x1f\x7f]/.test(token.trim()))throw new Problem('GitHub 개인 액세스 토큰 전체를 입력해주세요.');
  if(typeof owner!=='string'||!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(owner.trim()))throw new Problem('저장소 소유자 이름을 확인해주세요.');
  if(typeof repo!=='string'||!/^[A-Za-z0-9_.-]{1,100}$/.test(repo.trim())||['.','..'].includes(repo.trim()))throw new Problem('저장소 이름을 확인해주세요.');
  return {token:token.trim(),owner:owner.trim(),repo:repo.trim()};
}
class GitHubConnection{
  constructor({token='',owner='bacdemokr',repo='bac-demo',source='environment',fetcher=fetch,canConfigure=()=>true}={}){
    this.defaults={owner,repo};this.fetcher=fetcher;this.canConfigure=canConfigure;this.attempt=0;this.revision=0;this.error='';
    this.connection=token?{token,owner,repo,source,verified:false}:null;
  }
  public(){
    const c=this.connection;
    return {configured:!!c,connected:!!c?.verified,owner:c?.owner||this.defaults.owner,repo:c?.repo||this.defaults.repo,login:c?.login||'',source:c?.source||'none',canWrite:!!c?.verified&&c.canWrite,defaultBranch:c?.defaultBranch||'',error:this.error};
  }
  requireConnection(){if(!this.connection?.verified)throw new Problem('연결 설정에서 GitHub 토큰과 저장소를 연결해주세요.',409);return this.connection;}
  async request(c,method,resource,body){
    let response;
    try{response=await this.fetcher('https://api.github.com'+resource,{method,headers:{Authorization:'Bearer '+c.token,Accept:'application/vnd.github+json','Content-Type':'application/json','User-Agent':'Agentic-AI-Demo'},redirect:'error',signal:AbortSignal.timeout(12000),...(body?{body:JSON.stringify(body)}:{})});}
    catch{throw new Problem('GitHub에 연결할 수 없습니다. 네트워크 상태를 확인해주세요.',502);}
    if(!response.ok){const code=response.status;const detail=code===401?'토큰을 확인해주세요.':code===403?'토큰 권한 또는 조직의 승인 상태를 확인해주세요.':code===404?'저장소 이름과 토큰의 접근 범위를 확인해주세요.':code===429?'요청이 많습니다. 잠시 후 다시 시도해주세요.':'저장소와 요청 내용을 확인해주세요.';throw new Problem(`GitHub 요청 실패 (${code}). ${detail}`,502);}
    try{const data=await response.json();if(!data||typeof data!=='object')throw Error();return data;}catch{throw new Problem('GitHub 응답을 확인할 수 없습니다.',502);}
  }
  async verify(candidate){
    const c=validateGitHub(candidate),user=await this.request(c,'GET','/user');
    if(typeof user.login!=='string'||!user.login)throw new Problem('GitHub 계정 정보를 확인할 수 없습니다.',502);
    const repository=await this.request(c,'GET',`/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`);
    if(typeof repository.name!=='string'||repository.name.toLowerCase()!==c.repo.toLowerCase()||repository.owner?.login?.toLowerCase()!==c.owner.toLowerCase())throw new Problem('GitHub 저장소 정보를 확인할 수 없습니다.',502);
    if(!repository.default_branch)throw new Problem('저장소에 초기 커밋과 기본 브랜치를 만든 뒤 연결해주세요.',409);
    return {...c,source:candidate.source,verified:true,login:user.login,defaultBranch:repository.default_branch,canWrite:repository.permissions?.push!==false&&!repository.archived&&!repository.disabled};
  }
  async configure({token,owner,repo,disconnect}){
    if(!this.canConfigure())throw new Problem('협업 작업이 진행 중입니다. 완료 후 GitHub 연결을 변경해주세요.',409);
    const attempt=++this.attempt;
    if(disconnect===true){this.connection=null;this.error='';++this.revision;return this.public();}
    const verified=await this.verify({token,owner,repo,source:'runtime'});
    if(attempt!==this.attempt)throw new Problem('GitHub 연결 설정이 변경되었습니다. 다시 확인해주세요.',409);
    if(!this.canConfigure())throw new Problem('협업 작업이 진행 중입니다. 완료 후 GitHub 연결을 변경해주세요.',409);
    this.connection=verified;this.error='';++this.revision;return this.public();
  }
  async start(){
    const c=this.connection,attempt=this.attempt;if(!c)return;
    try{const verified=await this.verify(c);if(this.connection===c&&attempt===this.attempt){this.connection=verified;this.error='';++this.revision;}}
    catch(error){if(this.connection===c&&attempt===this.attempt)this.error=error instanceof Problem?error.message:'GitHub 연결을 확인해주세요.';}
  }
}
module.exports={GitHubConnection,loadGitHubCredential,validateGitHub};
