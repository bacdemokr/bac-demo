'use strict';
const {randomUUID}=require('crypto');
const {Problem}=require('./integrations');
class TaskJobs{
  constructor(worker,{limit=8,ttl=600000,timeout=180000}={}){this.worker=worker;this.limit=limit;this.ttl=ttl;this.timeout=timeout;this.jobs=new Map();}
  prune(){for(const[id,j]of this.jobs)if(j.status==='done'&&Date.now()-j.at>this.ttl)this.jobs.delete(id);}
  create(input){
    this.prune();
    if([...this.jobs.values()].filter(j=>j.status==='pending').length>=this.limit)throw new Problem('진행 중인 작업이 많습니다. 잠시 후 다시 시도해주세요.',429);
    while(this.jobs.size>=64){const old=[...this.jobs].find(([,j])=>j.status==='done');if(!old)break;this.jobs.delete(old[0]);}
    const job={jobId:randomUUID(),status:'pending',at:Date.now()};this.jobs.set(job.jobId,job);
    let settled=false;
    const finish=result=>{if(settled)return;settled=true;clearTimeout(timer);Object.assign(job,result,{status:'done',at:Date.now()});};
    const timer=setTimeout(()=>finish({error:'작업 시간이 초과되었습니다. 연결 상태를 확인해주세요.'}),this.timeout);timer.unref?.();
    Promise.resolve().then(()=>this.worker(input)).then(result=>finish(result),error=>finish({error:error instanceof Problem?error.message:'작업을 완료하지 못했습니다.'}));
    return {jobId:job.jobId};
  }
  public(id){this.prune();const job=this.jobs.get(id);if(!job)throw new Problem('작업이 만료되었습니다. 다시 실행해주세요.',404);return {...job};}
}
function validateMessages(input,agents){
  if(!Object.hasOwn(agents,input.agent))throw new Problem('지원하지 않는 에이전트입니다.');
  if(!Array.isArray(input.messages)||!input.messages.length||input.messages.length>32)throw new Problem('대화 내용을 확인해주세요.');
  let length=0;
  for(const m of input.messages){if(!m||!['user','assistant'].includes(m.role)||typeof m.content!=='string'||!m.content.trim())throw new Problem('대화 내용을 확인해주세요.');length+=m.content.length;}
  if(length>30000)throw new Problem('대화가 너무 깁니다. 새 대화를 시작해주세요.',413);
  if(!input.messages.some(m=>m.role==='user'))throw new Problem('요청 내용이 필요합니다.');
  return input;
}
module.exports={TaskJobs,validateMessages};
