const shellQuote=value=>"'"+String(value).replaceAll("'","'\\''")+"'";
const previewLabels={running:'运行中',starting:'启动中',stopped:'已停止',failed:'启动失败',expired:'已过期，请重新启动'};
const filters={query:'',type:'all',project:'all',history:false,archive:'active'};
export function setArtifactFilters(value){Object.assign(filters,value);}
const states=new Map(), cursors=new Map(),sending=new Set();
export function artifactInventory(){return [...new Map([...states.values()].flat().map(a=>[a.id,a])).values()];}
let reconnect=true;
export function reconnectArtifacts(){reconnect=true;}
export async function syncArtifacts(conversations,api){
 const force=reconnect;reconnect=false;const globalCursor=Math.max(0,...conversations.flatMap(c=>c.events.filter(e=>['artifact','artifact_archive','artifact_user_acceptance','usage_track','usage_upgrade_failed'].includes(e.type)).map(e=>e.id)));
 await Promise.all(conversations.filter(c=>c.events.some(e=>['artifact','artifact_link'].includes(e.type))).map(async c=>{
  const cursor=Math.max(0,...c.events.filter(e=>['artifact','preview','artifact_validation','artifact_user_acceptance','artifact_feedback','artifact_archive','artifact_link','usage_track','usage_upgrade_failed'].includes(e.type)).map(e=>e.id));
  if(!force&&cursors.get(c.id)===cursor+':'+globalCursor)return;
  const list=await api(`conversations/${c.id}/artifacts`);
  if(!Array.isArray(list))return;
  states.set(c.id,list);cursors.set(c.id,cursor+':'+globalCursor);
 }));
}
function draftKey(card){return `nickyoung:artifact-feedback:${card.dataset.conversation}:${card.dataset.artifact}:${card.dataset.version}`;}
function readDraft(card){try{return JSON.parse(localStorage.getItem(draftKey(card))||'{}');}catch{return {};}}
function saveDraft(card,extra={}){const data={...readDraft(card),text:card.querySelector('textarea').value,...extra};try{localStorage.setItem(draftKey(card),JSON.stringify(data));}catch{}return data;}
function initDraft(card){const d=readDraft(card);card.querySelector('textarea').value=d.text||'';for(const detail of card.querySelectorAll('details'))detail.open=(d.expanded||[]).includes(detail.id);if(d.attachmentNames?.length)card.querySelector('[data-attachment-note]').textContent=`截图需重新选择：${d.attachmentNames.join('、')}`;}
export function artifactDraftEvent(event){const card=event.target.closest('[data-artifact]');if(!card)return;if(event.target.matches('textarea'))saveDraft(card);if(event.type==='toggle')saveDraft(card,{expanded:[...card.querySelectorAll('details[open]')].map(n=>n.id)});if(event.target.matches('input[type=file]')){const names=[...event.target.files].map(f=>f.name);saveDraft(card,{attachmentNames:names});card.querySelector('[data-attachment-note]').textContent=names.length?`已选择：${names.join('、')}`:'';}}
export function artifactCards(conversations,escape){
 const inventory=new Map();for(const c of conversations){const map=new Map();for(const e of c.events)if(e.type==='artifact')map.set(e.data.id,e.data);for(const a of states.get(c.id)||[...map.values()])inventory.set(a.id,{c,a});}
 const items=[...inventory.values()].map(x=>x.a);const group=a=>(a.projectId||a.project)+':'+a.key;const latest=new Map(),recommended=new Map();
 for(const a of items){if(!a.archived&&(!latest.has(group(a))||latest.get(group(a)).version<a.version))latest.set(group(a),a);if(!a.archived&&a.verification.status==='passed'&&a.dataState!=='requires-upgrade'&&(!recommended.has(group(a))||recommended.get(group(a)).version<a.version))recommended.set(group(a),a);}
 return [...inventory.values()].reverse().map(({c,a})=>{
   const visible=(filters.archive==='all'||filters.archive==='archived'===!!a.archived)&&(filters.archive==='archived'||filters.history||latest.get(group(a))?.id===a.id||recommended.get(group(a))?.id===a.id)&&(filters.type==='all'||a.type===filters.type)&&(filters.project==='all'||(a.projectId||a.project)===filters.project)&&(!filters.query||(a.name+' '+a.description+' '+a.project).toLowerCase().includes(filters.query.toLowerCase()));
   const v=a.verification,p=a.preview,running=p?.status==='running'&&p.expires>Date.now(),previous=items.filter(b=>group(b)===group(a)&&b.version<a.version&&b.verification.status==='passed').at(-1);
   const feedback=c.events.some(e=>e.type==='artifact_feedback'&&e.data.id===a.id);
   const button=(action,text)=>`<button data-artifact-action="${action}">${text}</button>`;
   return `<article ${visible?'':'hidden'} class="card artifact-card" data-artifact="${a.id}" data-conversation="${c.id}" data-version="${a.version}"><div data-artifact-region="heading"><h3>${escape(a.name)} · v${a.version}${recommended.get(group(a))?.id===a.id?' · 推荐使用':''}</h3><p>${escape(a.project)} · ${escape(c.title)}</p><p>${escape(a.description)}</p></div>
   <div data-artifact-region="status"><p>${escape(a.type)} · 提交 ${escape(a.commit.slice(0,8))} · ${v.status==='passed'?'验收通过':v.status==='needs_preview'?'待场景验收':'验证失败'} · ${a.type==='web'?(running&&v.status==='passed'?'成果可使用':`预览${escape(previewLabels[p?.status]||'未启动')}`):(v.status==='passed'?'成果可使用':'入口不可使用')} · ${a.userAcceptance?'用户已验收':'待用户验收'}</p>${a.dataState==='requires-upgrade'?'<p>使用数据待升级；旧版仍可使用，请先点击升级并沿用数据。</p>':''}${v.reason?`<p role="status">验收：${escape(v.reason)}</p>`:''}${p?.reason?`<p>启动：${escape(p.reason)}</p>`:''}${a.validation?.status==='running'?'<p>独立数据实例正在验收，使用数据不会改变。</p>':a.validation?.reason?`<p>最近验收：${escape(a.validation.reason)}</p>`:''}</div>
   <div data-artifact-region="controls">${a.type==='web'?button('start',running?'打开应用（当前实例）':'启动 / 重新启动预览')+button('stop','停止预览')+button('verify','独立数据重新验收')+button('cancel-verify','停止验收')+(a.dataState==='requires-upgrade'?button('upgrade-data','升级并沿用数据（旧版短暂停止）'):''):''}${button('archive',a.archived?'取消归档':'归档')}</div>
   <div data-preview-host>${running?`<iframe title="${escape(a.name)}" sandbox="allow-scripts allow-forms" src="${p.url}"></iframe>`:''}</div>
   <div data-artifact-region="usage">${['cli','library'].includes(a.type)?`<p>工作目录：${escape(a.workingDirectory||a.cwd)}（服务器，固定提交 ${escape(a.commit.slice(0,8))}）</p><pre>cd ${escape(shellQuote(a.workingDirectory||a.cwd))}\nnode ${escape((a.example?.args||[]).map(shellQuote).join(' '))}</pre>`:''}${(v.evidence||[]).filter(x=>x.kind==='example'||x.kind==='document').map(x=>`<pre>${escape(x.kind==='example'?'输入：'+x.input+'\n真实输出：'+x.output:x.output)}</pre>`).join('')}${v.status==='passed'?`<a href="/api/conversations/${c.id}/artifacts/${a.id}/download">下载入口文件</a> <a href="/api/conversations/${c.id}/artifacts/${a.id}/package">下载完整源码包</a>${a.build?` <a href="/api/conversations/${c.id}/artifacts/${a.id}/package?kind=build">下载构建产物包</a>`:''}${button('accept','我已实际使用，确认验收')}`:''}<p>限制：${escape(a.limits.join('；')||'清单未声明额外限制')}</p>${previous?`<p>上一个通过验证的版本：v${previous.version} · ${escape(previous.commit.slice(0,8))}；新版失败不会删除旧版。</p>`:''}</div>
   <details id="feedback-${a.id}"><summary>继续修改此版本（文字 / 截图）</summary><textarea aria-label="成果修改要求" placeholder="描述需要修改的行为"></textarea><input type="file" accept="image/*" aria-label="附加截图" multiple><p data-attachment-note></p>${button('clear-attachments','移除截图')}${button('feedback','提交修改')}<p data-artifact-region="feedback-status" role="status">${feedback?'已收到修改，新版将单独验证。':''}</p></details>
   <details id="artifact-evidence-${a.id}"><summary>场景验收、版本差异与恢复</summary><div data-artifact-region="evidence"><p>验证时间：${escape(v.time)}；任务 ${escape(a.task)}</p><p>相关文件：${escape((a.files||[]).join('、'))}</p><pre>${escape(JSON.stringify(v.evidence,null,2))}</pre></div>${button('compare','查看与当前代码差异')}${button('restore-plan','查看恢复影响范围')}<pre class="artifact-detail"></pre></details></article>`;
 }).join('');
}
export function updateArtifactRegion(box,html){
 const template=document.createElement('template');template.innerHTML=html;
 const key=n=>n.dataset?.artifact?`artifact:${n.dataset.artifact}`:n.id||'empty';
 const old=new Map([...box.children].map(n=>[key(n),n]));const wanted=new Set();let before=box.firstElementChild;
 for(const fresh of [...template.content.children]){
  const id=key(fresh);wanted.add(id);let node=old.get(id);
  if(node?.matches('[data-artifact]')){node.hidden=fresh.hidden;
   for(const region of fresh.querySelectorAll('[data-artifact-region]')){const live=node.querySelector(`[data-artifact-region="${region.dataset.artifactRegion}"]`);if(live.innerHTML!==region.innerHTML)live.innerHTML=region.innerHTML;}
   const host=node.querySelector('[data-preview-host]'),frame=host.querySelector('iframe'),next=fresh.querySelector('iframe');
   if(!next)frame?.remove();else if(!frame)host.append(next);else if(frame.getAttribute('src')!==next.getAttribute('src'))frame.src=next.getAttribute('src');
  }else if(node){if(node.innerHTML!==fresh.innerHTML){const opened=[...node.querySelectorAll('details[open]')].map(n=>n.id);const open=node.open;node.innerHTML=fresh.innerHTML;node.open=open;for(const d of node.querySelectorAll('details'))d.open=opened.includes(d.id);}}
  else{node=fresh;if(node.matches('[data-artifact]'))initDraft(node);}
  if(node!==before)box.insertBefore(node,before);before=node.nextElementSibling;
 }
 for(const [id,node] of old)if(!wanted.has(id))node.remove();
}
export async function artifactAction(event,api,refresh,notice){
 const b=event.target.closest('[data-artifact-action]');if(!b)return false;
 const card=b.closest('[data-artifact]'),id=card.dataset.artifact,base=`conversations/${card.dataset.conversation}/artifacts/${id}`,action=b.dataset.artifactAction,key=base+':'+action;
 if(sending.has(key))return true;sending.add(key);b.disabled=true;
 try{
  if(action==='clear-attachments'){card.querySelector('input[type=file]').value='';card.querySelector('[data-attachment-note]').textContent='';saveDraft(card,{attachmentNames:[]});}
  else if(action==='feedback'){
   const area=card.querySelector('textarea'),input=card.querySelector('input[type=file]'),text=area.value,selected=[...input.files],files=[];
   if(!text.trim())throw Error('请输入修改要求');
   if(!selected.length&&readDraft(card).attachmentNames?.length)throw Error('截图需重新选择，或先点击移除截图');
   for(const file of selected){if(file.size>8000000)throw Error('截图最大 8MB');const data=await new Promise((r,j)=>{const reader=new FileReader();reader.onload=()=>r(reader.result.split(',')[1]);reader.onerror=j;reader.readAsDataURL(file);});files.push({name:file.name,data});}
   const signature=JSON.stringify([text,selected.map(f=>[f.name,f.size,f.lastModified])]);const draft=readDraft(card),requestId=draft.signature===signature?draft.requestId:crypto.randomUUID();saveDraft(card,{signature,requestId});
   await api(base+'/feedback',{text,files,requestId});
   if(area.value===text)area.value='';if([...input.files].every((f,i)=>f===selected[i])&&input.files.length===selected.length){input.value='';card.querySelector('[data-attachment-note]').textContent='';saveDraft(card,{attachmentNames:[]});}
   saveDraft(card,{signature:null,requestId:null});notice('已收到修改，基于此版本开始；新版会单独验证。');
  }else if(action==='restore-plan'){
   const plan=await api(base+'/restore-plan');card.querySelector('.artifact-detail').textContent=JSON.stringify(plan,null,2);
   if(plan.dirty.length)notice('有未提交改动，恢复被阻止。');else if(confirm(plan.scope+'\n将恢复：\n'+plan.files.join('\n')+'\n确认恢复这些代码文件？')){await api(base+'/restore',{head:plan.head});notice('代码已恢复为待提交改动；请检查后继续任务。');}
  }else if(action==='compare')card.querySelector('.artifact-detail').textContent=(await api(base+'/compare')).diff||'无代码差异';
  else{await api(base+'/'+action,action==='archive'?{archived:b.textContent==='归档'}:{});notice({start:'已打开原实例；打开不会执行验收。',verify:'独立实例验收已结束，请查看本版本证据。',stop:'预览已停止。','cancel-verify':'已请求停止验收。',accept:'已记录你的验收操作。',archive:'已更新归档状态，文件和记录保留。','upgrade-data':'升级副本已验证，使用数据已准备好。'}[action]);}
  cursors.delete(card.dataset.conversation);await refresh();if(action==='start')card.querySelector('iframe')?.scrollIntoView({block:'nearest'});
 }catch(e){notice(e.message);}finally{sending.delete(key);b.disabled=false;}return true;
}
