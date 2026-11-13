import {mkdirSync,existsSync,cpSync,renameSync,symlinkSync,rmSync,realpathSync,lstatSync} from 'node:fs';import {join,resolve} from 'node:path';import {randomUUID} from 'node:crypto';import {command} from './project-support.mjs';
export function usageFor(manager,a){const tracks=manager.store.summaries().flatMap(s=>s.events).filter(e=>e.type==='usage_track'&&e.data.key===a.key&&(e.data.projectId?a.projectId===e.data.projectId:e.conversation===a.conversation)).sort((x,y)=>x.id-y.id).map(e=>{const t={...e.data};if(t.dir?.includes('/usage/'))t.dir=join(manager.data,'usage',t.dir.split('/usage/').at(-1));return t;});return{own:tracks.findLast(t=>t.id===a.id),active:tracks.at(-1)};}
export function bindData(manager,a,root,{validation=false,seed}={}){
 if(!a.data)return;
 const existing=usageFor(manager,a);if(!validation&&existing.active&&existing.active.id!==a.id&&!existing.own)throw Error('新版尚未迁移使用数据；请点击“升级并沿用数据”，旧版仍可使用');
 let dir=validation?join(root,'.validation-data'):existing.own?.dir||join(manager.data,'usage',a.projectId||a.conversation,a.id);mkdirSync(dir,{recursive:true});
 if(seed)cpSync(seed,dir,{recursive:true});
 for(const relative of a.data.directories||['data']){if(!relative||relative==='.'||relative.split('/').includes('..')||relative.startsWith('/'))throw Error('数据目录必须是成果内的子目录');const target=join(root,relative),shared=join(dir,relative);mkdirSync(shared,{recursive:true});let stat;try{stat=lstatSync(target);}catch{}if(stat?.isSymbolicLink()){if(existsSync(target)&&realpathSync(target)===realpathSync(shared))continue;renameSync(target,target+'.saved-'+randomUUID());}else if(stat){cpSync(target,shared,{recursive:true,force:false});renameSync(target,target+'.saved-'+randomUUID());}mkdirSync(resolve(target,'..'),{recursive:true});symlinkSync(shared,target,'dir');}
 if(!validation&&!existing.own)manager.event(a.conversation,'usage_track',{id:a.id,key:a.key,projectId:a.projectId,schema:a.data.schema,dir,commit:a.commit,time:new Date().toISOString()});
 return dir;
}
export async function upgradeUsage(manager,c,id){const a=manager.get(c,id),old=usageFor(manager,a).active;if(!a.data||!old||old.id===id)return{ok:true};if(a.verification.status!=='passed')throw Error('新版必须先通过独立验收');
 const previous=manager.get(c,old.id),wasRunning=manager.status(old.id).status==='running';manager.stop(old.id);const proc=manager.previews.get(old.id)?.child;if(proc&&proc.exitCode===null&&proc.signalCode===null)await new Promise(r=>proc.once('close',r));
 const backup=join(manager.data,'usage-backups',randomUUID()),candidate=join(manager.data,'usage-candidates',randomUUID());mkdirSync(backup,{recursive:true});mkdirSync(candidate,{recursive:true});cpSync(old.dir,backup,{recursive:true});cpSync(old.dir,candidate,{recursive:true});
 try{
  if(old.schema!==a.data.schema){if(!a.data.migrate?.entry)throw Error('数据结构变化，缺少显式迁移入口；旧数据和旧版保留');const root=manager.snapshot(a),entry=resolve(root,a.data.migrate.entry);if(!entry.startsWith(root+'/'))throw Error('迁移入口超出成果');let preparation;try{await command(process.execPath,['--permission','--allow-fs-read='+root,'--allow-fs-read='+candidate,'--allow-fs-write='+candidate,entry,candidate],{cwd:root,env:{NY_DATA_DIR:candidate},onProcess:child=>{preparation={child};manager.preparations.add(preparation);}});}finally{manager.preparations.delete(preparation);}}
  const result=await manager.verify(c,id,{dataSeed:candidate});if(result.verification.status!=='passed')throw Error('迁移数据场景验证失败：'+result.verification.reason);
  const dir=join(manager.data,'usage',a.projectId||a.conversation,a.id);mkdirSync(resolve(dir,'..'),{recursive:true});renameSync(candidate,dir);
  manager.event(c,'usage_track',{id,key:a.key,projectId:a.projectId,schema:a.data.schema,dir,previous:old.id,backup,commit:a.commit,time:new Date().toISOString()});return{ok:true,previous:old.id,backup};
 }catch(e){manager.event(c,'usage_upgrade_failed',{id,previous:old.id,reason:e.message,backup});if(wasRunning)await manager.start(c,old.id);throw e;}finally{rmSync(candidate,{recursive:true,force:true});}
}
