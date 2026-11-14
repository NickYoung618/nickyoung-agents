export function deliveryGate(state,artifacts){
 const report=state.events.findLast(e=>e.type==='report')?.id||0;
 const tasks=state.tasks.filter(t=>t.status==='passed'&&(!report||state.events.some(e=>e.id>report&&(e.type==='task'&&e.data.id===t.id||e.type==='task_update'&&e.data.id===t.id&&e.data.commit))));if(!tasks.length){const user=state.events.findLast(e=>e.type==='message'&&e.data.member==='user');if((state.kind&&!["auto","answer"].includes(state.kind)||(state.intent?.artifact||user?.data.artifactFeedback))&&(state.requirement?.sourceMessage||user?.id)>report)return{ready:false,kind:'development',issues:[{reason:'当前开发要求尚未产生新的关联任务和成果',retry:'完成当前要求并验证后交付'}]};return{ready:true,kind:'answer',issues:[]};}
 const issues=[];if(state.kind&& !['auto','answer'].includes(state.kind)&&!artifacts.some(a=>a.type===state.kind))issues.push({reason:'未交付用户选择的成果类型 '+state.kind,retry:'按原类型实现并验证'});for(const task of tasks){const reused=new Set(state.events.filter(e=>e.type==='artifact_reuse'&&e.data.task===task.id).map(e=>e.data.id));const own=artifacts.filter(a=>a.task===task.id||reused.has(a.id));
 if(!own.length){issues.push({task:task.id,reason:'缺少结构化成果清单或成果收集失败',retry:'补充 .nickyoung/artifacts.json 并重新交付'});continue;}
 if(task.deliveryType&&task.deliveryType!=='auto'&&!own.some(a=>a.type===task.deliveryType))issues.push({task:task.id,reason:'成果类型与任务预期不符：'+task.deliveryType,retry:'按原目标交付正确类型'});
 for(const a of own){if(a.verification.status!=='passed')issues.push({artifact:a.id,version:a.version,reason:a.verification.reason||'本版本尚未通过使用场景验证',retry:a.type==='web'?'独立数据重新验收':'修正入口/示例后提交新版'});if(a.build&&a.buildEvidence?.status!=='passed')issues.push({artifact:a.id,reason:'构建尚未通过',retry:'修复构建后交付新版'});}
 }
 return{ready:issues.length===0,kind:'development',implementation:tasks.length,verified:artifacts.filter(a=>a.verification.status==='passed').length,pendingData:artifacts.filter(a=>a.dataState==='requires-upgrade').map(a=>a.id),issues};
}
