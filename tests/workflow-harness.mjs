import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,mkdirSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Engine} from '../src/engine.mjs';import {Store} from '../src/store.mjs';
import {plan,members} from './workflow-fixtures.mjs';
export function setup() {
 const dir=mkdtempSync(join(tmpdir(),'ny-workflow-'));const path=join(dir,'source');mkdirSync(path);
 const e=new Engine(new Store(':memory:'),{data:join(dir,'data'),workspace:dir,concurrency:1,timeout:10000,leader:{},tiers:[{id:'main',model:'fixture',channel:'codex'}]},()=>{},()=>{});
 e.git(path,['init']);e.git(path,['commit','--allow-empty','-m','initial']);
 e.event('a','created',{workflowVersion:'adaptive_v1',path,branch:'fixture',status:'working'});e.event('a','recruit',{id:'leader'});
 for(const m of members)e.event('a','recruit',m);
 const calls=[];
 e.model=async(c,m,prompt,opts)=>{
  calls.push({member:m.id,...opts});const data=JSON.parse(prompt);
  if(opts.role==='planner')return {message:'plan',recruits:[],plan:plan(5)};
  if(opts.role==='executor'){mkdirSync(join(path,'src'),{recursive:true});writeFileSync(join(path,'src',data.task.localId+'.txt'),data.task.title);return {message:'implemented',completion:'complete',summary:data.task.title,files:['src/'+data.task.localId+'.txt'],selfTests:[],blockers:'',handoff:'node --test'};}
  return {message:'reviewed',reviewedCommit:data.reviewedCommit,criteriaIds:['c'],blockingIssues:[],advisories:['可选建议'],needsVerification:[]};
 };
 return {e,dir,path,calls,clean:()=>{e.shutdown();e.store.db.close();rmSync(dir,{recursive:true,force:true});}};
}
export async function drain(e) {for(const deadline=Date.now()+45000;Date.now()<deadline;){e.pump();await new Promise(r=>setTimeout(r,20));if(!e.busyProjects.size&&!e.waking.size)return;}throw Error('fixture 未收敛');}
