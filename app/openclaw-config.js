'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const JSON5=require('json5');
const run=promisify(execFile);
const DEFAULT_URL='http://127.0.0.1:18789';
const DEFAULT_AGENTS={bac:'bac',git:'git',pm:'pm',dev:'dev'};
const localHost=host=>['localhost','127.0.0.1','[::1]','::1'].includes(host);
function sameEndpoint(a,b){try{const x=new URL(a),y=new URL(b);return x.protocol===y.protocol&&(x.hostname===y.hostname||(localHost(x.hostname)&&localHost(y.hostname)))&&x.port===y.port&&x.pathname.replace(/\/$/,'')===y.pathname.replace(/\/$/,'');}catch{return false;}}
async function textFile(file){try{return (await fs.readFile(file,'utf8')).trim();}catch{return '';}}
function agentEntries(config){const raw=config.agents?.entries||config.agents?.list||[];return Array.isArray(raw)?raw:Object.entries(raw).map(([id,value])=>({...value,id}));}
function routes(config,env){
  const entries=agentEntries(config),ids=new Set(entries.map(a=>a.id));
  const preferred=env.GATEWAY_AGENT||(['bac',config.agents?.defaults?.systemAgent?.agentId,entries.find(a=>a.default)?.id,...(entries.length===1?[entries[0].id]:[]),'main','bac-host'].find(id=>ids.has(id)))||(entries.length===0?'main':null);
  const agents={bac:preferred,git:env.GITHUB_AGENT||(ids.has('git')?'git':null),pm:env.PM_AGENT||(ids.has('pm')?'pm':preferred),dev:env.DEV_AGENT||(ids.has('dev')?'dev':preferred)};
  const rawModel=entries.find(a=>a.id===preferred)?.model||config.agents?.defaults?.model;
  const model=typeof rawModel==='string'?rawModel:rawModel?.primary||'';
  return {agent:preferred,agents,model};
}
// Inspect only the local listener's identity and working directory. Never dump its environment.
async function listenerConfigs(port){
  try{
    const {stdout}=await run('lsof',['-nP',`-iTCP:${port}`,'-sTCP:LISTEN','-Fp'],{timeout:2000,maxBuffer:100000});
    const candidates=[];
    for(const pid of new Set(stdout.split('\n').filter(s=>/^p\d+$/.test(s)).map(s=>s.slice(1)))){
      const {stdout:uid}=await run('ps',['-p',pid,'-o','uid='],{timeout:1000});
      if(process.getuid&&Number(uid.trim())!==process.getuid())continue;
      const {stdout:command}=await run('ps',['-p',pid,'-o','command='],{timeout:1000,maxBuffer:10000});
      if(!/\bopenclaw(?:-gateway|[/.\s]|$)/i.test(command))continue;
      const {stdout:cwd}=await run('lsof',['-a','-p',pid,'-d','cwd','-Fn'],{timeout:2000,maxBuffer:10000});
      for(const line of cwd.split('\n'))if(line.startsWith('n')){
        const directory=line.slice(1);candidates.push(path.join(directory,'state','openclaw.json'),path.join(directory,'openclaw.json'));
      }
      const {stdout:files}=await run('lsof',['-p',pid,'-Fn'],{timeout:2000,maxBuffer:1000000});
      for(const line of files.split('\n'))if(line.startsWith('n')&&line.includes('/agents/'))candidates.push(path.join(line.slice(1).split('/agents/')[0],'openclaw.json'));
    }
    return [...new Set(candidates)];
  }catch{return [];}
}
async function resolveOpenClaw({env=process.env,home=os.homedir(),appDir=__dirname,discover=listenerConfigs,remember=true}={}){
  const url=env.GATEWAY_URL||DEFAULT_URL;
  const legacy=env.GATEWAY_TOKEN||((env.OPENCLAW_CONFIG_PATH||env.OPENCLAW_STATE_DIR)?'':await textFile(path.join(appDir,'.gw_token'))||await textFile('/tmp/gw_token.txt'));
  const configured={url,token:legacy,automatic:true,source:legacy?'environment':'unavailable',agent:env.GATEWAY_AGENT||'bac',agents:{...DEFAULT_AGENTS,bac:env.GATEWAY_AGENT||'bac',...(env.GITHUB_AGENT?{git:env.GITHUB_AGENT}:{}),...(env.PM_AGENT?{pm:env.PM_AGENT}:{}),...(env.DEV_AGENT?{dev:env.DEV_AGENT}:{})},error:''};
  // Explicit remote credentials must never be replaced with a local installation's token.
  if(legacy&&!env.OPENCLAW_CONFIG_PATH&&!env.OPENCLAW_STATE_DIR)return configured;
  const expand=p=>p.startsWith('~/')?path.join(home,p.slice(2)):path.resolve(p);
  let candidates;
  if(env.OPENCLAW_CONFIG_PATH)candidates=[expand(env.OPENCLAW_CONFIG_PATH)];
  else if(env.OPENCLAW_STATE_DIR)candidates=[path.join(expand(env.OPENCLAW_STATE_DIR),'openclaw.json')];
  else{
    let endpoint;try{endpoint=new URL(url);}catch{return {...configured,error:'OpenClaw 서버 주소가 올바르지 않습니다.'};}
    if(!localHost(endpoint.hostname))return {...configured,error:'원격 OpenClaw의 서버 인증 설정을 확인해주세요.'};
    const active=await discover(Number(endpoint.port)||(endpoint.protocol==='https:'?443:80));
    const remembered=await textFile(path.join(appDir,'.openclaw-path'));
    const profile=env.OPENCLAW_PROFILE?'-'+env.OPENCLAW_PROFILE:'';
    candidates=[...active,...(remembered?[remembered]:[]),path.join(home,'.openclaw'+profile,'openclaw.json')];
  }
  for(const file of [...new Set(candidates)]){
    let config;try{config=JSON5.parse(await fs.readFile(file,'utf8'));}catch{continue;}
    const gateway=config?.gateway;if(!gateway||typeof gateway!=='object')continue;
    const configUrl=gateway.mode==='remote'?gateway.remote?.url:`http://127.0.0.1:${gateway.port||18789}`;
    if(env.GATEWAY_URL&&!sameEndpoint(url,configUrl))continue;
    let token=gateway.mode==='remote'?gateway.remote?.token:gateway.auth?.token;
    if(typeof token==='string')token=token.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g,(_,key)=>env[key]||'').trim();
    const auth=legacy||token;
    if(typeof auth!=='string'||!auth||/[\r\n]/.test(auth))continue;
    const routing=routes(config,env);
    if(!routing.agent)return {...configured,token:'',source:'local-config',...routing,error:'기본 AI 에이전트를 확인할 수 없습니다. 서버 설정을 확인해주세요.'};
    if(remember&&!env.OPENCLAW_CONFIG_PATH&&!env.OPENCLAW_STATE_DIR)await fs.writeFile(path.join(appDir,'.openclaw-path'),path.resolve(file)+'\n',{mode:0o600}).catch(()=>{});
    return {...configured,url:env.GATEWAY_URL||configUrl,token:auth,source:'local-config',...routing};
  }
  return {...configured,error:legacy?'':'로컬 OpenClaw 설정을 찾지 못했습니다. 서버 설정을 확인해주세요.'};
}
module.exports={resolveOpenClaw,listenerConfigs,agentEntries,sameEndpoint};
