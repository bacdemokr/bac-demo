'use strict';
const {randomUUID}=require('crypto');
const {Problem}=require('./integrations');
async function callGateway({url,token,agent='bac',model,messages,timeout=120000,fetcher=fetch}){
  if(!token)throw new Problem('Gateway 인증 설정이 필요합니다.',409);
  let endpoint;
  try{endpoint=new URL(url.replace(/\/$/,'')+'/v1/chat/completions');if(!['http:','https:'].includes(endpoint.protocol))throw Error();}catch{throw new Problem('Gateway 주소를 확인해주세요.',409);}
  let response;
  try{response=await fetcher(endpoint.href,{method:'POST',redirect:'error',signal:AbortSignal.timeout(timeout),headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`,'x-openclaw-session-key':`agent:${agent}:demo-${randomUUID()}`,...(model?{'x-openclaw-model':model}:{})},body:JSON.stringify({model:`openclaw/${agent}`,messages})});}
  catch(error){
    if(error?.name==='TimeoutError'||error?.name==='AbortError')throw new Problem('Gateway 응답 시간이 초과되었습니다. Gateway가 사용하는 모델 서버의 실행 상태와 모델 로딩 상태를 확인해주세요.',504);
    throw new Problem('Gateway에 연결할 수 없습니다. 주소와 실행 상태를 확인해주세요.',502);
  }
  if(!response.ok)throw new Problem(response.status===401||response.status===403?'Gateway 인증 정보를 확인해주세요.':`Gateway 요청 실패 (${response.status}).`,502);
  let data;try{data=await response.json();}catch{throw new Problem('Gateway 응답 형식이 올바르지 않습니다.',502);}
  const text=data?.choices?.[0]?.message?.content;
  if(data.error||typeof text!=='string'||!text.trim())throw new Problem('Gateway에서 응답을 받지 못했습니다.',502);
  if(text.length>100000)throw new Problem('Gateway 응답이 너무 큽니다.',502);
  const match=text.match(/^\s*SUMMARY:\s*(.+)$/im),bubble=match?.[1]?.trim()||null;
  const reply=text.replace(/^\s*SUMMARY:.*$/im,'').trim()||bubble;
  return {reply,bubble};
}
module.exports={callGateway};
