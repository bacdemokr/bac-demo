/* Tools and explicit messaging actions. Credentials remain on the server. */
(() => {
  const $=id=>document.getElementById(id), demo=()=>window.BacDemo, api=window.DemoAPI.request;
  const results=new Map(), resumed=new Set();
  let status={}, connectionRevision=0, statusLoading=false, toastTimer;
  let browserJob=null, browserRunning=false, browserSummary='', summaryRevision=0, summaryRunning=false;
  let inboxLoading=false, telegramLoading=false, telegramSending=false, telegramCursor=0, telegramTimer;
  let shareSending=false;
  let githubSearching=false,githubForking=false,githubCandidates=[];
  const connectionEditing={telegram:false,agentmail:false,github:false};
  const connectionFields={telegram:{prefix:'tg',form:'telegram-form',key:'tg-token',button:'Telegram 연결'},agentmail:{prefix:'mail',form:'mail-connect-form',key:'mail-key',button:'AgentMail 연결'},github:{prefix:'gh',form:'github-form',key:'gh-token',button:'GitHub 연결'}};
  const roles={sysmon:'시스템 상태 · 로컬 도구',github:'GitHub 작업 · OpenClaw MCP',multiagent:'PM / Dev 협업 · GitHub',arxiv:'논문 리서치 · arXiv RSS'};
  const canRun=id=>!!(status.gateway?.reachable&&status.gateway?.configured&&(id!=='github'||status.gateway?.agents?.git!==false||status.github?.connected)&&(id!=='multiagent'||status.team?.configured&&!githubForking&&!status.github?.forking));
  const githubRole=()=>status.gateway?.agents?.git===false?'저장소 조회 · GitHub API':roles.github;
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
    if(a&&!canRun(a.id)){const text=document.createElement('span');text.textContent=a.id==='multiagent'&&status.gateway?.configured&&status.gateway?.reachable?'협업에 필요한 GitHub 연결을 확인해주세요.':a.id==='github'&&status.gateway?.agents?.git===false?'GitHub 도구가 설정된 AI 에이전트가 없습니다.':'AI 서비스의 자동 연결을 확인하고 있습니다.';banner.append(text);}
    const hasResult=!!results.get(a?.name);$('share-telegram').disabled=!hasResult;$('share-mail').disabled=!hasResult;
    $('input').disabled=!!a?.busy||!a||!canRun(a.id);$('input').placeholder=a?.busy?'작업 진행 중...':'메시지 입력';
    document.querySelectorAll('#agent-actions button').forEach(b=>b.disabled=!!a?.busy||!!a?.paperLoading||!a||(b.hasAttribute('data-ai')&&!canRun(a.id)));
  }
  window.addEventListener('bac:ready',e=>roster(e.detail));if(demo()?.getAgents().length)roster(demo().getAgents());
  window.addEventListener('bac:activity',e=>activity(e.detail.agent,e.detail.text));
  window.addEventListener('bac:result',e=>{if(e.detail.text)results.set(e.detail.agent,e.detail.text);syncChat();});
  window.addEventListener('bac:state',syncChat);
  window.addEventListener('bac:agent',e=>{
    const a=e.detail;$('agent-actions').replaceChildren();if(!a){syncChat();return;}$('chat-role').textContent=a.id==='github'?githubRole():roles[a.id]||a.role;
    const button=(text,fn,ai=false)=>{const b=document.createElement('button');b.textContent=text;b.onclick=fn;if(ai)b.dataset.ai='true';$('agent-actions').append(b);};
    if(a.id==='sysmon')button('상태 새로고침',()=>demo().refreshSystem());
    if(a.id==='github'){button('저장소 조회',()=>demo().runTurn(a,'내 GitHub 저장소 목록을 조회해줘.'),true);button('공개 저장소 Fork',()=>openSettings('github'));}
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
  function openSettings(tab='telegram'){if(tab==='gateway')tab='tools';selectTab(tab);if(!$('settings-dialog').open)$('settings-dialog').showModal();refreshStatus();}
  $('settings-open').onclick=()=>{demo().closeChat({restoreFocus:false});openSettings();};bindTabs('data-tab',selectTab);
  function showStatus(id,text,error=false){$(id).textContent=text;$(id).classList.toggle('error',error);}
  function renderConnectionCards(){
    for(const [type,fields]of Object.entries(connectionFields)){
      const c=status[type]||{},known=Object.hasOwn(status,type),editing=connectionEditing[type],p=fields.prefix,form=$(fields.form),pending=!!form.dataset.pending;
      const card=$(p+'-connection-card');card.hidden=!c.configured;form.hidden=!known||!!c.configured&&!editing;
      form.toggleAttribute('data-credential-editor',!!c.configured&&editing);
      const note=$(p+'-setup-note');if(note)note.hidden=form.hidden;
      $(p+'-status').hidden=!!c.connected&&!c.error&&!editing&&!pending;
      if(!known)showStatus(p+'-status','연결 상태 확인 중...');
      const state=c.error?'warning':c.connected?'connected':'pending';card.dataset.state=state;
      $(p+'-connection-label').textContent=state==='connected'?'연결됨':state==='warning'?'설정됨 · 연결 확인 필요':'설정됨 · 연결 확인 중';
      $(p+'-connection-icon').textContent=state==='connected'?'✓':state==='warning'?'!':'…';
      $(p+'-connection-identity').textContent=type==='github'?c.login?'@'+c.login:'GitHub 계정':type==='agentmail'?c.inboxId||'AgentMail 받은편지함':c.bot?'@'+c.bot:'Telegram 봇';
      const source={config:'api.json에서 자동 설정',runtime:'화면에서 입력한 연결 정보',file:'토큰 파일에서 자동 설정',environment:'환경 설정에서 자동 설정'}[c.source]||'등록된 연결 정보';
      $(p+'-connection-source').textContent=source+(c.connected?' · 인증 확인됨':' · 키 등록됨');
      const target=$(p+'-connection-target');target.textContent=type==='github'&&c.repo?'작업 저장소 · '+c.owner+'/'+c.repo:type==='telegram'&&c.chatId?'Chat ID · '+c.chatId:'';target.hidden=!target.textContent;
      const edit=document.querySelector(`[data-connection-edit="${type}"]`);edit.setAttribute('aria-expanded',String(editing));edit.disabled=pending;
      const cancel=document.querySelector(`[data-connection-cancel="${type}"]`);cancel.hidden=!c.configured;cancel.disabled=pending;
      form.querySelector('button[type=submit]').textContent=c.configured?'연결 정보 적용':fields.button;
      $(p+'-disconnect').disabled=!c.configured||pending;
    }
  }
  document.querySelectorAll('[data-connection-edit]').forEach(button=>button.onclick=()=>{const type=button.dataset.connectionEdit;connectionEditing[type]=true;renderConnectionCards();$(connectionFields[type].key).focus();});
  document.querySelectorAll('[data-connection-cancel]').forEach(button=>button.onclick=()=>{const type=button.dataset.connectionCancel;connectionEditing[type]=false;$(connectionFields[type].key).value='';const c=status[type]||{};if(type==='github')$('gh-repository').value=c.repo?c.owner+'/'+c.repo:'';if(type==='telegram')$('tg-chat').value=c.chatId||'';if(type==='agentmail')$('mail-inbox').value=c.inboxId||'';renderConnections();document.querySelector(`[data-connection-edit="${type}"]`).focus();});
  function renderConnections(){
    const tg=status.telegram||{},mail=status.agentmail||{},gh=status.github||{},gw=status.gateway||{};
    const source=c=>({runtime:'화면 입력',config:'api.json',file:'파일 설정',environment:'환경 설정'}[c.source]||'');
    const sourceNote=c=>source(c)?' · '+source(c):'';
    if(!connectionEditing.telegram&&document.activeElement!==$('tg-chat')&&!$('tg-chat').value)$('tg-chat').value=tg.chatId||'';
    if(!connectionEditing.agentmail&&document.activeElement!==$('mail-inbox')&&!$('mail-inbox').value)$('mail-inbox').value=mail.inboxId||'';
    if(!connectionEditing.github&&document.activeElement!==$('gh-repository')&&!$('gh-repository').value&&gh.owner&&gh.repo)$('gh-repository').value=gh.owner+'/'+gh.repo;
    if(!$('telegram-form').dataset.pending)showStatus('tg-status',tg.connected?`@${tg.bot} · Chat ${tg.chatId}${sourceNote(tg)}${tg.error?' · 수신 연결 확인 필요':''}`:tg.error||(tg.configured?'연결 확인 중...':'연결 전'),!!tg.error);
    if(!$('mail-connect-form').dataset.pending)showStatus('mail-status',mail.connected?`연결됨 · ${mail.inboxId}${sourceNote(mail)}`:mail.error||(mail.configured?'연결 확인 중...':'연결 전'),!!mail.error);
    if(!$('github-form').dataset.pending)showStatus('gh-status',gh.connected?`연결됨 · ${gh.repo?gh.owner+'/'+gh.repo:'@'+gh.login}${sourceNote(gh)}${gh.repo&&!gh.canWrite?' · 저장소 쓰기 불가':''}`:gh.error|| (gh.configured?'연결 확인 중...':'연결 전'),!!gh.error);
    $('gh-search').disabled=$('gh-random').disabled=githubSearching||githubForking||!gh.connected;
    $('gh-fork-action').disabled=githubForking||!!gh.forking||!gh.connected||!$('gh-source').value;
    $('gh-work').hidden=!gh.canWrite||githubForking||!!gh.forking;
    $('tg-disconnect').disabled=!!$('telegram-form').dataset.pending||!tg.configured;$('mail-disconnect').disabled=!!$('mail-connect-form').dataset.pending||!mail.configured;
    $('gh-disconnect').disabled=!!$('github-form').dataset.pending||!gh.configured;
    renderConnectionCards();
    const runtime=canRun('web-summary');$('runtime-status').classList.toggle('connected',runtime);$('runtime-status').lastChild.textContent=runtime?' AI 연결됨':' AI 서비스 확인 필요';
    $('tool-status-list').replaceChildren();
    const rows=[['AI 실행 서비스',runtime?'자동 연결됨':gw.error||'실행 상태 확인 필요'],['브라우저 · CDP',status.browser?.connected?'연결됨':'브라우저 실행 필요'],['GitHub API',gh.connected?gh.repo?`${gh.owner}/${gh.repo}`:'@'+gh.login:gh.error||'연결 전'],['GitHub MCP',gw.agents?.git===false?'설정된 에이전트 없음':'OpenClaw의 git 에이전트에서 설정'],['PM / Dev 협업',status.team?.configured?`설정됨 · ${status.team.repository}`:gh.connected&&!gh.repo?'공개 저장소를 Fork한 뒤 작업 가능':'OpenClaw 및 GitHub 토큰 필요'],['Telegram',tg.connected?'연결됨':'연결 전'],['AgentMail',mail.connected?'연결됨':'연결 전']];
    rows.forEach(([name,state])=>{const row=document.createElement('div'),label=document.createElement('span'),value=document.createElement('small');row.className='tool-row';label.textContent=name;value.textContent=state;row.append(label,value);$('tool-status-list').append(row);});
    showStatus('telegram-status',tg.connected?`@${tg.bot} · Chat ${tg.chatId}${tg.error?' · 수신 연결 확인 필요':''}`:tg.error||'Telegram 연결 후 메시지를 주고받을 수 있습니다.',!!tg.error);
    $('telegram-send').disabled=telegramSending||!tg.connected;if(demo()?.getActive()?.id==='github')$('chat-role').textContent=githubRole();syncShare();syncChat();demo()?.sync();updateBrowserButtons();
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
    renderConnectionCards();
    try{const result=await api(path,body);const type=path.split('/').pop();status[type]=result;connectionEditing[type]=false;$(keyId).value='';if(type==='telegram'){telegramCursor=0;$('telegram-messages').replaceChildren();}else if(type==='agentmail')$('inbox-messages').replaceChildren();else if(type==='github')status.team={...status.team,configured:!!status.gateway?.configured&&result.connected&&result.canWrite,repository:result.repo?result.owner+'/'+result.repo:''};activity(type,body.disconnect?'연결 해제':'연결 완료');}
    catch(e){showStatus(statusId,e.message,true);return;}
    finally{delete form.dataset.pending;controls.forEach(b=>b.disabled=false);renderConnectionCards();}
    renderConnections();if($('inbox-dialog').open){if($('message-telegram').hidden)loadInbox();else loadTelegram();}
  }
  $('telegram-form').onsubmit=e=>{e.preventDefault();configure('telegram-form','tg-status','/api/integrations/telegram',{token:$('tg-token').value.trim(),chatId:$('tg-chat').value.trim()},'tg-token');};
  $('mail-connect-form').onsubmit=e=>{e.preventDefault();configure('mail-connect-form','mail-status','/api/integrations/agentmail',{apiKey:$('mail-key').value.trim(),inboxId:$('mail-inbox').value.trim()},'mail-key');};
  $('github-form').onsubmit=e=>{e.preventDefault();const value=$('gh-repository').value.trim(),[owner,repo]=value.split('/');configure('github-form','gh-status','/api/integrations/github',{token:$('gh-token').value.trim(),...(value?{owner,repo}:{})},'gh-token');};
  const showGithubSource=()=>{const r=githubCandidates.find(r=>r.name===$('gh-source').value);$('gh-source-info').textContent=r?r.description:'';renderConnections();};
  async function findGithub(random=false){
    if(githubSearching||githubForking)return;githubSearching=true;renderConnections();showStatus('gh-fork-status','공개 저장소 검색 중...');
    try{
      const data=await api('/api/integrations/github/repositories?q='+encodeURIComponent(random?'':$('gh-query').value.trim()));githubCandidates=data.repositories;$('gh-source').replaceChildren();
      if(!githubCandidates.length){const o=document.createElement('option');o.value='';o.textContent='검색 결과가 없습니다';$('gh-source').append(o);}
      for(const r of githubCandidates){const o=document.createElement('option');o.value=r.name;o.textContent=r.name+' · ★ '+r.stars;$('gh-source').append(o);}
      $('gh-source').disabled=!githubCandidates.length;if(random&&githubCandidates.length)$('gh-source').selectedIndex=Math.floor(Math.random()*githubCandidates.length);showGithubSource();showStatus('gh-fork-status',githubCandidates.length?'저장소를 확인하고 Fork를 눌러주세요.':'다른 검색어로 찾아보세요.');
    }catch(error){showStatus('gh-fork-status',error.message,true);}finally{githubSearching=false;renderConnections();}
  }
  $('gh-search-form').onsubmit=e=>{e.preventDefault();findGithub();};$('gh-random').onclick=()=>findGithub(true);$('gh-source').onchange=showGithubSource;
  $('gh-fork-action').onclick=async()=>{
    if(githubForking)return;githubForking=true;renderConnections();showStatus('gh-fork-status','Fork 요청 중...');$('gh-fork-link').hidden=true;
    try{
      const started=await api('/api/integrations/github/forks',{repository:$('gh-source').value});
      const deadline=Date.now()+90000;let job;
      do{job=await api('/api/integrations/github/forks/'+started.id);showStatus('gh-fork-status',job.step);if(job.url){$('gh-fork-link').href=job.url;$('gh-fork-link').hidden=false;}if(job.status!=='running')break;await new Promise(resolve=>setTimeout(resolve,500));}while(Date.now()<deadline);
      if(job.status!=='done')throw new Error(job.error||'Fork 준비를 기다리고 있습니다. GitHub에서 상태를 확인해주세요.');
      ++connectionRevision;status.github=await api('/api/integrations/github');status.team={...status.team,configured:!!status.gateway?.configured&&status.github.canWrite,repository:job.repository};$('gh-repository').value=job.repository;activity('GitHub','Fork 완료 · '+job.repository);showStatus('gh-fork-status','Fork 완료 · '+job.repository);
    }catch(error){showStatus('gh-fork-status',error.message,true);}finally{githubForking=false;renderConnections();}
  };
  $('gh-work').onclick=()=>{$('settings-dialog').close();demo().openAgent('multiagent');$('input').focus();};
  $('tg-disconnect').onclick=()=>configure('telegram-form','tg-status','/api/integrations/telegram',{disconnect:true},'tg-token');
  $('mail-disconnect').onclick=()=>configure('mail-connect-form','mail-status','/api/integrations/agentmail',{disconnect:true},'mail-key');
  $('gh-disconnect').onclick=()=>configure('github-form','gh-status','/api/integrations/github',{disconnect:true},'gh-token');
  $('settings-dialog').addEventListener('close',()=>{for(const [type,fields]of Object.entries(connectionFields)){connectionEditing[type]=false;$(fields.key).value='';}renderConnectionCards();});
  const examples={amazon:'USB C hub',news:'최근 일주일 NVIDIA와 로컬 AI 관련 주요 발표를 정리해줘. 발표 날짜와 출처도 알려줘.',research:'로컬에서 AI 에이전트를 실행하는 실제 사례를 조사해줘. 사용한 도구와 활용 방식, 출처를 함께 정리해줘.'};
  function syncBrowserMode(){
    const mode=$('browser-mode').value,food=mode==='restaurants',amazon=mode==='amazon';
    $('restaurant-fields').hidden=!food;$('browser-question-fields').hidden=food;$('browser-examples').hidden=food;
    $('browser-query').disabled=food||browserRunning;$('browser-query').required=!food;$('browser-query').maxLength=amazon?240:600;
    $('browser-query-label').textContent=amazon?'상품 검색어':'조사할 질문';$('browser-query').placeholder=amazon?'예: USB C hub, mechanical keyboard':'궁금한 내용과 원하는 결과를 적어주세요.';
    $('browser-source').hidden=amazon;$('browser-source').disabled=amazon||browserRunning;
    for(const id of ['restaurant-region','restaurant-menu']){$(id).disabled=!food||browserRunning;$(id).required=food;}
    const labels=food?{auto:'네이버 + 카카오',naver:'네이버지도',daum:'카카오맵'}:{auto:mode==='search'?'자동 선택':'Naver + Daum',naver:'Naver',daum:'Daum'};
    for(const option of $('browser-source').options)option.textContent=labels[option.value];
    $('browser-run').textContent=food?'맛집 검색':amazon?'상품 검색':'조사 시작';
    $('browser-summary-run').hidden=['restaurants','amazon'].includes(browserJob?.mode||mode);
  }
  document.querySelectorAll('[data-research-example]').forEach(b=>b.onclick=()=>{if(browserRunning)return;$('browser-mode').value=b.dataset.researchExample;syncBrowserMode();queryMode=b.dataset.researchExample;$('browser-query').value=examples[b.dataset.researchExample];$('browser-source').value='auto';$('browser-query').focus();});
  const browserDrafts={research:$('browser-query').value,news:examples.news,amazon:examples.amazon};let queryMode='research';
  $('browser-mode').onchange=()=>{browserDrafts[queryMode]=$('browser-query').value;const next=$('browser-mode').value;if(next!=='restaurants'){queryMode=next;$('browser-query').value=browserDrafts[next]||'';}syncBrowserMode();};
  function openBrowser(){if(!$('browser-dialog').open)$('browser-dialog').showModal();}
  async function browse(query){if(browserRunning){openBrowser();return;}openBrowser();if(['restaurants','amazon'].includes($('browser-mode').value)){$('browser-mode').value='research';syncBrowserMode();}queryMode='research';$('browser-query').value=query;$('browser-form').requestSubmit();}
  let renderedJob='',renderedEvents=0,documentSignature='';
  function renderSteps(job){
    $('browser-dialog').classList.toggle('research-complete',job.mode!=='search'&&job.status==='done');
    const trace=document.querySelector('.browser-trace'),stick=trace.scrollHeight-trace.scrollTop-trace.clientHeight<45;
    if(renderedJob!==job.id){renderedJob=job.id;renderedEvents=0;documentSignature='';$('browser-steps').replaceChildren();}
    job.events.slice(renderedEvents).forEach(step=>{const li=document.createElement('li'),time=document.createElement('time');li.textContent=step.text;time.textContent=new Date(step.at).toLocaleTimeString('ko-KR',{hour12:false});li.append(time);$('browser-steps').append(li);});renderedEvents=job.events.length;if(stick)trace.scrollTop=trace.scrollHeight;
    $('browser-address').textContent=job.url;$('browser-live').textContent=job.status==='running'?'진행 중':job.status==='done'?'완료':'오류';
    if(job.screenshot&&$('browser-frame').dataset.revision!==String(job.revision)){$('browser-frame').src=job.screenshot;$('browser-frame').dataset.revision=String(job.revision);$('browser-frame').hidden=false;$('browser-empty').hidden=true;}
    $('browser-note').textContent=job.error||job.note||(job.status==='done'?`${job.results.length}개 후보`:'조사 중...');
    if(job.plan){
      const root=$('browser-plan');root.hidden=false;root.replaceChildren();
      job.plan.queries.forEach(query=>{const chip=document.createElement('span');chip.className='query-chip';chip.textContent=query;root.append(chip);});
      if(job.plan.timeRange){const period=document.createElement('small');period.textContent=`기간: ${job.plan.timeRange.start} - ${job.plan.timeRange.end}`;root.append(period);}
    }
    const signature=JSON.stringify(job.documents||[]);if(signature!==documentSignature){documentSignature=signature;renderDocuments(job);}
  }
  function validLink(url){try{const u=new URL(url);return ['http:','https:'].includes(u.protocol)?u.href:null;}catch{return null;}}
  function renderDocuments(job){
    $('browser-documents').replaceChildren();$('browser-evidence').hidden=!job.documents?.length;
    (job.documents||[]).forEach(d=>{const card=document.createElement('article'),title=document.createElement('a'),state=document.createElement('small'),body=document.createElement('p');card.className='evidence-card';card.classList.toggle('excluded',d.status==='excluded');title.textContent=`[${d.id}] ${d.title}`;const href=validLink(d.url);if(href){title.href=href;title.target='_blank';title.rel='noopener noreferrer';}state.textContent=(href?new URL(href).hostname+' · ':'')+(d.status==='read'?`본문 읽음${d.published?' · 게시일 '+d.published:' · 게시일 미확인'}`:d.status==='reading'?'읽는 중...':d.status==='excluded'?'근거에서 제외':'본문 읽기 실패');state.classList.toggle('error',d.status==='unavailable'||d.status==='excluded');body.textContent=d.status==='read'?d.excerpt||'':d.error||'';card.append(title,state,body);$('browser-documents').append(card);});
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
    if(job.mode==='restaurants'){renderRestaurants(job);return;}
    if(job.mode==='amazon'){$('browser-summary').hidden=true;return;}
    if(job.mode==='search'&&!job.summary&&!job.summaryError)return;
    $('browser-summary').hidden=false;$('browser-limitations').replaceChildren();
    if(job.summary?.answer){browserSummary=job.summary.answer;renderAnswer(job.summary.answer,job);for(const text of job.summary.limitations||[]){const li=document.createElement('li');li.textContent=text;$('browser-limitations').append(li);}}
    else{$('browser-summary-text').textContent=job.summaryError||'조사 결과를 정리하고 있습니다.';}
    for(const warning of new Set([...(job.warnings||[]),...(job.searches||[]).filter(s=>s.error).map(s=>s.source+': '+s.error)])){const li=document.createElement('li');li.textContent=warning;$('browser-limitations').append(li);}
    if($('browser-dialog').open)$('browser-summary').scrollIntoView({block:'nearest'});
  }
  let restaurantSort='daum';
  function sortedRestaurants(job){
    const score=p=>p?Number.isFinite(p.rating)?p.rating:-1:-2;
    const count=p=>restaurantSort==='daum'?p?.ratingCount||0:p?.reviewCount||0;
    return [...(job.restaurants||[])].sort((a,b)=>score(b[restaurantSort])-score(a[restaurantSort])||count(b[restaurantSort])-count(a[restaurantSort])||a.name.localeCompare(b.name,'ko')).slice(0,20);
  }
  function restaurantMetric(place,source){
    if(!place)return ['미확인',''];
    const score=place.rating!==null?`${place.ratingText} / 5`:'미표시';
    const count=source==='daum'?place.ratingCountText:place.reviewCountText;
    return [score,count?(source==='daum'?'평가 '+count.replace(/건$/,'')+'건':'리뷰 '+count+'개'):''];
  }
  function renderRestaurants(job){
    const root=$('restaurant-results'),body=$('restaurant-table').querySelector('tbody');root.hidden=false;body.replaceChildren();
    const rows=sortedRestaurants(job),date=new Date(job.checkedAt);
    $('restaurant-result-note').textContent=`확인한 ${job.restaurants.length}곳 중 ${rows.length}곳 · ${Number.isNaN(date.getTime())?'':date.toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false})+' 확인'}`;
    document.querySelectorAll('[data-restaurant-sort]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.restaurantSort===restaurantSort)));
    rows.forEach(row=>{
      const tr=document.createElement('tr'),name=document.createElement('td'),title=document.createElement('strong'),address=document.createElement('small');title.textContent=row.name;address.textContent=row.address;name.append(title,address);tr.append(name);
      for(const key of ['naver','daum']){const td=document.createElement('td'),[rating,reviews]=restaurantMetric(row[key],key),score=document.createElement('strong'),count=document.createElement('small');td.dataset.map=key==='naver'?'네이버지도':'카카오맵';score.textContent=rating;score.className=row[key]?.rating!=null?'restaurant-rating':'muted';count.textContent=reviews;td.append(score,count);tr.append(td);}
      const links=document.createElement('td');for(const key of ['naver','daum']){const href=validLink(row[key]?.url);if(!href)continue;const a=document.createElement('a');a.href=href;a.target='_blank';a.rel='noopener noreferrer';a.textContent=key==='naver'?'네이버 ↗':'카카오 ↗';links.append(a);}tr.append(links);body.append(tr);
    });
    $('restaurant-errors').replaceChildren();for(const group of job.searches.filter(s=>s.error||s.warning)){const li=document.createElement('li');li.textContent=group.source+': '+(group.error||group.warning);const href=validLink(group.url);if(href){const a=document.createElement('a');a.href=href;a.target='_blank';a.rel='noopener noreferrer';a.textContent=' 지도 열기 ↗';li.append(a);}$('restaurant-errors').append(li);}
    if($('browser-dialog').open)root.scrollIntoView({block:'nearest'});
  }
  document.querySelectorAll('[data-restaurant-sort]').forEach(b=>b.onclick=()=>{restaurantSort=b.dataset.restaurantSort;if(browserJob?.mode==='restaurants'&&browserJob.status==='done')renderRestaurants(browserJob);});
  function browserText(job){
    if(job.mode==='amazon')return `Amazon 상품 검색: ${job.query}\n확인: ${job.checkedAt}\n화면의 통화 기준 · 배송비·세금 제외\n\n`+job.results.map((r,i)=>`${i+1}. ${r.title}\n${r.price||'가격 미표시'} · ${r.rating===null?'평점 없음':r.rating+'/5'} · 리뷰 ${r.reviewCount||'미표시'}\n${r.url}`).join('\n\n');
    if(job.mode==='restaurants')return `맛집 검색: ${job.region} / ${job.menu}\n${restaurantSort==='daum'?'카카오':'네이버'} 평점순 · 확인한 후보 중 상위 20곳\n확인: ${job.checkedAt}\n\n`+sortedRestaurants(job).map((row,i)=>`${i+1}. ${row.name}\n${row.address}\n`+['naver','daum'].map(key=>(key==='naver'?'네이버지도':'카카오맵')+': '+restaurantMetric(row[key],key).filter(Boolean).join(' · ')+(row[key]?'\n'+row[key].url:'')).join('\n')).join('\n\n');
    const docs=(job.documents||[]).filter(d=>d.status==='read');return `조사 요청: ${job.query}\n\n`+(browserSummary?browserSummary+'\n\n':'')+(docs.length?'읽은 근거:\n'+docs.map(d=>`[${d.id}] ${d.title}\n${d.url}${d.published?'\n게시일: '+d.published:''}${!browserSummary&&d.excerpt?'\n원문 발췌: '+d.excerpt:''}`).join('\n\n'):job.mode==='search'?job.results.map((r,i)=>`${i+1}. ${r.title}\n${r.url}`).join('\n\n'):job.summaryError||'질문에 맞는 근거를 확인하지 못했습니다.');
  }
  function updateBrowserButtons(){const usable=browserJob?.status==='done'&&browserJob.results.length>0,read=browserJob?.mode==='search'||browserJob?.documents?.some(d=>d.status==='read');$('browser-summary-run').hidden=['restaurants','amazon'].includes(browserJob?.mode||$('browser-mode').value);$('browser-summary-run').disabled=!usable||!read||summaryRunning;$('browser-summary-run').textContent=browserJob?.summary?'결과 다시 정리':'AI로 정리';$('browser-share').disabled=!usable;}
  function renderResults(job){
    $('browser-results').classList.toggle('product-results',job.mode==='amazon');
    if(job.mode==='restaurants'){$('browser-candidates').hidden=true;updateBrowserButtons();return;}
    $('browser-results').replaceChildren();job.results.forEach(r=>{const href=validLink(r.url);if(!href)return;const link=document.createElement('a'),host=document.createElement('small');link.className='result-card';link.textContent=r.title;link.href=href;host.textContent=new URL(href).hostname+(r.searchSources?.length?' · '+r.searchSources.join(', '):'');link.append(host);link.target='_blank';link.rel='noopener noreferrer';if(job.mode==='amazon'){const details=document.createElement('span');details.className='product-metrics';details.textContent=`${r.price||'가격 미표시'} · ${r.rating===null?'평점 없음':r.rating+'/5'} · 리뷰 ${r.reviewCount||'미표시'}`;link.append(details);}$('browser-results').append(link);});$('browser-candidates').hidden=!job.results.length;$('browser-candidates').querySelector('summary').textContent=`${job.mode==='amazon'?'상품':'검색 후보'} (${job.results.length})`;$('browser-candidates').open=['search','amazon'].includes(job.mode);updateBrowserButtons();
  }
  $('browser-form').onsubmit=async e=>{
    e.preventDefault();if(browserRunning)return;browserRunning=true;browserJob=null;browserSummary='';++summaryRevision;summaryRunning=false;$('browser-dialog').classList.remove('research-complete');
    [...$('browser-form').elements,...$('browser-examples').querySelectorAll('button')].forEach(b=>b.disabled=true);updateBrowserButtons();$('restaurant-results').hidden=true;$('browser-summary').hidden=true;$('browser-evidence').hidden=true;$('browser-candidates').hidden=true;$('browser-plan').hidden=true;$('browser-limitations').replaceChildren();$('browser-documents').replaceChildren();$('browser-steps').replaceChildren();$('browser-results').replaceChildren();$('browser-frame').hidden=true;delete $('browser-frame').dataset.revision;$('browser-empty').hidden=false;$('browser-note').textContent='조사 시작 중...';$('browser-live').textContent='연결 중';
    let eventCount=0;
    try{
      const mode=$('browser-mode').value;browserJob=await api('/api/browser/jobs',{...(mode==='restaurants'?{region:$('restaurant-region').value.trim(),menu:$('restaurant-menu').value.trim()}:{query:$('browser-query').value.trim()}),provider:mode==='amazon'?'amazon':$('browser-source').value,mode});
      const end=Date.now()+300000;let failures=0;while(Date.now()<end){renderSteps(browserJob);browserJob.events.slice(eventCount).forEach(s=>activity('브라우저',s.text));eventCount=browserJob.events.length;if(browserJob.status!=='running')break;await new Promise(r=>setTimeout(r,600));try{browserJob=await api('/api/browser/jobs/'+browserJob.id);failures=0;}catch(err){if(++failures>=5)throw err;}}
      renderSteps(browserJob);renderResults(browserJob);if(browserJob.status==='running')throw new Error('조사가 지연되고 있습니다. 실행 기록을 확인해주세요.');if(browserJob.status==='error')throw new Error(browserJob.error);renderSummary(browserJob);
    }catch(error){$('browser-note').textContent=error.message;$('browser-live').textContent='오류';activity('브라우저',error.message);}
    finally{browserRunning=false;[...$('browser-form').elements,...$('browser-examples').querySelectorAll('button')].forEach(b=>b.disabled=false);syncBrowserMode();updateBrowserButtons();}
  };
  $('browser-summary-run').onclick=async()=>{
    if(!browserJob?.results.length||summaryRunning)return;$('browser-summary').hidden=false;
    if(!canRun('web-summary')){$('browser-summary-text').textContent='AI 실행 서비스의 자동 연결을 확인해주세요. 읽은 원문은 아래에서 확인할 수 있습니다.';return;}
    const job=browserJob,revision=summaryRevision;summaryRunning=true;updateBrowserButtons();$('browser-summary-text').textContent='읽은 근거를 정리하고 있습니다...';
    try{const data=await window.DemoAPI.task({agent:'web-summary',searchJobId:job.id,messages:[{role:'user',content:job.query}]});if(data.error)throw new Error(data.error);if(revision===summaryRevision){job.summary={answer:data.reply,limitations:data.limitations||[]};browserSummary=data.reply;renderSummary(job);activity('브라우저','근거를 포함한 결과 정리 완료');}}
    catch(e){if(revision===summaryRevision)$('browser-summary-text').textContent=e.message;}
    finally{if(revision===summaryRevision){summaryRunning=false;updateBrowserButtons();}}
  };
  $('browser-share').onclick=()=>openShare(status.telegram?.connected?'telegram':status.agentmail?.connected?'agentmail':'telegram',browserText(browserJob));
  syncBrowserMode();
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
