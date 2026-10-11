/* Presenter controls. Provider credentials never enter browser storage. */
(() => {
  const $ = id => document.getElementById(id);
  const demo = () => window.BacDemo;
  const results = new Map();
  let connectionRevision = 0;
  let status = {}, browserJob = null, browserRunning = false, toastTimer;
  const roles = {sysmon:'시스템 상태 · 로컬 도구',scout:'웹 탐색 · Browser CDP',github:'저장소 도구 · Gateway MCP',multiagent:'PM → Dev · Gateway',arxiv:'논문 모음 · RSS',telegram:'양방향 채팅 · Bot API',agentmail:'이메일 · AgentMail API'};
  const api = async (path, body) => {
    const response = await fetch(path, {cache:'no-store', ...(body === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
    let data;
    try { data = await response.json(); } catch { throw new Error('서버 응답을 읽지 못했습니다. 연결을 확인해주세요.'); }
    if (!response.ok || data.error) throw new Error(data.error || '요청을 완료하지 못했습니다.');
    return data;
  };
  const toast = text => {
    $('toast').textContent=text; $('toast').hidden=false; clearTimeout(toastTimer);
    toastTimer=setTimeout(() => {$('toast').hidden=true;},4500);
  };
  function activity(agent, text) {
    $('activity-list').querySelector('.empty-activity')?.remove();
    const item=document.createElement('li'), time=document.createElement('time'), name=document.createElement('strong'), content=document.createElement('p');
    time.textContent=new Date().toLocaleTimeString('ko-KR',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});name.textContent=agent;content.textContent=text;
    item.append(time,name,content);$('activity-list').prepend(item);
    while($('activity-list').children.length>4)$('activity-list').lastElementChild.remove();
  }
  function roster(agents) {
    $('agent-roster').replaceChildren();$('agent-count').textContent=`${String(agents.length).padStart(2,'0')} AGENTS`;
    agents.forEach(a => {
      const b=document.createElement('button');b.className='agent-button';b.dataset.agent=a.id;b.style.setProperty('--agent-color',a.color);
      const dot=document.createElement('i'), label=document.createElement('span'), role=document.createElement('small');
      label.textContent=a.name;role.textContent=roles[a.id]?.split(' · ')[0] || a.role;label.append(role);b.append(dot,label);
      b.addEventListener('click',() => demo().openAgent(a.id));$('agent-roster').append(b);
    });
  }
  window.addEventListener('bac:ready', e => roster(e.detail));
  if(demo()?.getAgents().length)roster(demo().getAgents());
  window.addEventListener('bac:activity',e => activity(e.detail.agent,e.detail.text));
  window.addEventListener('bac:result',e => {if(e.detail.text)results.set(e.detail.agent,e.detail.text);});
  window.addEventListener('bac:agent', e => {
    const a=e.detail;$('agent-actions').replaceChildren();
    document.querySelectorAll('[data-agent]').forEach(b => b.classList.toggle('active',b.dataset.agent===a?.id));
    if(!a)return;
    $('chat-role').textContent=roles[a.id] || a.role;
    const button=(text,fn) => {const b=document.createElement('button');b.textContent=text;b.onclick=fn;$('agent-actions').append(b);};
    if(a.id==='scout')button('↗ 실제 브라우저 탐색',()=>openBrowser());
    if(a.id==='telegram')button('⚙ Telegram 연결',()=>openSettings('telegram'));
    if(a.id==='agentmail') {button('✉ 받은편지함',()=>openInbox());button('메일 쓰기',()=>openShare('agentmail',''));button('⚙ 연결',()=>openSettings('agentmail'));}
    if(a.id==='github')button('저장소 목록 보기',()=>demo().runTurn(a,'List my repositories.'));
    if(a.id==='arxiv')button('결과 공유 ↗',()=>openShare('telegram'));
  });
  $('activity-clear').onclick=()=>{$('activity-list').replaceChildren();};
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!document.querySelector('dialog[open]'))$('chat-close').click();});
  document.querySelectorAll('[data-mission]').forEach(b=>b.onclick=()=>{
    const mission=b.dataset.mission;
    if(mission==='browser')openBrowser();
    if(mission==='team')demo().openAgent('multiagent');
    if(mission==='research')demo().openAgent('arxiv');
    if(mission==='mail')openInbox();
  });
  $('motion-toggle').setAttribute('aria-pressed',String(demo().isPaused()));
  $('motion-toggle').onclick=()=>{
    const paused=!demo().isPaused();demo().motion(paused);$('motion-toggle').setAttribute('aria-pressed',String(paused));
    $('motion-toggle').setAttribute('aria-label',paused?'애니메이션 재생':'애니메이션 일시 정지');$('motion-toggle').textContent=paused?'▷':'Ⅱ';
  };
  function selectTab(tab) {
    const tabs=[...document.querySelectorAll('[data-tab]')];
    tabs.forEach(b=>{const active=b.dataset.tab===tab;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;$('panel-'+b.dataset.tab).hidden=!active;});
  }
  function openSettings(tab='telegram') { selectTab(tab);if(!$('settings-dialog').open)$('settings-dialog').showModal();refreshStatus(); }
  $('settings-open').onclick=()=>openSettings();
  document.querySelectorAll('[data-tab]').forEach((b,i)=>{
    b.onclick=()=>selectTab(b.dataset.tab);
    b.onkeydown=e=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
      e.preventDefault();const tabs=[...document.querySelectorAll('[data-tab]')];
      const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowLeft'?-1:1)+tabs.length)%tabs.length;
      selectTab(tabs[next].dataset.tab);tabs[next].focus();
    };
  });
  function showStatus(id,text,error=false){$(id).textContent=text;$(id).classList.toggle('error',error);}
  function renderConnections(){
    const tg=status.telegram||{}, mail=status.agentmail||{};
    if(document.activeElement!==$('tg-chat')&&!$('tg-chat').value)$('tg-chat').value=tg.chatId||'';
    if(document.activeElement!==$('mail-inbox')&&!$('mail-inbox').value)$('mail-inbox').value=mail.inboxId||'';
    if(!document.querySelector('#telegram-form button:disabled'))showStatus('tg-status',tg.connected?`@${tg.bot} · Chat ${tg.chatId||'미지정'}${tg.error?' · 수신 연결 확인 필요':''}`:tg.error||'연결 전',!!tg.error);
    if(!document.querySelector('#mail-connect-form button:disabled'))showStatus('mail-status',mail.connected?`연결됨 · ${mail.inboxId}`:mail.error||'연결 전',!!mail.error);
    $('tg-disconnect').disabled=!tg.configured;$('mail-disconnect').disabled=!mail.configured;
    const runtime=status.gateway?.reachable && status.gateway?.configured;
    $('runtime-status').classList.toggle('connected',runtime);$('runtime-status').lastChild.textContent=runtime?' Gateway 연결됨':' Gateway 설정 확인';
    $('tool-status-list').replaceChildren();
    const rows=[['OpenClaw Gateway',runtime?'연결됨':status.gateway?.reachable?'응답 있음 · 인증 설정 필요':'연결 확인 필요'],['Browser · CDP',status.browser?.connected?'Chromium 연결됨':'브라우저 실행 필요'],['GitHub · MCP','git 에이전트의 도구 설정 필요'],['Telegram · Bot API',tg.connected?'연결됨':'연결 전'],['AgentMail · REST API',mail.connected?'연결됨':'연결 전']];
    rows.forEach(([name,state])=>{const row=document.createElement('div');row.className='tool-row';const label=document.createElement('span'),value=document.createElement('small');label.textContent=name;value.textContent=state;row.append(label,value);$('tool-status-list').append(row);});
  }
  let statusLoading=false;
  async function refreshStatus(){
    if(statusLoading)return;statusLoading=true;
    const revision=connectionRevision;
    try{const fetched=await api('/api/showcase/status');if(revision===connectionRevision){status=fetched;renderConnections();}}
    catch{ $('runtime-status').lastChild.textContent=' 서버 연결 확인'; }
    finally{statusLoading=false;}
  }
  async function configure(formId,statusId,path,body,keyId){
    ++connectionRevision;
    const controls=[...$(formId).querySelectorAll('button')];controls.forEach(b=>b.disabled=true);showStatus(statusId,'연결 확인 중...');
    let result;
    try{result=await api(path,body);const type=path.split('/').pop();status[type]=result;$(keyId).value='';showStatus(statusId,body.disconnect?'연결을 해제했습니다.':'연결되었습니다.');activity(type,body.disconnect?'연결 해제':'연결 확인 완료');}
    catch(e){showStatus(statusId,e.message,true);}
    finally{controls.forEach(b=>b.disabled=false);if(result)renderConnections();}
  }
  $('telegram-form').onsubmit=e=>{e.preventDefault();configure('telegram-form','tg-status','/api/integrations/telegram',{token:$('tg-token').value.trim(),chatId:$('tg-chat').value.trim()},'tg-token');};
  $('mail-connect-form').onsubmit=e=>{e.preventDefault();configure('mail-connect-form','mail-status','/api/integrations/agentmail',{apiKey:$('mail-key').value.trim(),inboxId:$('mail-inbox').value.trim()},'mail-key');};
  $('tg-disconnect').onclick=()=>configure('telegram-form','tg-status','/api/integrations/telegram',{disconnect:true},'tg-token');
  $('mail-disconnect').onclick=()=>configure('mail-connect-form','mail-status','/api/integrations/agentmail',{disconnect:true},'mail-key');
  $('settings-dialog').addEventListener('close',()=>{$('tg-token').value='';$('mail-key').value='';});
  function openBrowser(){if(!$('browser-dialog').open)$('browser-dialog').showModal();}
  async function browse(query){
    if(browserRunning){openBrowser();return;}
    openBrowser();$('browser-query').value=query;$('browser-form').requestSubmit();
  }
  const renderSteps=job=>{
    const list=$('browser-steps');list.replaceChildren();
    job.events.forEach(step=>{const li=document.createElement('li'),time=document.createElement('time');li.textContent=step.text;time.textContent=new Date(step.at).toLocaleTimeString('ko-KR',{hour12:false});li.append(time);list.append(li);});
    $('browser-address').textContent=job.url;$('browser-live').textContent=job.status==='running'?'LIVE CAPTURE':job.status==='done'?'CAPTURED':'ERROR';
    if(job.screenshot&&$('browser-frame').dataset.revision!==String(job.revision)){
      $('browser-frame').src=job.screenshot;$('browser-frame').dataset.revision=String(job.revision);$('browser-frame').hidden=false;$('browser-empty').hidden=true;
    }
    $('browser-note').textContent=job.error||job.note||(job.status==='done'?`${job.results.length}개 링크 확인`:'실제 브라우저에서 탐색 중...');
  };
  function browserText(job){return `${job.source} 검색: ${job.query}\n\n`+job.results.map((r,i)=>`${i+1}. ${r.title}\n${r.url}${r.snippet?'\n'+r.snippet:''}`).join('\n\n');}
  function renderResults(job){
    $('browser-results').replaceChildren();
    job.results.forEach(r=>{
      const link=document.createElement('a');link.className='result-card';link.textContent=r.title;
      try{const u=new URL(r.url);if(!['http:','https:'].includes(u.protocol))return;link.href=u.href;const host=document.createElement('small');host.textContent=u.hostname;link.append(host);}catch{return;}
      link.target='_blank';link.rel='noopener noreferrer';$('browser-results').append(link);
    });
    const usable=job.status==='done'&&job.results.length>0;$('browser-to-chat').disabled=!usable;$('browser-share').disabled=!usable;
  }
  $('browser-form').onsubmit=async e=>{
    e.preventDefault();if(browserRunning)return;
    browserRunning=true;demo().busy('scout',true);browserJob=null;$('browser-run').disabled=true;$('browser-to-chat').disabled=true;$('browser-share').disabled=true;
    $('browser-steps').replaceChildren();$('browser-results').replaceChildren();$('browser-frame').hidden=true;delete $('browser-frame').dataset.revision;$('browser-empty').hidden=false;$('browser-note').textContent='Chromium 연결 중...';
    let eventCount=0;
    try{
      browserJob=await api('/api/browser/jobs',{query:$('browser-query').value.trim(),provider:$('browser-source').value});
      demo().bubble('scout','실제 브라우저에서 검색 중 ↗');
      for(let i=0;i<150;i++){
        renderSteps(browserJob);
        browserJob.events.slice(eventCount).forEach(s=>activity('Browser',s.text));eventCount=browserJob.events.length;
        if(browserJob.status!=='running')break;
        await new Promise(r=>setTimeout(r,500));browserJob=await api('/api/browser/jobs/'+browserJob.id);
      }
      renderSteps(browserJob);renderResults(browserJob);
      if(browserJob.status==='running')throw new Error('탐색이 지연되고 있습니다. 잠시 후 다시 실행해주세요.');
      if(browserJob.status==='error')throw new Error(browserJob.error);
      if(browserJob.results.length){results.set('NaverAgent',browserText(browserJob));demo().bubble('scout',`${browserJob.results.length}개 링크를 확인했어요`);}
    }catch(error){$('browser-note').textContent=error.message;activity('Browser',error.message);}
    finally{browserRunning=false;demo().busy('scout',false);$('browser-run').disabled=false;if(demo().getActive()?.id==='scout')$('send').disabled=false;}
  };
  $('browser-to-chat').onclick=()=>{
    if(!browserJob||!browserJob.results.length)return;
    $('browser-dialog').close();demo().openAgent('scout');
    demo().runTurn(demo().getActive(),browserJob.query,{searchJobId:browserJob.id});
  };
  $('browser-share').onclick=()=>openShare('telegram',browserText(browserJob));
  let inboxLoading=false;
  async function loadInbox(){
    if(inboxLoading)return;inboxLoading=true;$('inbox-refresh').disabled=true;$('inbox-status').textContent='받은편지함 확인 중...';$('inbox-messages').replaceChildren();
    try{
      const data=await api('/api/integrations/agentmail/messages');$('inbox-status').textContent=data.messages.length?`${data.messages.length}개 메시지 · 최신순`:'아직 받은 메시지가 없습니다.';
      data.messages.forEach(m=>{const item=document.createElement('article'),title=document.createElement('strong'),meta=document.createElement('small'),body=document.createElement('p');item.className='inbox-item';title.textContent=m.subject;meta.textContent=[Array.isArray(m.from)?m.from.join(', '):m.from,m.at?new Date(m.at).toLocaleString('ko-KR'):''].filter(Boolean).join(' · ');body.textContent=m.preview;item.append(title,meta,body);$('inbox-messages').append(item);});activity('AgentMail',`${data.messages.length}개 메일 확인`);
    }catch(e){$('inbox-status').textContent=e.message;const b=document.createElement('button');b.className='quiet-button';b.textContent='AgentMail 연결 설정';b.onclick=()=>openSettings('agentmail');$('inbox-messages').append(b);}
    finally{inboxLoading=false;$('inbox-refresh').disabled=false;}
  }
  function openInbox(){if(!$('inbox-dialog').open)$('inbox-dialog').showModal();loadInbox();}
  $('inbox-refresh').onclick=loadInbox;$('mail-new').onclick=()=>openShare('agentmail','');
  function syncShare(){
    const isMail=$('share-channel').value==='agentmail';$('share-email-fields').hidden=!isMail;$('share-to').required=isMail;$('share-subject').required=isMail;
    $('share-text').maxLength=isMail?20000:4000;
    $('share-destination').textContent=isMail?`보내는 주소: ${status.agentmail?.inboxId||'AgentMail 연결 필요'}`:`받는 Chat ID: ${status.telegram?.chatId||'Telegram 연결 필요'}`;
  }
  function openShare(channel,text){
    const value=text===undefined?results.get(demo().getActive()?.name):text;
    if(value===undefined){toast('먼저 검색이나 논문 조회를 실행해주세요.');return;}
    $('share-channel').value=channel;$('share-text').value=value;$('share-status').textContent='';syncShare();if(!$('share-dialog').open)$('share-dialog').showModal();
  }
  $('share-channel').onchange=syncShare;$('share-telegram').onclick=()=>openShare('telegram');$('share-mail').onclick=()=>openShare('agentmail');
  $('share-form').onsubmit=async e=>{
    e.preventDefault();if($('share-send').disabled)return;
    const channel=$('share-channel').value;
    if(!status[channel]?.connected){showStatus('share-status','먼저 연결 설정을 완료해주세요.',true);openSettings(channel);return;}
    $('share-send').disabled=true;showStatus('share-status','전송 중...');
    try{
      const data=await api('/api/integrations/'+channel+'/send',channel==='telegram'?{text:$('share-text').value}:{to:$('share-to').value.trim(),subject:$('share-subject').value.trim(),text:$('share-text').value});
      showStatus('share-status',`전송 완료 · ${data.messageId}`);activity(channel,'사용자가 확인한 결과 전송 완료');demo().bubble(channel==='agentmail'?'agentmail':'telegram','결과를 보냈어요 ↗');
    }catch(error){showStatus('share-status',error.message,true);}
    finally{$('share-send').disabled=false;}
  };
  window.BacShowcase={browse,inbox:openInbox,settings:openSettings};
  refreshStatus();
})();
