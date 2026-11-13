const shellQuote=value=>"'"+String(value).replaceAll("'","'\\''")+"'";
const previews=new Map();
export function artifactCards(conversations,escape) {
 return conversations.flatMap(c=>{
  const map=new Map();for(const e of c.events){if(e.type==='artifact')map.set(e.data.id,e.data);if(e.type==='artifact_user_acceptance'&&map.has(e.data.id))map.set(e.data.id,{...map.get(e.data.id),userAcceptance:e.data});}
  return [...map.values()].reverse().map(a=>{
   const v=a.verification, p=previews.get(a.id), latest=c.events.filter(e=>e.type==='preview'&&e.data.id===a.id).at(-1), running=p?.preview?.status==='running'&&p.preview.expires>Date.now()&&(!latest||latest.data.status==='running');
   const feedback=c.events.filter(e=>e.type==='artifact_feedback'&&e.data.id===a.id).at(-1);
   const previous=[...map.values()].filter(b=>b.key===a.key&&b.version<a.version&&b.verification.status==='passed').at(-1);
   const button=(action,text)=>`<button data-artifact-action="${action}">${text}</button>`;
   return `<article class="card artifact-card" data-artifact="${a.id}" data-conversation="${c.id}"><h3>${escape(a.name)} · v${a.version}</h3><p>${escape(a.description)}</p><p>${escape(a.type)} · 提交 ${escape(a.commit.slice(0,8))} · ${v.status==='passed'?'验收通过':v.status==='needs_preview'?'待启动及场景验收':'验证失败'} · ${a.type==='web'?(running&&v.status==='passed'?'成果可使用':'预览未运行或尚未验证'):(v.status==='passed'?'成果可使用':'入口不可使用')} · ${a.userAcceptance?'用户已验收':'待用户验收'}</p>${v.reason?`<p role="status">${escape(v.reason)}</p>`:''}
   ${a.type==='web'?button('start',running?'重新检查 / 打开应用':'启动 / 重新启动预览')+button('stop','停止预览')+(running?`<p>预览 ${new Date(p.preview.expires).toLocaleTimeString()} 到期。网页脚本与助手登录、API 隔离。</p><iframe title="${escape(a.name)}" sandbox="allow-scripts allow-forms" src="${p.preview.url}"></iframe>`:''):''}
   ${['cli','library'].includes(a.type)?`<p>工作目录：${escape(a.workingDirectory||a.cwd)}（服务器，项目 ${escape(a.project)}，固定提交 ${escape(a.commit.slice(0,8))}）</p><pre>cd ${escape(shellQuote(a.workingDirectory||a.cwd))}
node ${escape((a.example?.args||[]).map(shellQuote).join(' '))}</pre>`:''}
   ${(v.evidence||[]).filter(x=>x.kind==='example'||x.kind==='document').map(x=>`<pre>${escape(x.kind==='example'?'输入：'+x.input+'\n真实输出：'+x.output:x.output)}</pre>`).join('')}
   ${v.status==='passed'?`<a href="/api/conversations/${c.id}/artifacts/${a.id}/download">下载入口文件</a> ${button('accept','我已实际使用，确认验收')}`:''}
   <p>完成项：${escape(a.description||a.name)}；限制：${escape(a.limits.join('；')||'清单未声明额外限制')}</p>
   <details id="feedback-${a.id}"><summary>继续修改此版本（文字 / 截图）</summary><textarea aria-label="成果修改要求" placeholder="描述需要修改的行为"></textarea><input type="file" accept="image/*" aria-label="附加截图" multiple>${button('feedback','提交修改')}<p role="status">${feedback?'已收到修改，正在修改 v'+a.version+'；新版验证状态见同名新版成果卡。':''}</p></details>
   ${previous?`<p>上一个通过验证的版本：v${previous.version} · ${escape(previous.commit.slice(0,8))}；新版失败不会删除旧版。</p>`:''}
   <details id="artifact-evidence-${a.id}"><summary>场景验收、版本差异与恢复</summary><p>验证时间：${escape(v.time)}；任务 ${escape(a.task)}</p><p>相关文件：${escape((a.files||[]).join("、"))}</p><p>验收条件：${escape(a.acceptanceCriteria||"见任务详情")}</p><pre>${escape(JSON.stringify(v.evidence,null,2))}</pre>${button('compare','查看与当前代码差异')}${button('restore-plan','查看恢复影响范围')}<pre class="artifact-detail"></pre></details></article>`;
  });
 }).join('');
}
export async function artifactAction(event,api,refresh,notice) {
 const b=event.target.closest('[data-artifact-action]');if(!b)return false;
 const card=b.closest('[data-artifact]'),id=card.dataset.artifact,base=`conversations/${card.dataset.conversation}/artifacts/${id}`,action=b.dataset.artifactAction;
 b.disabled=true;
 try{
  if(action==='feedback'){
   const text=card.querySelector('textarea').value,files=[];
   for(const file of card.querySelector('input[type=file]').files){if(file.size>8000000)throw Error('截图最大 8MB');const data=await new Promise((r,j)=>{const reader=new FileReader();reader.onload=()=>r(reader.result.split(',')[1]);reader.onerror=j;reader.readAsDataURL(file);});files.push({name:file.name,data});}
   const requestId=card.querySelector('textarea').dataset.requestId ||=crypto.randomUUID();
   await api(base+'/feedback',{text,files,requestId});notice('已收到修改，基于此版本开始；新版会单独验证。');card.querySelector('textarea').value='';delete card.querySelector('textarea').dataset.requestId;
  }else if(action==='restore-plan'){
   const plan=await api(base+'/restore-plan');card.querySelector('.artifact-detail').textContent=JSON.stringify(plan,null,2);
   if(plan.dirty.length)notice('有未提交改动，恢复被阻止。');
   else if(confirm(plan.scope+'\n将恢复：\n'+plan.files.join('\n')+'\n确认恢复这些代码文件？')){await api(base+'/restore',{head:plan.head});notice('代码已恢复为待提交改动；请检查后继续任务。');}
  }else if(action==='compare'){card.querySelector('.artifact-detail').textContent=(await api(base+'/compare')).diff||'无代码差异';}
  else {const result=await api(base+'/'+action,{});if(action==='start')previews.set(id,result);if(action==='stop')previews.delete(id);notice(action==='accept'?'已记录你的验收操作。':action==='start'?'预览已启动，场景验证结果已记录。':'预览已停止。');}
  if(!['compare','restore-plan'].includes(action))await refresh();
 }catch(e){notice(e.message);}finally{b.disabled=false;}return true;
}
