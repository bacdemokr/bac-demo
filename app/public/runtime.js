/* Local API and resumable asynchronous task transport. */
(()=>{
  async function request(path,body,options={}){
    const {allowError=false,...fetchOptions}=options;let response;
    try{response=await fetch(path,{cache:'no-store',signal:AbortSignal.timeout(15000),...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),...fetchOptions});}
    catch(error){throw new Error(error.name==='TimeoutError'?'서버 응답이 지연되고 있습니다.':'서버에 연결할 수 없습니다.');}
    let data;try{data=await response.json();}catch{throw new Error('서버 응답 형식이 올바르지 않습니다.');}
    if(!response.ok||(!allowError&&data.error))throw new Error(data.error||'요청을 완료하지 못했습니다.');
    return data;
  }
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  async function poll(path,{onUpdate,timeout=190000}={}){
    const end=Date.now()+timeout;let failures=0;
    while(Date.now()<end){
      let data;
      try{data=await request(path,undefined,{allowError:true});failures=0;}catch(error){if(++failures>=4)throw error;await wait(1200);continue;}
      onUpdate?.(data);
      if(data.status==='done')return data;
      await wait(500);
    }
    throw new Error('작업이 아직 진행 중입니다. 연결 상태를 확인해주세요.');
  }
  async function task(body){const {jobId}=await request('/api/tasks',body);return poll('/api/tasks/'+jobId);}
  window.DemoAPI={request,poll,task};
})();
