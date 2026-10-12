'use strict';
const {Problem}=require('./integrations');
const DEFAULTS={local:'http://127.0.0.1:8001/v1',nvidia:'https://inference-api.nvidia.com/v1'};
function validateProfile(provider,input={}){
  if(!Object.hasOwn(DEFAULTS,provider))throw new Problem('모델 연결 종류를 확인해주세요.');
  const values={};for(const field of ['baseUrl','apiKey','model']){const v=input[field]??'';if(typeof v!=='string'||v.length>512||/[\x00-\x1f\x7f]/.test(v))throw new Problem('모델 연결 정보를 확인해주세요.');values[field]=v.trim();}
  let url;try{url=new URL(values.baseUrl||DEFAULTS[provider]);}catch{throw new Problem('모델 서버 주소를 확인해주세요.');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||!/^\/v1\/?$/.test(url.pathname))throw new Problem('모델 주소는 http(s)://서버:포트/v1 형식으로 입력해주세요.');
  if(provider==='nvidia'&&(url.protocol!=='https:'||url.port||!['inference-api.nvidia.com','integrate.api.nvidia.com'].includes(url.hostname)))throw new Problem('NVIDIA Inference 주소를 선택해주세요.');
  if(values.model&&(/\s/.test(values.model)||values.model.length>256))throw new Problem('모델 ID를 확인해주세요.');
  return {...values,baseUrl:url.href.replace(/\/$/,'')};
}
function parseReply(data){
  const text=data?.choices?.[0]?.message?.content;
  if(data?.error||typeof text!=='string'||!text.trim()||text.length>100000)throw new Problem('모델이 정상적인 답변을 반환하지 않았습니다.',502);
  const bubble=text.match(/^\s*SUMMARY:\s*(.+)$/im)?.[1]?.trim()||null;
  return {reply:text.replace(/^\s*SUMMARY:.*$/im,'').trim()||bubble,bubble};
}
class ModelConnections{
  constructor({config={},fetcher=fetch,canConfigure=()=>true}={}){
    this.fetcher=fetcher;this.canConfigure=canConfigure;this.active=config.active||'gateway';this.profiles={};this.revision=0;
    for(const provider of Object.keys(DEFAULTS)){const raw=config[provider];if(raw?.model)this.profiles[provider]={...validateProfile(provider,raw),source:raw.source||'config',verified:false,error:''};}
  }
  public(){return {active:this.active,profiles:Object.fromEntries(Object.entries(DEFAULTS).map(([provider,baseUrl])=>{const p=this.profiles[provider];return [provider,{configured:!!p,connected:!!p?.verified,baseUrl:p?.baseUrl||baseUrl,model:p?.model||'',hasKey:!!p?.apiKey,source:p?.source||'none',error:p?.error||''}];}))};}
  ready(){return this.active!=='gateway'&&!!this.profiles[this.active]?.verified;}
  snapshot(){const p=this.profiles[this.active];if(!this.ready())throw new Problem('사용할 모델의 연결을 확인해주세요.',409);return {...p,provider:this.active};}
  candidate(provider,input){const p=validateProfile(provider,input),old=this.profiles[provider];if(!p.apiKey&&old?.baseUrl===p.baseUrl)p.apiKey=old.apiKey;if(provider==='nvidia'&&!p.apiKey)throw new Problem('NVIDIA Inference API 키를 입력해주세요.');return p;}
  async request(profile,suffix,{messages,timeout=120000,maxTokens=8192}={}){
    let response;
    try{response=await this.fetcher(profile.baseUrl+suffix,{method:messages?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(timeout),headers:{Accept:'application/json',...(messages?{'Content-Type':'application/json'}:{}),...(profile.apiKey?{Authorization:'Bearer '+profile.apiKey}:{})},...(messages?{body:JSON.stringify({model:profile.model,messages,stream:false,max_tokens:maxTokens})}:{})});}catch{throw new Problem('모델 서버에 연결할 수 없습니다. 주소와 실행 상태를 확인해주세요.',502);}
    if(!response.ok)throw new Problem(response.status===401||response.status===403?'모델 API 키와 접근 권한을 확인해주세요.':`모델 서버 요청 실패 (${response.status}).`,502);
    let data;try{data=await response.json();}catch{throw new Problem('모델 서버 응답 형식이 올바르지 않습니다.',502);}return data;
  }
  async models(provider,input){const p=this.candidate(provider,input),data=await this.request(p,'/models',{timeout:15000});if(!Array.isArray(data?.data))throw new Problem('모델 목록을 읽지 못했습니다.',502);return {models:data.data.filter(m=>typeof m?.id==='string'&&m.id.length<=256&&!/[\s\x00-\x1f\x7f]/.test(m.id)).slice(0,1000).map(m=>({id:m.id}))};}
  async verify(provider,p,inference=false){const {models}=await this.models(provider,p);if(!models.some(m=>m.id===p.model))throw new Problem('서버에 해당 모델이 없습니다. 모델 목록에서 선택해주세요.',409);if(inference)parseReply(await this.request(p,'/chat/completions',{messages:[{role:'user',content:'Reply with OK.'}],timeout:30000,maxTokens:128}));}
  async configure(input){
    if(!this.canConfigure())throw new Problem('진행 중인 작업이 끝난 뒤 모델을 변경해주세요.',409);
    const rev=++this.revision;
    if(input.active!==undefined){if(!['gateway','local','nvidia'].includes(input.active))throw new Problem('사용할 모델 연결을 확인해주세요.');if(input.active!=='gateway'&&!this.profiles[input.active]?.verified)throw new Problem('먼저 해당 모델을 연결해주세요.',409);this.active=input.active;return this.public();}
    const provider=input.provider,p=this.candidate(provider,input);if(!p.model)throw new Problem('모델 ID를 선택해주세요.');
    await this.verify(provider,p,true);
    if(rev!==this.revision)throw new Problem('더 최근 모델 설정이 적용되었습니다.',409);
    if(!this.canConfigure())throw new Problem('진행 중인 작업이 끝난 뒤 모델을 변경해주세요.',409);
    this.profiles[provider]={...p,source:'runtime',verified:true,error:''};this.active=provider;return this.public();
  }
  async start(){await Promise.all(Object.entries(this.profiles).map(async([provider,p])=>{try{await this.verify(provider,p);if(this.profiles[provider]===p){p.verified=true;p.error='';}}catch(e){if(this.profiles[provider]===p)p.error=e instanceof Problem?e.message:'모델 연결 확인 실패';}}));}
  async complete(profile,messages,timeout){return parseReply(await this.request(profile,'/chat/completions',{messages,timeout}));}
}
module.exports={ModelConnections,validateProfile,DEFAULTS};
