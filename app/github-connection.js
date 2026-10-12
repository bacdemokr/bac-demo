'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
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
  constructor({token='',owner='',repo='',source='environment',fetcher=fetch,canConfigure=()=>true,targetFile=''}={}){
    this.targetFile=targetFile;
    this.defaults={owner,repo};this.fetcher=fetcher;this.canConfigure=canConfigure;this.attempt=0;this.revision=0;this.error='';
    this.connection=token?{token,owner,repo,source,verified:false}:null;
    this.forking=false;this.forks=new Map();this.deleting=false;this.deletions=new Map();
  }
  saveTarget(){
    if(!this.targetFile)return;
    const c=this.connection,data=c?.verified&&c.repo?{login:c.login,owner:c.owner,repo:c.repo}:{};
    try{fs.mkdirSync(path.dirname(this.targetFile),{recursive:true});fs.writeFileSync(this.targetFile,JSON.stringify(data),{mode:0o600});}catch{}
  }
  public(){
    const c=this.connection;
    return {configured:!!c,connected:!!c?.verified,owner:c?(c.owner||c.login||''):this.defaults.owner,repo:c?c.repo:this.defaults.repo,login:c?.login||'',source:c?.source||'none',canWrite:!!c?.verified&&!!c.canWrite,defaultBranch:c?.defaultBranch||'',forking:this.forking,deleting:this.deleting,error:this.error};
  }
  requireConnection(){if(!this.connection?.verified)throw new Problem('연결 설정에서 GitHub 토큰을 연결해주세요.',409);return this.connection;}
  async request(c,method,resource,body){
    let response;
    try{response=await this.fetcher('https://api.github.com'+resource,{method,headers:{Authorization:'Bearer '+c.token,Accept:'application/vnd.github+json','Content-Type':'application/json','User-Agent':'Agentic-AI-Demo'},redirect:'error',signal:AbortSignal.timeout(12000),...(body?{body:JSON.stringify(body)}:{})});}
    catch{throw new Problem('GitHub에 연결할 수 없습니다. 네트워크 상태를 확인해주세요.',502);}
    if(!response.ok){const code=response.status;const detail=code===401?'토큰을 확인해주세요.':code===403?'토큰 권한 또는 조직의 승인 상태를 확인해주세요.':code===404?'저장소 이름과 토큰의 접근 범위를 확인해주세요.':code===429?'요청이 많습니다. 잠시 후 다시 시도해주세요.':'저장소와 요청 내용을 확인해주세요.';const error=new Problem(`GitHub 요청 실패 (${code}). ${detail}`,502);error.upstreamStatus=code;throw error;}
    if(method==='DELETE'){if(response.status!==204)throw new Problem('GitHub에서 삭제 완료 응답을 확인하지 못했습니다. 저장소 상태를 다시 확인해주세요.',502);return {deleted:true};}
    try{const data=await response.json();if(!data||typeof data!=='object')throw Error();return data;}catch{throw new Problem('GitHub 응답을 확인할 수 없습니다.',502);}
  }
  async verify(candidate){
    const selected=!!candidate.repo;
    const checked=validateGitHub({...candidate,owner:selected?candidate.owner:'account',repo:selected?candidate.repo:'connection'});
    const c={...checked,owner:selected?checked.owner:'',repo:selected?checked.repo:''},user=await this.request(c,'GET','/user');
    if(typeof user.login!=='string'||!user.login)throw new Problem('GitHub 계정 정보를 확인할 수 없습니다.',502);
    validateGitHub({token:c.token,owner:user.login,repo:'account'});
    if(!selected)return {...c,source:candidate.source,verified:true,login:user.login,defaultBranch:'',canWrite:false};
    const repository=await this.request(c,'GET',`/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`);
    if(typeof repository.name!=='string'||repository.name.toLowerCase()!==c.repo.toLowerCase()||repository.owner?.login?.toLowerCase()!==c.owner.toLowerCase())throw new Problem('GitHub 저장소 정보를 확인할 수 없습니다.',502);
    if(!repository.default_branch)throw new Problem('저장소에 초기 커밋과 기본 브랜치를 만든 뒤 연결해주세요.',409);
    return {...c,source:candidate.source,verified:true,login:user.login,defaultBranch:repository.default_branch,canWrite:repository.permissions?.push!==false&&!repository.archived&&!repository.disabled};
  }
  async configure({token,owner,repo,disconnect}){
    if(!this.canConfigure()||this.forking||this.deleting)throw new Problem('GitHub 작업이 진행 중입니다. 완료 후 연결을 변경해주세요.',409);
    const attempt=++this.attempt;
    if(disconnect===true){this.connection=null;this.error='';++this.revision;this.saveTarget();return this.public();}
    const verified=await this.verify({token,owner,repo,source:'runtime'});
    if(attempt!==this.attempt)throw new Problem('GitHub 연결 설정이 변경되었습니다. 다시 확인해주세요.',409);
    if(!this.canConfigure()||this.forking||this.deleting)throw new Problem('GitHub 작업이 진행 중입니다. 완료 후 연결을 변경해주세요.',409);
    this.connection=verified;this.error='';++this.revision;this.saveTarget();return this.public();
  }
  async repositories(query=''){
    const c=this.requireConnection();
    if(typeof query!=='string'||query.length>200)throw new Problem('검색어는 200자 이내로 입력해주세요.');
    const text=query.trim().replace(/^https:\/\/github\.com\//i,'').replace(/\.git\/?$/,'').replace(/\/$/,'');
    const exact=/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(text);
    const q=(exact?'repo:'+text:text||'language:JavaScript stars:100..5000 size:1..2000')+' is:public archived:false fork:false';
    const data=await this.request(c,'GET','/search/repositories?q='+encodeURIComponent(q)+'&per_page=20');
    if(!Array.isArray(data.items))throw new Problem('저장소 검색 결과를 확인할 수 없습니다.',502);
    return {repositories:data.items.filter(r=>r.private===false&&!r.archived&&!r.disabled).map(r=>({name:r.full_name,description:r.description||'',stars:r.stargazers_count||0,url:r.html_url}))};
  }
  async ownedRepositories(connection=this.requireConnection()){
    const rows=[],seen=new Set();let truncated=false;
    for(let page=1;page<=10;page++){
      const data=await this.request(connection,'GET',`/user/repos?affiliation=owner&sort=updated&per_page=100&page=${page}`);
      if(!Array.isArray(data))throw new Problem('내 저장소 목록을 확인할 수 없습니다.',502);
      for(const r of data){if(r.owner?.login?.toLowerCase()!==connection.login.toLowerCase()||typeof r.name!=='string'||seen.has(r.name.toLowerCase()))continue;seen.add(r.name.toLowerCase());rows.push({id:r.id,name:connection.login+'/'+r.name,description:r.description||'',url:'https://github.com/'+connection.login+'/'+r.name,fork:!!r.fork,private:!!r.private,updated:r.updated_at||'',defaultBranch:r.default_branch||'',canWrite:r.permissions?.push===true});}
      if(data.length<100)break;if(page===10)truncated=true;
    }
    return {repositories:rows,truncated};
  }
  async prepareDelete(repository){
    const c=this.requireConnection();
    if(typeof repository!=='string')throw new Problem('삭제할 Fork의 owner/repository 이름을 지정해주세요.');
    const [owner,repo,...rest]=repository.split('/');validateGitHub({token:c.token,owner,repo});
    if(rest.length||owner.toLowerCase()!==c.login.toLowerCase())throw new Problem('연결된 내 계정의 Fork만 삭제할 수 있습니다.',403);
    const revision=this.revision,info=await this.request(c,'GET',`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
    if(!info.fork||info.owner?.login?.toLowerCase()!==c.login.toLowerCase()||info.name?.toLowerCase()!==repo.toLowerCase()||!Number.isSafeInteger(info.id))throw new Problem('내 계정의 Fork임을 확인하지 못했습니다. 원본 저장소는 삭제할 수 없습니다.',403);
    if(info.permissions?.admin===false)throw new Problem('이 Fork를 삭제할 관리자 권한이 없습니다.',403);
    if(this.connection!==c||this.revision!==revision)throw new Problem('GitHub 연결이 변경되었습니다. 다시 요청해주세요.',409);
    for(const [id,p] of this.deletions)if(p.expires<Date.now()||this.deletions.size>=20)this.deletions.delete(id);
    const preview={id:randomUUID(),repository:c.login+'/'+info.name,url:'https://github.com/'+c.login+'/'+info.name,parent:info.parent?.full_name||'',expires:Date.now()+300000};
    this.deletions.set(preview.id,{...preview,repositoryId:info.id,connection:c,revision,state:'pending'});return preview;
  }
  async deleteFork({id,confirmation}){
    const p=this.deletions.get(id);
    if(!p||p.expires<Date.now()||p.state!=='pending')throw new Problem('삭제 확인이 만료되었거나 이미 처리됐습니다. 다시 요청해주세요.',409);
    if(confirmation!==p.repository)throw new Problem('확인란에 표시된 저장소 전체 이름을 정확히 입력해주세요.');
    if(this.deleting||this.forking||!this.canConfigure())throw new Problem('진행 중인 GitHub 작업이 끝난 뒤 삭제해주세요.',409);
    if(this.connection!==p.connection||this.revision!==p.revision)throw new Problem('GitHub 연결이 변경되었습니다. 다시 삭제를 요청해주세요.',409);
    this.deleting=true;
    try{
      const c=p.connection,resource='/repos/'+p.repository.split('/').map(encodeURIComponent).join('/'),info=await this.request(c,'GET',resource);
      if(info.id!==p.repositoryId||!info.fork||info.owner?.login?.toLowerCase()!==c.login.toLowerCase())throw new Problem('확인한 Fork가 변경되었습니다. 다시 요청해주세요.',409);
      if(!this.canConfigure())throw new Problem('진행 중인 작업이 끝난 뒤 다시 요청해주세요.',409);
      p.state='submitted';
      try{await this.request(c,'DELETE',resource);}catch(error){p.state='failed';if(error.upstreamStatus===403)throw new Problem('삭제 권한이 부족합니다. GitHub 토큰에 Administration: Read and write 권한이 필요합니다. Repository creation 권한만으로는 삭제할 수 없습니다.',403);throw error;}
      p.state='done';
      if(c.repo?.toLowerCase()===info.name.toLowerCase()&&c.owner?.toLowerCase()===c.login.toLowerCase())this.connection={...c,owner:'',repo:'',defaultBranch:'',canWrite:false};
      ++this.revision;this.saveTarget();return {deleted:true,repository:p.repository,reply:p.repository+' Fork를 삭제했습니다.'};
    }finally{this.deleting=false;}
  }
  createFork({repository}){
    const c=this.requireConnection();
    if(this.forking||this.deleting||!this.canConfigure())throw new Problem('다른 GitHub 작업이 진행 중입니다.',409);
    if(typeof repository!=='string')throw new Problem('Fork할 공개 저장소를 선택해주세요.');
    const [owner,repo,...rest]=repository.split('/');validateGitHub({token:c.token,owner,repo});
    if(rest.length||owner.toLowerCase()===c.login.toLowerCase())throw new Problem('다른 계정의 공개 저장소를 선택해주세요.');
    for(const [id,job]of this.forks)if(job.status!=='running'&&this.forks.size>=12)this.forks.delete(id);
    const job={id:randomUUID(),status:'running',repository:'',url:'',error:'',step:'원본 저장소 확인'};this.forks.set(job.id,job);this.forking=true;
    this.fork(c,owner,repo,job).then(()=>{job.status='done';}).catch(error=>{job.status='error';job.error=error instanceof Problem?error.message:'Fork를 완료하지 못했습니다. GitHub에서 결과를 확인해주세요.';}).finally(()=>{this.forking=false;});
    return {...job};
  }
  forkStatus(id){const job=this.forks.get(id);if(!job)throw new Problem('Fork 작업이 만료되었습니다.',404);return {...job};}
  async fork(c,owner,repo,job){
    const base='/repos/'+encodeURIComponent(owner)+'/'+encodeURIComponent(repo),source=await this.request(c,'GET',base);
    if(source.private!==false||source.archived||source.disabled||!source.default_branch||source.owner?.login?.toLowerCase()!==owner.toLowerCase()||source.name?.toLowerCase()!==repo.toLowerCase())throw new Problem('사용 가능한 공개 저장소만 Fork할 수 있습니다.');
    job.step='내 계정에 Fork 요청';
    const result=await this.request(c,'POST',base+'/forks',{default_branch_only:true});
    if(result.owner?.login?.toLowerCase()!==c.login.toLowerCase()||!result.name||!result.fork)throw new Problem('Fork 결과를 확인할 수 없습니다. GitHub에서 확인해주세요.',502);
    validateGitHub({token:c.token,owner:c.login,repo:result.name});
    job.repository=c.login+'/'+result.name;job.url='https://github.com/'+job.repository;job.step='Fork 준비 확인';
    const deadline=Date.now()+60000;
    while(Date.now()<deadline){
      try{
        const target=await this.verify({...c,owner:c.login,repo:result.name});
        const info=await this.request(target,'GET','/repos/'+job.repository);
        if(!info.fork||info.parent?.full_name?.toLowerCase()!==(owner+'/'+repo).toLowerCase())throw new Problem('원본과 Fork 저장소의 연결을 확인할 수 없습니다.',409);
        const ref=await this.request(target,'GET','/repos/'+job.repository+'/git/ref/heads/'+encodeURIComponent(target.defaultBranch));
        if(ref.object?.sha){this.connection=target;++this.revision;this.saveTarget();job.step='Fork 완료 · 작업 저장소로 선택됨';return;}
      }catch(error){if(error.status===409&&!error.message.includes('초기 커밋'))throw error;}
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    throw new Problem('Fork 요청은 접수됐지만 준비 확인이 늦어지고 있습니다. 표시된 GitHub 링크에서 상태를 확인해주세요.',504);
  }
  async start(){
    const c=this.connection,attempt=this.attempt;if(!c)return;
    try{let verified=await this.verify(c);
      if(!c.repo&&this.targetFile)try{if(fs.statSync(this.targetFile).size<=1000){const target=JSON.parse(fs.readFileSync(this.targetFile,'utf8'));if(target.login===verified.login&&target.owner&&target.repo)verified=await this.verify({...verified,owner:target.owner,repo:target.repo});}}catch{}
      if(this.connection===c&&attempt===this.attempt){this.connection=verified;this.error='';++this.revision;}}
    catch(error){if(this.connection===c&&attempt===this.attempt)this.error=error instanceof Problem?error.message:'GitHub 연결을 확인해주세요.';}
  }
}
module.exports={GitHubConnection,loadGitHubCredential,validateGitHub};
