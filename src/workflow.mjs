import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { validatePlan, canRunTask, canDeliver, shouldWakePlanner } from './workflow-policy.mjs';
import { fingerprint, inScope, checkFingerprint, reusableEvidence, unexpectedChanges, verificationEnvironment, executeCheck } from './verification.mjs';
import { validateRoleResult } from './contracts.mjs';
const id=()=>randomUUID();
export class Workflow {
 constructor(engine) {this.e=engine;}
 state(c){return this.e.state(c);}
 event(c,type,data){return this.e.event(c,type,data);}
 update(c,patch){const cycle=this.state(c).cycle;return this.event(c,'cycle_update',{cycleId:cycle.cycleId,...patch});}
 start(c,goal) {
  const cycleId=id();
  this.event(c,'cycle',{cycleId,goal,planRevision:0,generation:0,phase:'planning',tasks:[],gates:[],evidence:[],issues:[],repairs:{},replans:0,rechecks:0,policy:'final_review',budgets:{taskRepairs:2,cycleRepairs:6,replans:1,rechecks:1,...this.e.config.workflowBudgets}});
  return cycleId;
 }
 submit(c,input,{direct=false}={}) {
  let s=this.state(c),cycle=s.cycle;
  const plan=validatePlan(input,s.members,{direct});
  const signature=fingerprint(plan);
  if(cycle?.planSignature===signature) return {cycleId:cycle.cycleId,planRevision:cycle.planRevision,reused:true};
  if(!cycle || cycle.phase==='delivered') {this.start(c,plan.goal);s=this.state(c);cycle=s.cycle;}
  if(cycle.planRevision && cycle.replans>=cycle.budgets.replans) throw Error('批次重规划预算已达上限');
  const revision=cycle.planRevision+1;
  const previous=cycle.tasks;
  // Stable IDs preserve repair budgets. Any changed plan invalidates formal evidence.
  for(const t of previous) if(!plan.tasks.some(x=>x.id===t.localId)) this.event(c,'task_update',{id:t.id,status:'cancelled',generation:(t.generation||0)+1});
  const ids=new Map(plan.tasks.map(t=>[t.id,previous.find(x=>x.localId===t.id)?.id || `${cycle.cycleId}:${t.id}`]));
  for(const t of plan.tasks) {
   const old=previous.find(x=>x.localId===t.id);
   const same=old && fingerprint(old.definition)===fingerprint(t);
   const data={...t,id:ids.get(t.id),localId:t.id,cycleId:cycle.cycleId,member:t.executorId,definition:t,dependsOn:t.dependsOn.map(x=>ids.get(x)),planRevision:revision,generation:(old?.generation||0)+1,status:same&&old.status==='implemented'?'implemented':'queued',failures:old?.failures||0};
   this.event(c,old?'task_update':'task',data);
  }
  this.update(c,{goal:plan.goal,scope:plan.scope,conventions:plan.conventions,criteria:plan.criteria,policy:plan.policy,reason:plan.reason,facts:plan.facts,planSignature:signature,planRevision:revision,generation:cycle.generation+1,replans:cycle.replans+(cycle.planRevision?1:0),phase:'executing',gates:plan.gates.map(g=>({...g,afterTasks:g.afterTasks.map(x=>ids.get(x)),status:'pending',evidenceIds:[]})),issues:[],finalCommit:null,reviewedCommit:null});
  return {cycleId:cycle.cycleId,planRevision:revision};
 }
 next(s) {
  const cycle=s.cycle;
  if(!cycle || ['planning','blocked','delivered','paused'].includes(cycle.phase))return;
  const task=cycle.tasks.find(t=>canRunTask(t,cycle,s.questions));
  // Ready checkpoints take priority over dependents; unrelated tasks can still run while a question blocks a gate.
  const gate=cycle.gates.find(g=>g.status==='pending' && !s.questions.some(q=>!q.answered&&q.gateIds?.includes(g.id)) &&
   (g.phase==='checkpoint'?g.afterTasks.every(id=>cycle.tasks.some(t=>t.id===id&&t.status==='implemented')):cycle.tasks.every(t=>t.status==='implemented')) &&
   (g.kind==='check'||cycle.gates.filter(x=>x.kind==='check'&&(g.phase!=='checkpoint'||x.phase==='checkpoint')).every(x=>['passed','reused'].includes(x.status))));
  if(gate?.phase==='checkpoint') return {kind:'gate',unit:gate};
  if(task)return {kind:'task',unit:task};
  if(gate)return {kind:'gate',unit:gate};
  if(canDeliver(cycle,s.questions))return {kind:'deliver'};
 }
 valid(c,token) {
  const s=this.state(c),cycle=s.cycle;
  return s.status==='working' && cycle?.cycleId===token.cycleId && cycle.planRevision===token.planRevision && cycle.generation===token.generation &&
   (token.kind!=='task'||cycle.tasks.some(t=>t.id===token.unitId&&t.activeToken===token.scheduleId&&t.status==='running')) &&
   (token.kind!=='gate'||cycle.gates.some(g=>g.id===token.unitId&&g.activeToken===token.scheduleId&&g.status==='running'));
 }
 gate(c,gateId,patch) {this.update(c,{gates:this.state(c).cycle.gates.map(g=>g.id===gateId?{...g,...patch}:g)});}
 async step(c) {
  const s=this.state(c),work=this.next(s);if(!work)return;
  if(work.kind==='deliver')return this.deliver(c);
  const cycle=s.cycle,unit=work.unit;
  const attempt=s.events.filter(e=>e.type==='workflow_start'&&e.data.cycleId===cycle.cycleId&&e.data.unitId===unit.id).length+1;
  const token={cycleId:cycle.cycleId,planRevision:cycle.planRevision,generation:cycle.generation,kind:work.kind,unitId:unit.id,attempt,
   scheduleId:fingerprint([cycle.cycleId,cycle.planRevision,unit.id,work.kind,unit.status,cycle.finalCommit,attempt])};
  this.event(c,'workflow_start',token);
  if(work.kind==='task')this.event(c,'task_update',{id:unit.id,status:'running',activeToken:token.scheduleId});
  else this.gate(c,unit.id,{status:'running',activeToken:token.scheduleId});
  try {
   if(work.kind==='task') await this.execute(c,unit,token);
   else await this.verify(c,unit,token);
  }catch(error){
   this.event(c,'workflow_failure',{...token,error:error.message,category:error.retryAt?'rate_limit':error.signal?'interrupted':'environment_or_protocol'});
   if(!this.valid(c,token))return;
   if(error.retryAt){
    if(work.kind==='task')this.event(c,'task_update',{id:unit.id,status:'rate_wait',resumeStatus:unit.status});else this.gate(c,unit.id,{status:'rate_wait'});
    this.e.retry(c,unit.id,error.retryAt,()=>{if(work.kind==='task')this.event(c,'task_update',{id:unit.id,status:unit.status});else this.gate(c,unit.id,{status:'pending'});this.e.pump();});
   }else this.block(c,'运行环境或协议失败，请修复后继续。', [token.scheduleId]);
  }
 }
 block(c,reason,evidenceIds=[]) {this.update(c,{phase:'blocked',blockedReason:reason});this.event(c,'workflow_blocked',{cycleId:this.state(c).cycleId,reason,evidenceIds});}
 async escalate(c,reason,evidenceIds) {
  this.block(c,reason,evidenceIds);
  if(shouldWakePlanner(reason,evidenceIds)) {
   const cycle=this.state(c).cycle;
   if(cycle.replans>=cycle.budgets.replans) return;
   this.event(c,'planner_trigger',{cycleId:cycle.cycleId,reason,evidenceIds});
   await this.e.wake(c,{reason,evidenceIds});
  }
 }
 context(c,role,unit) {
  const s=this.state(c),x=s.cycle;
  const common={role,project:s.path,cycleId:x.cycleId,goal:x.goal,planRevision:x.planRevision,criteria:x.criteria,conventions:x.conventions};
  if(role==='executor')return {...common,task:unit,issues:x.issues.filter(i=>i.taskId===unit.id&&!i.closed),dependencies:unit.dependsOn.map(id=>x.tasks.find(t=>t.id===id)).map(t=>({id:t.id,summary:t.summary,commit:t.commit})),answers:s.questions.filter(q=>unit.waitsForQuestions?.includes(q.id)),eventReferences:s.events.filter(e=>e.data.cycleId===x.cycleId&&['check','workflow_blocked'].includes(e.type)).slice(-5).map(e=>({eventId:e.id,type:e.type,output:e.data.output?.slice(-3000)}))};
  return {...common,gate:unit,reviewedCommit:x.finalCommit,tasks:x.tasks.map(t=>({id:t.id,title:t.title,summary:t.summary,scope:t.scope,commit:t.commit})),checks:x.evidence.filter(e=>e.commit===x.finalCommit),issues:x.issues,previousReviewedCommit:x.reviewedCommit};
 }
 async execute(c,task,token) {
  const s=this.state(c),before=this.e.git(s.path,['rev-parse','HEAD']);
  const member=s.members.find(m=>m.id===task.member);
  const result=await this.e.model(c,member,JSON.stringify(this.context(c,'executor',task)),{role:'executor',purpose:task.status==='repair'?'repair':'execute',trigger:task.status==='repair'?'blocking_issue':'dependency_ready',cycleId:token.cycleId,taskId:task.id,taskRole:'member',fresh:true});
  if(!this.valid(c,token)){this.event(c,'workflow_stale_result',token);return;}
  validateRoleResult('executor',result);
  if(result.completion!=='complete') {this.event(c,'task_update',{id:task.id,status:'blocked',advice:result.blockers});await this.escalate(c,'contract_invalid',[token.scheduleId]);return;}
  this.e.git(s.path,['add','--all']);this.e.git(s.path,['commit','--allow-empty','-m',task.title]);
  const commit=this.e.git(s.path,['rev-parse','HEAD']),files=this.e.git(s.path,['diff','--name-only',before,commit]).split('\n').filter(Boolean);
  this.event(c,'task_update',{id:task.id,status:'implemented',commit,summary:result.summary,files,selfTests:result.selfTests,handoff:result.handoff});
  if(files.some(f=>!inScope(f,task.scope)||!inScope(f,s.cycle.scope))) {await this.escalate(c,'scope_expanded',[token.scheduleId]);return;}
  this.update(c,{finalCommit:commit,phase:'executing'});
  this.event(c,'workflow_complete',{...token,commit});
 }
 async worktree(c,commit,fn) {
  const s=this.state(c),path=join(this.e.config.data,'validation',id());mkdirSync(join(this.e.config.data,'validation'),{recursive:true});
  this.e.git(s.path,['worktree','add','--detach',path,commit]);
  try{return await fn(path);}finally{this.e.git(s.path,['worktree','remove','--force',path]);}
 }
 async verify(c,gate,token) {
  const s=this.state(c),cycle=s.cycle;
  let commit=cycle.finalCommit || this.e.git(s.path,['rev-parse','HEAD']);
  if(this.e.git(s.path,['status','--porcelain'])) {await this.escalate(c,'ambiguous_recovery',[token.scheduleId]);return;}
  this.update(c,{phase:gate.kind==='check'?'validating':'reviewing',finalCommit:commit});
  if(gate.kind==='model')return this.review(c,gate,token,commit);
  const tree=this.e.git(s.path,['rev-parse',`${commit}^{tree}`]);
  const environment=verificationEnvironment(this.e.config),fp=checkFingerprint({commit,tree,gate,planRevision:cycle.planRevision,criteria:cycle.criteria,environment});
  const old=reusableEvidence(cycle.evidence,fp,gate);
  const started=new Date().toISOString();
  let result;
  if(old)result={exitCode:0,output:'复用正式证据 '+old.evidenceId};
  else result=await this.worktree(c,commit,async path=>{
   const r=await executeCheck(this.e,c,path,gate,token);
   const changes=unexpectedChanges(this.e.git.bind(this.e),path,gate.outputs);
   return {...r,...(changes.length?{exitCode:1,output:r.output+'\n验证修改了源码或未声明文件: '+changes.join(',')}:{} )};
  });
  if(!this.valid(c,token)){this.event(c,'workflow_stale_result',token);return;}
  if(result.interrupted){this.block(c,'检查被中断',[token.scheduleId]);return;}
  if(this.e.git(s.path,['rev-parse','HEAD'])!==commit||this.e.git(s.path,['status','--porcelain'])){await this.escalate(c,'ambiguous_recovery',[token.scheduleId]);return;}
  const evidence={evidenceId:id(),cycleId:cycle.cycleId,planRevision:cycle.planRevision,checkId:gate.id,commit,tree,fingerprint:fp,commandSpecHash:fingerprint(gate),environment,source:old?'reused':'executed',reusedFrom:old?.evidenceId,result:result.exitCode===0?'passed':'failed',exitCode:result.exitCode,output:result.output,started,ended:new Date().toISOString()};
  this.event(c,'check',{...evidence,...token,passed:result.exitCode===0,command:gate.commands.join('\n')});
  this.update(c,{evidence:[...this.state(c).cycle.evidence,evidence]});
  this.gate(c,gate.id,{status:result.exitCode===0?(old?'reused':'passed'):'failed',commit,planRevision:cycle.planRevision,evidenceIds:[evidence.evidenceId]});
  if(result.exitCode!==0) {this.block(c,'正式检查失败',[evidence.evidenceId]);return;}
  this.event(c,'workflow_complete',{...token,commit,evidenceId:evidence.evidenceId});
 }
 async review(c,gate,token,commit) {
  const s=this.state(c),member=s.members.find(m=>m.id===gate.reviewerId);
  this.event(c,'cycle_review_start',{...token,gateId:gate.id,from:s.cycle.tasks.at(-1)?.member,to:member.id,commit});
  const result=await this.worktree(c,commit,async path=>{
   const r=await this.e.model(c,member,JSON.stringify(this.context(c,'reviewer',gate)),{role:'reviewer',readOnly:true,cwd:path,fresh:true,cycleId:token.cycleId,gateId:gate.id,purpose:gate.phase==='recheck'?'recheck':'review',trigger:gate.phase==='checkpoint'?'checkpoint_assumption':'formal_checks_passed'});
   if(unexpectedChanges(this.e.git.bind(this.e),path,[]).length)throw Error('只读审查修改了快照');return r;
  });
  if(!this.valid(c,token)){this.event(c,'workflow_stale_result',token);return;}
  validateRoleResult('reviewer',result);
  if(result.reviewedCommit!==commit||gate.criteriaIds.some(id=>!result.criteriaIds.includes(id)))throw Error('审查未覆盖固定提交或验收标准');
  this.event(c,'cycle_review',{...token,gateId:gate.id,reviewer:member.id,commit,...result});
  this.update(c,{reviewedCommit:commit,advisories:result.advisories});
  if(result.blockingIssues.length || result.needsVerification.length){
   this.gate(c,gate.id,{status:'changes_requested',commit,planRevision:token.planRevision});
   this.update(c,{issues:[...result.blockingIssues.map(i=>({...i,kind:'blocking',closed:false})),...result.needsVerification.map(i=>({...i,kind:'needs_verification',closed:false}))]});
   this.block(c,'审查存在需处理问题',[token.scheduleId]);return;
  }
  this.gate(c,gate.id,{status:'passed',commit,planRevision:token.planRevision,reviewedCommit:commit});
  this.event(c,'workflow_complete',{...token,commit});
 }
 deliver(c) {
  const s=this.state(c),x=s.cycle;
  if(!canDeliver(x,s.questions))throw Error('批次尚未满足交付条件');
  if(this.e.git(s.path,['rev-parse','HEAD'])!==x.finalCommit||this.e.git(s.path,['status','--porcelain']))throw Error('交付快照已变化');
  const text=[x.goal,...x.tasks.map(t=>`- ${t.title}：${t.summary}`),`最终提交：${x.finalCommit}`,`检查：${x.gates.filter(g=>g.kind==='check').map(g=>g.id+' '+g.status).join('；')}`,x.policy==='checks_only'?'按策略无需模型审查':`独立审查提交：${x.reviewedCommit}`,x.tasks.map(t=>t.handoff).filter(Boolean).join('\n')].join('\n');
  const delivery={cycleId:x.cycleId,finalCommit:x.finalCommit,reviewedCommit:x.reviewedCommit,policy:x.policy,checks:x.evidence,reviewCoverage:x.gates.filter(g=>g.kind==='model'),unresolvedIssues:x.issues.filter(i=>!i.closed),tasks:x.tasks,usage:x.tasks.map(t=>t.handoff).filter(Boolean).join('\n')};
  this.update(c,{phase:'delivered',delivery});this.event(c,'report',{text,...delivery});this.event(c,'status',{status:'done'});return delivery;
 }
 resume(c) {
  const s=this.state(c),x=s.cycle;if(!x)return;
  this.update(c,{generation:x.generation+1,gates:x.gates.map(g=>['running','rate_wait'].includes(g.status)?{...g,status:'pending'}:g),phase:x.resumePhase || (x.phase==='blocked'?'executing':x.phase)});
  this.event(c,'status',{status:'working'});
  if(x.tasks.some(t=>t.status==='running')) {this.escalate(c,'ambiguous_recovery',s.events.filter(e=>e.type==='workflow_start').slice(-1).map(e=>String(e.id)));return;}
  for(const task of x.tasks.filter(t=>t.status==='rate_wait'))this.event(c,'task_update',{id:task.id,status:task.resumeStatus||'queued'});
  this.e.pump();
 }
 pause(c) {const x=this.state(c).cycle;if(x)this.update(c,{generation:x.generation+1,resumePhase:x.phase,phase:'paused'});}
}
