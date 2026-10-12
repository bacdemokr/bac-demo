'use strict';
const {Problem}=require('./integrations');
function commandKind(text){
  const list=/목록|리스트|\blist\b|(?:내|나의|my).{0,30}(?:저장소|repos?)/i.test(text);
  if(/삭제|지워|지우|\b(?:delete|remove)\b/i.test(text)){
    const informational=/삭제.{0,12}(?:하지|말|않|방법|절차|권한|실패|안\s*돼|안\s*되|됐|되었|했|할\s*수|가능|라고|라는)|지우지|지워.{0,4}말|지워졌|지웠|(?:왜|어떻게|권한|실패).{0,20}삭제|\b(?:do not|don't|never|how|why|what|failed|failure|permission|can i|did|was)\b/i.test(text);
    const explicit=/삭제\s*(?:해(?:\s*(?:줘|주세요|줄래|줄\s*수\s*있어))?|해주세요|부탁)|삭제\s*[.!]?\s*$|지워\s*(?:줘|주세요|줄래)?|지우세요|^(?:please\s+)?(?:delete|remove)\b|^(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:delete|remove)\b|\b(?:delete|remove)\s*[.!]?\s*$/i.test(text.trim());
    return informational||!explicit?list?'list':'delete-help':'delete';
  }
  return list?'list':null;
}
function resolveTarget(text,login,rows){
  const clean=text.replace(/https:\/\/github\.com\//gi,'');
  const full=[...clean.matchAll(/\b([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9_.-]{1,100})/g)].map(m=>m[1]+'/'+m[2].replace(/\.git$/i,''));
  if(full.length){const targets=[...new Set(full.map(r=>r.toLowerCase()))];if(targets.length!==1)throw new Problem('한 번에 하나의 Fork만 지정해주세요.');if(targets[0].split('/')[0]!==login.toLowerCase())throw new Problem('연결된 내 계정의 Fork만 삭제할 수 있습니다.',403);const target=rows.find(r=>r.name.toLowerCase()===targets[0]);if(!target)throw new Problem('내 저장소 목록에서 삭제 대상을 찾지 못했습니다. 정확한 이름과 토큰 접근 범위를 확인해주세요.',404);return target;}
  const matches=rows.filter(r=>{const name=r.name.split('/')[1].replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return new RegExp('(?<![A-Za-z0-9_.-])'+name+'(?![A-Za-z0-9_.-])','i').test(clean);});
  if(matches.length!==1)throw new Problem('삭제할 Fork 이름을 하나 지정해주세요. 예: '+login+'/ARC-AGI',409);return matches[0];
}
async function githubCommand(github,messages){
  const text=[...messages].reverse().find(m=>m.role==='user')?.content||'',kind=commandKind(text);if(!kind)return null;
  if(kind==='delete-help')return {reply:'삭제를 실행하지 않았습니다. 삭제하려면 Fork 이름과 함께 “ARC-AGI 삭제해줘”처럼 요청해주세요.'};
  if(kind==='list'&&!github.public().connected)return null;
  const c=github.requireConnection(),inventory=await github.ownedRepositories(c);
  if(kind==='list'){
    const rows=inventory.repositories;
    return {reply:`@${c.login}의 저장소 ${rows.length}개${inventory.truncated?' (일부 목록)':''}\n\n`+(rows.length?rows.map((r,i)=>`${i+1}. **${r.name}**${r.fork?' · Fork':''}${r.private?' · 비공개':''}\n${r.description?String(r.description).slice(0,400)+'\n':''}${r.url}`).join('\n\n'):'현재 토큰으로 조회할 수 있는 소유 저장소가 없습니다.')+(c.repo?'\n\n작업 대상: '+c.owner+'/'+c.repo:'')+'\n\n현재 토큰으로 접근 가능한 소유 저장소 기준입니다.',bubble:`저장소 ${rows.length}개 확인`};
  }
  const target=resolveTarget(text,c.login,inventory.repositories),preview=await github.prepareDelete(target.name);
  const result=await github.deleteFork({id:preview.id,confirmation:preview.repository});
  return {reply:result.reply+(preview.parent?'\n원본 '+preview.parent+'는 유지됩니다.':''),bubble:'Fork 삭제 완료',githubChanged:true};
}
module.exports={commandKind,resolveTarget,githubCommand};
