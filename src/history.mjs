import {existsSync} from 'node:fs';import {gitText} from './project-support.mjs';
export function historicalCandidates(s){
 if(!s.tasks.length)return{kind:'answer',candidates:[],reason:'问答会话，无需开发成果'};
 if(!existsSync(s.path))return{kind:'missing',candidates:[],reason:'原项目目录不存在'};
 const task=[...s.tasks].reverse().find(t=>['passed','resolved'].includes(t.status)&&t.commit);if(!task)return{kind:'missing',candidates:[],reason:'无可追溯通过的提交'};
 let files,pkg={};try{files=gitText(s.path,['ls-tree','-r','--name-only',task.commit]).trim().split('\n');if(files.includes('package.json'))pkg=JSON.parse(gitText(s.path,['show',task.commit+':package.json']));}catch(e){return{kind:'missing',candidates:[],reason:'提交不可读取：'+e.message};}
 const provenance={kind:'historical',source:'实际 Git 提交与文件检查',confidence:'candidate',reportIds:s.events.filter(e=>e.type==='report').map(e=>e.id)};const candidates=[];
 if(pkg.scripts?.build&&files.includes('index.html')&&files.includes('package-lock.json')){
  let scenarios=[],limits=['历史项目在固定提交的独立目录重新构建和验证，原报告不变'];
  if(files.includes('src/animation.ts'))scenarios=[{name:'动画暂停、继续和重播',steps:[{action:'text',selector:'h1',value:'具身智能'},{action:'click',selector:'#play-toggle'},{action:'text',selector:'#play-toggle',value:'继续'},{action:'click',selector:'#play-toggle'},{action:'text',selector:'#play-toggle',value:'暂停'},{action:'click',selector:'#replay'},{action:'text',selector:'#play-status',value:'循环'}]}];
  if(files.includes('src/graph/model.ts')){scenarios=[{name:'演示协作图选择与搜索',steps:[{action:'text',selector:'h1',value:'OpenCode 多智能体协作图'},{action:'click',selector:'button[aria-label="选择智能体 砚舟，开发，运行中"]'},{action:'text',selector:'aside',value:'砚舟'},{action:'fill',selector:'input[type="search"]',value:'不存在'},{action:'text',selector:'main',value:'没有匹配的智能体'}]}];limits.push('预览提供演示模式；真实 OpenCode 连接需要独立部署及服务认证/CORS配置，不代理外部服务');}
  candidates.push({key:'historical-web',type:'web',name:pkg.name||s.title,description:s.title,entry:'index.html',build:{script:'build',output:'dist'},scenarios,limits,provenance});
 }
 const bin=typeof pkg.bin==='string'?pkg.bin:Object.values(pkg.bin||{})[0];
 if(bin&&files.includes(bin)){
  const todo=bin==='todo.js',name=todo?'待办 CLI':'名字列表 CLI';
  const example=todo?{args:[bin,'add','历史核验'],expected:'已添加 #1 历史核验',steps:[{args:[bin,'list'],expected:'[ ] 1. 历史核验'}]}:{args:[bin,'add','历史核验'],expected:'',steps:[{args:[bin,'list'],expected:'历史核验'}]};
  candidates.push({key:'historical-cli',type:'cli',name,description:s.title,entry:bin,example,limits:['使用 Node 24；使用数据不包含在源码包内'],provenance});
 }
 if(files.includes('README.md'))candidates.push({key:'historical-document',type:'document',name:'使用说明 / 本次文档修改',description:s.title,entry:'README.md',limits:[],provenance});
 return{kind:candidates.length?'recoverable':'unsupported',task,candidates,reason:candidates.length?'来自实际文件，等待独立核验':'未发现受支持入口，保留原报告并记录限制'};
}
export async function recoverHistorical(store,manager,{register=true}={}){
 const result=[];for(const s of store.summaries()){
  if(manager.list(s.id).some(a=>a.provenance?.kind==='historical')&&manager.list(s.id).every(a=>a.verification.status==='passed')){result.push({id:s.id,title:s.title,status:'already-registered',artifacts:manager.list(s.id).length});continue;}
  const candidate=historicalCandidates(s);manager.event(s.id,'historical_candidate',{kind:candidate.kind,reason:candidate.reason,commit:candidate.task?.commit,candidates:candidate.candidates.map(d=>({name:d.name,type:d.type,entry:d.entry,confidence:'unverified'}))});
  let artifacts=[];try{if(candidate.candidates.length)artifacts=await manager.collect(s.id,candidate.task,s.path,{artifacts:candidate.candidates});const latest=new Map();for(const a of manager.list(s.id))if(!latest.has(a.key)||latest.get(a.key).version<a.version)latest.set(a.key,a);artifacts=[...latest.values()];}catch(e){candidate.reason=e.message;}
  const item={id:s.id,title:s.title,project:s.path,commit:candidate.task?.commit,status:artifacts.some(a=>a.verification.status==='passed')?'recovered':candidate.kind==='answer'?'answer-only':'unavailable',reason:candidate.reason,artifacts:artifacts.map(a=>({id:a.id,type:a.type,name:a.name,status:a.verification.status,reason:a.verification.reason,limits:a.limits}))};manager.event(s.id,'historical_result',item);result.push(item);
 }return result;
}
