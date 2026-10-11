/* Tools and explicit messaging actions. Credentials remain on the server. */
(() => {
  const $=id=>document.getElementById(id), demo=()=>window.BacDemo, api=window.DemoAPI.request;
  const results=new Map(), resumed=new Set();
  let status={}, connectionRevision=0, statusLoading=false, toastTimer;
  let browserJob=null, browserRunning=false, browserSummary='', summaryRevision=0, summaryRunning=false;
  let inboxLoading=false, telegramLoading=false, telegramSending=false, telegramCursor=0, telegramTimer;
  let shareSending=false;
  const roles={sysmon:'시스템 상태 · 로컬 도구',github:'GitHub 작업 · OpenClaw MCP',multiagent:'PM / Dev 협업 · GitHub',arxiv:'논문 리서치 · arXiv RSS'};
  const canRun=id=>!!(status.gateway?.reachable&&status.gateway?.configured&&(id!=='multiagent'||status.team?.configured));
  const toast=text=>{$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4500);};
  function activity(agent,text){
    const item=document.createElement('li'),time=document.createElement('time'),name=document.createElement('strong'),content=document.createElement('p');
    time.textContent=new Date().toLocaleTimeString('ko-KR',{hour12:false});name.textContent=agent;content.textContent=text;item.append(time,name,content);$('activity-list').prepend(item);
    while($('activity-list').children.length>4)$('activity-list').lastElementChild.remove();
  }
  function roster(agents){
    $('agent-roster').replaceChildren();$('agent-count').textContent=`에이전트 ${agents.length}`;
    agents.forEach(a=>{const b=document.createElement('button'),dot=document.createElement('i'),label=document.createElement('span'),role=document.createElement('small');b.className='agent-button';b.dataset.agent=a.id;b.style.setProperty('--agent-color',a.color);label.textContent=a.name;role.textContent=roles[a.id]?.split(' · ')[0]||a.role;label.append(role);b.append(dot,label);b.onclick=()=>demo().openAgent(a.id);$('agent-roster').append(b);});
    renderConnections();
  }
  function syncChat(){
    const a=demo()?.getActive();
    document.querySelectorAll('[data-agent]').forEach(b=>{const c=demo().getAgents().find(c=>c.id===b.dataset.agent);b.classList.toggle('active',c===a);b.classList.toggle('working',!!c?.busy);b.setAttribute('aria-pressed',String(c===a));});
    const banner=$('chat-connection');banner.replaceChildren();banner.hidden=!a||canRun(a.id);
    if(a&&!canRun(a.id)){const text=document.createElement('span'),b=document.createElement('button');text.textContent=a.id==='multiagent'&&status.gateway?.configured&&status.gateway?.reachable?'협업 실행에 GitHub 토큰 설정이 필요합니다.':'AI 대화에 OpenClaw 연결이 필요합니다.';b.textContent='연결 확인';b.className='quiet-button';b.onclick=()=>openSettings(a.id==='multiagent'&&status.gateway?.configured&&status.gateway?.reachable?'tools':'gateway');banner.append(text,b);}
    const hasResult=!!results.get(a?.name);$('share-telegram').disabled=!hasResult;$('share-mail').disabled=!hasResult;
    $('input').disabled=!!a?.busy||!a||!canRun(a.id);$('input').placeholder=a?.busy?'작업 진행 중...':'메시지 입력';
    document.querySelectorAll('#agent-actions button').forEach(b=>b.disabled=!!a?.busy||!!a?.paperLoading||!a||(b.hasAttribute('data-ai')&&!canRun(a.id)));
  }
  window.addEventListener('bac:ready',e=>roster(e.detail));if(demo()?.getAgents().length)roster(demo().getAgents());
  window.addEventListener('bac:activity',e=>activity(e.detail.agent,e.detail.text));
  window.addEventListener('bac:result',e=>{if(e.detail.text)results.set(e.detail.agent,e.detail.text);syncChat();});
  window.addEventListener('bac:state',syncChat);
  window.addEventListener('bac:agent',e=>{
    const a=e.detail;$('agent-actions').replaceChildren();if(!a){syncChat();return;}$('chat-role').textContent=roles[a.id]||a.role;
    const button=(text,fn,ai=false)=>{const b=document.createElement('button');b.textContent=text;b.onclick=fn;if(ai)b.dataset.ai='true';$('agent-actions').append(b);};
    if(a.id==='sysmon')button('상태 새로고침',()=>demo().refreshSystem());
    if(a.id==='github')button('저장소 조회',()=>demo().runTurn(a,'내 GitHub 저장소 목록을 조회해줘.'),true);
    if(a.id==='arxiv')button('논문 새로고침',()=>demo().refreshPapers());
    if(a.id==='multiagent'&&a.teamJobId)button('진행 상태 확인',()=>demo().resumeTeam(a.teamJobId));
    syncChat();
  });
  $('activity-clear').onclick=()=>$('activity-list').replaceChildren();
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
  document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',e=>{const r=dialog.getBoundingClientRect();if(e.target===dialog&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom))dialog.close();}));
  document.querySelectorAll('[data-mission]').forEach(b=>b.onclick=()=>{
    const mission=b.dataset.mission;if(mission==='browser'||mission==='mail')demo().closeChat({restoreFocus:false});
    if(mission==='browser')openBrowser();if(mission==='team')demo().openAgent('multiagent');if(mission==='research')demo().openAgent('arxiv');if(mission==='mail')openInbox();
  });
  $('motion-toggle').setAttribute('aria-pressed',String(demo().isPaused()));
  $('motion-toggle').onclick=()=>{const paused=!demo().isPaused();demo().motion(paused);$('motion-toggle').setAttribute('aria-pressed',String(paused));$('motion-toggle').setAttribute('aria-label',paused?'애니메이션 재생':'애니메이션 일시 정지');$('motion-toggle').textContent=paused?'▷':'Ⅱ';};
  function bindTabs(attribute,select){
    const tabs=[...document.querySelectorAll(`[${attribute}]`)];
    tabs.forEach((b,i)=>{b.onclick=()=>select(b.getAttribute(attribute));b.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowLeft'?-1:1)+tabs.length)%tabs.length;select(tabs[next].getAttribute(attribute));tabs[next].focus();};});
  }
  function selectTab(tab){document.querySelectorAll('[data-tab]').forEach(b=>{const active=b.dataset.tab===tab;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;$('panel-'+b.dataset.tab).hidden=!active;});}
  function openSettings(tab='telegram'){selectTab(tab);if(!$('settings-dialog').open)$('settings-dialog').showModal();refreshStatus();}
  $('settings-open').onclick=()=>{demo().closeChat({restoreFocus:false});openSettings();};bindTabs('data-tab',selectTab);
  function showStatus(id,text,error=false){$(id).textContent=text;$(id).classList.toggle('error',error);}
  function renderConnections(){
    const tg=status.telegram||{},mail=status.agentmail||{},gw=status.gateway||{};
    if(document.activeElement!==$('gw-url')&&!$('gateway-form').dataset.pending)$('gw-url').value=gw.url||'http://127.0.0.1:18789';
    if(!$('gateway-form').dataset.pending)showStatus('gw-status',gw.configured&&gw.reachable?'주소 응답 확인 · 인증 정보 설정됨':gw.configured?'OpenClaw 서버 응답을 확인해주세요.':'연결 전');
    $('gw-disconnect').disabled=!!$('gateway-form').dataset.pending||!gw.configured;
    if(document.activeElement!==$('tg-chat')&&!$('tg-chat').value)$('tg-chat').value=tg.chatId||'';
    if(document.activeElement!==$('mail-inbox')&&!$('mail-inbox').value)$('mail-inbox').value=mail.inboxId||'';
    if(!$('telegram-form').dataset.pending)showStatus('tg-status',tg.connected?`@${tg.bot} · Chat ${tg.chatId}${tg.error?' · 수신 연결 확인 필요':''}`:tg.error||'연결 전',!!tg.error);
    if(!$('mail-connect-form').dataset.pending)showStatus('mail-status',mail.connected?`연결됨 · ${mail.inboxId}`:mail.error||'연결 전',!!mail.error);
    $('tg-disconnect').disabled=!!$('telegram-form').dataset.pending||!tg.configured;$('mail-disconnect').disabled=!!$('mail-connect-form').dataset.pending||!mail.configured;
    const runtime=canRun('github');$('runtime-status').classList.toggle('connected',runtime);$('runtime-status').lastChild.textContent=runtime?' AI 연결됨':' AI 연결 필요';
    $('tool-status-list').replaceChildren();
    const rows=[['OpenClaw Gateway',runtime?'연결됨':status.gateway?.reachable?'인증 설정 필요':'연결 필요'],['브라우저 · CDP',status.browser?.connected?'연결됨':'브라우저 실행 필요'],['GitHub MCP','OpenClaw의 git 에이전트에서 설정'],['PM / Dev 협업',status.team?.configured?`설정됨 · ${status.team.repository}`:'OpenClaw 및 GitHub 토큰 필요'],['Telegram',tg.connected?'연결됨':'연결 전'],['AgentMail',mail.connected?'연결됨':'연결 전']];
    rows.forEach(([name,state])=>{const row=document.createElement('div'),label=document.createElement('span'),value=document.createElement('small');row.className='tool-row';label.textContent=name;value.textContent=state;row.append(label,value);$('tool-status-list').append(row);});
    showStatus('telegram-status',tg.connected?`@${tg.bot} · Chat ${tg.chatId}${tg.error?' · 수신 연결 확인 필요':''}`:'Telegram 연결 후 메시지를 주고받을 수 있습니다.',!!tg.error);
    $('telegram-send').disabled=telegramSending||!tg.connected;syncShare();syncChat();demo()?.sync();updateBrowserButtons();
    const job=status.team?.activeJobId;if(job&&!resumed.has(job)&&demo()?.getAgents().length){resumed.add(job);demo().resumeTeam(job);}
  }
  async function refreshStatus(){
    if(statusLoading)return;statusLoading=true;const revision=connectionRevision;
    try{const fetched=await api('/api/showcase/status');if(revision===connectionRevision){status=fetched;renderConnections();}}
    catch{$('runtime-status').classList.remove('connected');$('runtime-status').lastChild.textContent=' 서버 연결 확인';status.gateway={};syncChat();demo()?.sync();}
    finally{statusLoading=false;}
  }
  async function configure(formId,statusId,path,body,keyId){
    const form=$(formId);if(form.dataset.pending)return;form.dataset.pending='true';++connectionRevision;
    const controls=[...form.querySelectorAll('input,button')];controls.forEach(b=>b.disabled=true);showStatus(statusId,'연결 확인 중...');
    try{const result=await api(path,body);const type=path.split('/').pop();status[type]=result;$(keyId).value='';if(type==='telegram'){telegramCursor=0;$('telegram-messages').replaceChildren();}else $('inbox-messages').replaceChildren();activity(type,body.disconnect?'연결 해제':'연결 완료');}
    catch(e){showStatus(statusId,e.message,true);return;}
    finally{delete form.dataset.pending;controls.forEach(b=>b.disabled=false);$('tg-disconnect').disabled=!status.telegram?.configured;$('mail-disconnect').disabled=!status.agentmail?.configured;$('gw-disconnect').disabled=!status.gateway?.configured;}
    renderConnections();if($('inbox-dialog').open){if($('message-telegram').hidden)loadInbox();else loadTelegram();}
  }
  $('telegram-form').onsubmit=e=>{e.preventDefault();configure('telegram-form','tg-status','/api/integrations/telegram',{token:$('tg-token').value.trim(),chatId:$('tg-chat').value.trim()},'tg-token');};
  $('mail-connect-form').onsubmit=e=>{e.preventDefault();configure('mail-connect-form','mail-status','/api/integrations/agentmail',{apiKey:$('mail-key').value.trim(),inboxId:$('mail-inbox').value.trim()},'mail-key');};
  $('tg-disconnect').onclick=()=>configure('telegram-form','tg-status','/api/integrations/telegram',{disconnect:true},'tg-token');
  $('mail-disconnect').onclick=()=>configure('mail-connect-form','mail-status','/api/integrations/agentmail',{disconnect:true},'mail-key');
  $('gateway-form').onsubmit=e=>{e.preventDefault();configure('gateway-form','gw-status','/api/showcase/gateway',{url:$('gw-url').value.trim(),token:$('gw-token').value.trim()},'gw-token');};
  $('gw-disconnect').onclick=()=>configure('gateway-form','gw-status','/api/showcase/gateway',{disconnect:true},'gw-token');
  $('settings-dialog').addEventListener('close',()=>{$('tg-token').value='';$('mail-key').value='';$('gw-token').value='';});
  const examples={news:'최근 일주일 NVIDIA와 로컬 AI 관련 주요 발표를 정리해줘. 발표 날짜와 출처도 알려줘.',compare:'DGX Spark와 Jetson을 비교해줘. 사용 목적, 실행할 수 있는 AI 작업, 선택할 때 고려할 점을 공식 자료로 확인해줘.',research:'로컬에서 AI 에이전트를 실행하는 실제 사례를 조사해줘. 사용한 도구와 활용 방식, 출처를 함께 정리해줘.'};
  function syncBrowserMode(){$('browser-source').querySelector('option[value=auto]').textContent=$('browser-mode').value==='search'?'자동 선택':'Naver + Daum';$('browser-query').maxLength=$('browser-mode').value==='search'?240:600;$('browser-run').textContent=$('browser-mode').value==='search'?'검색 시작':'조사 시작';}
  document.querySelectorAll('[data-research-example]').forEach(b=>b.onclick=()=>{if(browserRunning)return;$('browser-mode').value=b.dataset.researchExample;syncBrowserMode();$('browser-query').value=examples[b.dataset.researchExample];$('browser-source').value='auto';$('browser-query').focus();});
  $('browser-mode').onchange=syncBrowserMode;
  function openBrowser(){if(!$('browser-dialog').open)$('browser-dialog').showModal();}
  async function browse(query){if(browserRunning){openBrowser();return;}openBrowser();$('browser-query').value=query;$('browser-form').requestSubmit();}
  let renderedJob='',renderedEvents=0,documentSignature='';
  function renderSteps(job){
    $('browser-dialog').classList.toggle('research-complete',job.mode!=='search'&&job.status==='done');
    const trace=document.querySelector('.browser-trace'),stick=trace.scrollHeight-trace.scrollTop-trace.clientHeight<45;
    if(renderedJob!==job.id){renderedJob=job.id;renderedEvents=0;documentSignature='';$('browser-steps').replaceChildren();}
    job.events.slice(renderedEvents).forEach(step=>{const li=document.createElement('li'),time=document.createElement('time');li.textContent=step.text;time.textContent=new Date(step.at).toLocaleTimeString('ko-KR',{hour12:false});li.append(time);$('browser-steps').append(li);});renderedEvents=job.events.length;if(stick)trace.scrollTop=trace.scrollHeight;
    $('browser-address').textContent=job.url;$('browser-live').textContent=job.status==='running'?'진행 중':job.status==='done'?'완료':'오류';
    if(job.screenshot&&$('browser-frame').dataset.revision!==String(job.revision)){$('browser-frame').src=job.screenshot;$('browser-frame').dataset.revision=String(job.revision);$('browser-frame').hidden=false;$('browser-empty').hidden=true;}
    $('browser-note').textContent=job.error||job.note||(job.status==='done'?`${job.results.length}개 후보`:'조사 중...');
    if(job.plan){$('browser-plan').hidden=false;$('browser-plan').textContent=(job.plan.method==='ai'?'질문을 나눈 검색어: ':'사용한 검색어: ')+job.plan.queries.join(' / ');}
    const signature=JSON.stringify(job.documents||[]);if(signature!==documentSignature){documentSignature=signature;renderDocuments(job);}
  }
  function validLink(url){try{const u=new URL(url);return ['http:','https:'].includes(u.protocol)?u.href:null;}catch{return null;}}
  function renderDocuments(job){
    $('browser-documents').replaceChildren();$('browser-evidence').hidden=!job.documents?.length;
    (job.documents||[]).forEach(d=>{const card=document.createElement('article'),title=document.createElement('a'),state=document.createElement('small'),body=document.createElement('p');card.className='evidence-card';title.textContent=`[${d.id}] ${d.title}`;const href=validLink(d.url);if(href){title.href=href;title.target='_blank';title.rel='noopener noreferrer';}state.textContent=(href?new URL(href).hostname+' · ':'')+(d.status==='read'?`본문 읽음${d.published?' · 게시일 '+d.published:' · 게시일 미확인'}`:d.status==='reading'?'읽는 중...':'본문 읽기 실패');state.classList.toggle('error',d.status==='unavailable');body.textContent=d.status==='read'?d.excerpt||'':d.error||'';card.append(title,state,body);$('browser-documents').append(card);});
  }
  function renderAnswer(text,job){
    const root=$('browser-summary-text');root.replaceChildren();
    for(const line of String(text).split('\n')){
      const node=document.createElement(/^#{1,3}\s/.test(line)?'h4':'p');
      const plain=line.replace(/^#{1,3}\s/,'');const pattern=/\*\*([^*]+)\*\*|\[(\d+)\]/g;let last=0;
      for(const match of plain.matchAll(pattern)){node.append(document.createTextNode(plain.slice(last,match.index)));if(match[1]){const strong=document.createElement('strong');strong.textContent=match[1];node.append(strong);}else{const doc=job.documents?.find(d=>d.id===Number(match[2])&&d.status==='read');const a=document.createElement(doc&&validLink(doc.url)?'a':'span');a.textContent=match[0];if(doc&&validLink(doc.url)){a.href=doc.url;a.target='_blank';a.rel='noopener noreferrer';a.className='source-citation';}node.append(a);}last=match.index+match[0].length;}node.append(document.createTextNode(plain.slice(last)));root.append(node);
    }
  }
  function renderSummary(job){
    if(job.mode==='search'&&!job.summary&&!job.summaryError)return;
    $('browser-summary').hidden=false;$('browser-limitations').replaceChildren();
    if(job.summary?.answer){browserSummary=job.summary.answer;renderAnswer(job.summary.answer,job);for(const text of job.summary.limitations||[]){const li=document.createElement('li');li.textContent=text;$('browser-limitations').append(li);}}
    else{$('browser-summary-text').textContent=job.summaryError||'조사 결과를 정리하고 있습니다.';if(!canRun('web-summary')){const b=document.createElement('button');b.className='quiet-button';b.textContent='AI 연결';b.onclick=()=>openSettings('gateway');$('browser-summary-text').append(document.createElement('br'),b);}}
    for(const warning of new Set([...(job.warnings||[]),...(job.searches||[]).filter(s=>s.error).map(s=>s.source+': '+s.error)])){const li=document.createElement('li');li.textContent=warning;$('browser-limitations').append(li);}
    if($('browser-dialog').open)$('browser-summary').scrollIntoView({block:'nearest'});
  }
  function browserText(job){const docs=(job.documents||[]).filter(d=>d.status==='read');return `조사 요청: ${job.query}\n\n`+(browserSummary?browserSummary+'\n\n':'')+(docs.length?'읽은 근거:\n'+docs.map(d=>`[${d.id}] ${d.title}\n${d.url}${d.published?'\n게시일: '+d.published:''}${!browserSummary&&d.excerpt?'\n원문 발췌: '+d.excerpt:''}`).join('\n\n'):job.results.map((r,i)=>`${i+1}. ${r.title}\n${r.url}`).join('\n\n'));}
  function updateBrowserButtons(){const usable=browserJob?.status==='done'&&browserJob.results.length>0,read=browserJob?.mode==='search'||browserJob?.documents?.some(d=>d.status==='read');$('browser-summary-run').disabled=!usable||!read||summaryRunning;$('browser-summary-run').textContent=browserJob?.summary?'결과 다시 정리':'AI로 정리';$('browser-share').disabled=!usable;}
  function renderResults(job){
    $('browser-results').replaceChildren();job.results.forEach(r=>{const href=validLink(r.url);if(!href)return;const link=document.createElement('a'),host=document.createElement('small');link.className='result-card';link.textContent=r.title;link.href=href;host.textContent=new URL(href).hostname+(r.searchSources?.length?' · '+r.searchSources.join(', '):'');link.append(host);link.target='_blank';link.rel='noopener noreferrer';$('browser-results').append(link);});$('browser-candidates').hidden=!job.results.length;$('browser-candidates').querySelector('summary').textContent=`검색 후보 (${job.results.length})`;$('browser-candidates').open=job.mode==='search';updateBrowserButtons();
  }
  $('browser-form').onsubmit=async e=>{
    e.preventDefault();if(browserRunning)return;browserRunning=true;browserJob=null;browserSummary='';++summaryRevision;summaryRunning=false;$('browser-dialog').classList.remove('research-complete');
    [...$('browser-form').elements,...$('browser-examples').querySelectorAll('button')].forEach(b=>b.disabled=true);updateBrowserButtons();$('browser-summary').hidden=true;$('browser-evidence').hidden=true;$('browser-candidates').hidden=true;$('browser-plan').hidden=true;$('browser-limitations').replaceChildren();$('browser-documents').replaceChildren();$('browser-steps').replaceChildren();$('browser-results').replaceChildren();$('browser-frame').hidden=true;delete $('browser-frame').dataset.revision;$('browser-empty').hidden=false;$('browser-note').textContent='조사 시작 중...';$('browser-live').textContent='연결 중';
    let eventCount=0;
    try{
      browserJob=await api('/api/browser/jobs',{query:$('browser-query').value.trim(),provider:$('browser-source').value,mode:$('browser-mode').value});
      const end=Date.now()+300000;let failures=0;while(Date.now()<end){renderSteps(browserJob);browserJob.events.slice(eventCount).forEach(s=>activity('브라우저',s.text));eventCount=browserJob.events.length;if(browserJob.status!=='running')break;await new Promise(r=>setTimeout(r,600));try{browserJob=await api('/api/browser/jobs/'+browserJob.id);failures=0;}catch(err){if(++failures>=5)throw err;}}
      renderSteps(browserJob);renderResults(browserJob);if(browserJob.status==='running')throw new Error('조사가 지연되고 있습니다. 실행 기록을 확인해주세요.');if(browserJob.status==='error')throw new Error(browserJob.error);renderSummary(browserJob);
    }catch(error){$('browser-note').textContent=error.message;$('browser-live').textContent='오류';activity('브라우저',error.message);}
    finally{browserRunning=false;[...$('browser-form').elements,...$('browser-examples').querySelectorAll('button')].forEach(b=>b.disabled=false);updateBrowserButtons();}
  };
  $('browser-summary-run').onclick=async()=>{
    if(!browserJob?.results.length||summaryRunning)return;$('browser-summary').hidden=false;
    if(!canRun('web-summary')){$('browser-summary-text').textContent='AI 정리에 OpenClaw 연결이 필요합니다.';const b=document.createElement('button');b.className='quiet-button';b.textContent='AI 연결';b.onclick=()=>openSettings('gateway');$('browser-summary-text').append(document.createElement('br'),b);return;}
    const job=browserJob,revision=summaryRevision;summaryRunning=true;updateBrowserButtons();$('browser-summary-text').textContent='읽은 근거를 정리하고 있습니다...';
    try{const data=await window.DemoAPI.task({agent:'web-summary',searchJobId:job.id,messages:[{role:'user',content:job.query}]});if(data.error)throw new Error(data.error);if(revision===summaryRevision){job.summary={answer:data.reply,limitations:data.limitations||[]};browserSummary=data.reply;renderSummary(job);activity('브라우저','근거를 포함한 결과 정리 완료');}}
    catch(e){if(revision===summaryRevision)$('browser-summary-text').textContent=e.message;}
    finally{if(revision===summaryRevision){summaryRunning=false;updateBrowserButtons();}}
  };
  $('browser-share').onclick=()=>openShare(status.telegram?.connected?'telegram':status.agentmail?.connected?'agentmail':'telegram',browserText(browserJob));
  async function loadInbox(){
    if(inboxLoading)return;inboxLoading=true;const revision=connectionRevision;$('inbox-refresh').disabled=true;$('inbox-status').textContent='받은편지함 확인 중...';$('inbox-messages').replaceChildren();
    try{const data=await api('/api/integrations/agentmail/messages');if(revision!==connectionRevision)return;$('inbox-status').textContent=data.messages.length?`${data.messages.length}개 메시지 · 최신순`:'아직 받은 메시지가 없습니다.';data.messages.forEach(m=>{const item=document.createElement('article'),title=document.createElement('strong'),meta=document.createElement('small'),body=document.createElement('p');item.className='inbox-item';title.textContent=m.subject;meta.textContent=[Array.isArray(m.from)?m.from.join(', '):m.from,m.at?new Date(m.at).toLocaleString('ko-KR'):''].filter(Boolean).join(' · ');body.textContent=m.preview;item.append(title,meta,body);$('inbox-messages').append(item);});activity('AgentMail',`${data.messages.length}개 메일 확인`);}
    catch(e){if(revision!==connectionRevision)return;$('inbox-status').textContent=e.message;const b=document.createElement('button');b.className='quiet-button';b.textContent='AgentMail 연결 설정';b.onclick=()=>openSettings('agentmail');$('inbox-messages').append(b);}
    finally{inboxLoading=false;$('inbox-refresh').disabled=false;}
  }
  function telegramMessage(from,text){const item=document.createElement('article'),name=document.createElement('small'),content=document.createElement('p');item.className='inbox-item';name.textContent=from;content.textContent=text;item.append(name,content);$('telegram-messages').append(item);while($('telegram-messages').children.length>100)$('telegram-messages').firstElementChild.remove();$('telegram-messages').scrollTop=$('telegram-messages').scrollHeight;}
  async function loadTelegram(){
    if(telegramLoading||!status.telegram?.connected||!$('inbox-dialog').open||$('message-telegram').hidden)return;
    telegramLoading=true;const revision=connectionRevision;
    try{const data=await api('/api/integrations/telegram/messages?since='+telegramCursor);if(revision!==connectionRevision)return;data.messages.forEach(m=>telegramMessage(m.from,m.text));telegramCursor=data.lastId;}
    catch(e){if(revision===connectionRevision)showStatus('telegram-status',e.message,true);}
    finally{telegramLoading=false;}
  }
  function selectMessageTab(tab){
    document.querySelectorAll('[data-message-tab]').forEach(b=>{const active=b.dataset.messageTab===tab;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;$('message-'+b.dataset.messageTab).hidden=!active;});clearInterval(telegramTimer);
    if(tab==='mail')loadInbox();else{loadTelegram();telegramTimer=setInterval(loadTelegram,2000);}
  }
  function openInbox(){if(!$('inbox-dialog').open)$('inbox-dialog').showModal();selectMessageTab($('message-telegram').hidden?'mail':'telegram');refreshStatus();}
  bindTabs('data-message-tab',selectMessageTab);$('inbox-dialog').addEventListener('close',()=>clearInterval(telegramTimer));
  $('inbox-refresh').onclick=loadInbox;$('mail-new').onclick=()=>openShare('agentmail','');$('telegram-settings').onclick=()=>openSettings('telegram');
  $('telegram-chat-form').onsubmit=async e=>{
    e.preventDefault();if(telegramSending)return;if(!status.telegram?.connected){openSettings('telegram');return;}
    const text=$('telegram-text').value.trim();if(!text)return;telegramSending=true;$('telegram-send').disabled=true;$('telegram-text').disabled=true;
    try{await api('/api/integrations/telegram/send',{text});telegramMessage('나',text);$('telegram-text').value='';activity('Telegram','메시지 전송 완료');}
    catch(e){showStatus('telegram-status',e.message,true);}
    finally{telegramSending=false;$('telegram-text').disabled=false;$('telegram-send').disabled=!status.telegram?.connected;}
  };
  function syncShare(){const mail=$('share-channel').value==='agentmail';$('share-email-fields').hidden=!mail;$('share-to').required=mail;$('share-subject').required=mail;$('share-text').maxLength=mail?20000:4000;$('share-destination').textContent=mail?`보내는 주소: ${status.agentmail?.connected?status.agentmail.inboxId:'AgentMail 연결 필요'}`:`받는 Chat ID: ${status.telegram?.connected?status.telegram.chatId:'Telegram 연결 필요'}`;}
  function openShare(channel,text){
    if(shareSending){toast('전송이 끝날 때까지 기다려주세요.');return;}const value=text===undefined?results.get(demo().getActive()?.name):text;if(value===undefined){toast('공유할 결과가 아직 없습니다.');return;}
    $('share-channel').value=channel;$('share-text').value=value;showStatus('share-status','');syncShare();if(!$('share-dialog').open)$('share-dialog').showModal();
  }
  $('share-channel').onchange=syncShare;$('share-telegram').onclick=()=>openShare('telegram');$('share-mail').onclick=()=>openShare('agentmail');
  $('share-form').onsubmit=async e=>{
    e.preventDefault();if(shareSending)return;const channel=$('share-channel').value;
    if(!status[channel]?.connected){showStatus('share-status','먼저 연결 설정을 완료해주세요.',true);openSettings(channel);return;}
    const body=channel==='telegram'?{text:$('share-text').value}:{to:$('share-to').value.trim(),subject:$('share-subject').value.trim(),text:$('share-text').value};shareSending=true;const controls=[...$('share-form').elements];controls.forEach(b=>b.disabled=true);showStatus('share-status','전송 중...');
    try{const data=await api('/api/integrations/'+channel+'/send',body);showStatus('share-status',`전송 완료 · ${data.messageId}`);activity(channel,'전송 완료');if(!$('share-dialog').open)toast('전송이 완료되었습니다.');}
    catch(e){showStatus('share-status',e.message,true);if(!$('share-dialog').open)toast(e.message);}
    finally{shareSending=false;controls.forEach(b=>b.disabled=false);}
  };
  window.BacShowcase={browse,inbox:openInbox,settings:openSettings,canRun};refreshStatus();
  setInterval(()=>{if(!document.hidden)refreshStatus();},15000);
})();
