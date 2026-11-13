import {execFileSync,spawn} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync,mkdirSync,cpSync,rmSync} from 'node:fs';
import {join,dirname,posix,resolve} from 'node:path';
import {createHash} from 'node:crypto';
export const safeFile=f=>!/(^|\/)(\.git|node_modules|data|cache|\.cache|\.aws|\.codex|coverage|logs)(\/|$)/.test(f)&&!/(^|\/)(\.env(?:\.|$)|credentials|names\.json$)|\.(sqlite3?|db|pem|key|p12)(-|$)/i.test(f)&&(!f.startsWith('.nickyoung/')||f==='.nickyoung/artifacts.json')&&f!=='.npmrc';
export function gitText(root,args,options={}){return execFileSync('git',['-C',root,...args],{encoding:'utf8',maxBuffer:16000000,...options});}
export function inspectProject(root){let pkg={};try{pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));}catch{}return{stack:pkg.scripts?.build?'node-build':existsSync(join(root,'index.html'))?'static':'node',locked:existsSync(join(root,'package-lock.json')),dependencies:Object.keys({...pkg.dependencies,...pkg.devDependencies}),build:pkg.scripts?.build||null,start:pkg.scripts?.start||pkg.scripts?.dev||null,port:'PORT',host:'HOST',dataDirectory:'NY_DATA_DIR',supported:!existsSync(join(root,'requirements.txt'))};}
export function inputsFor(project,commit,d){
 const entries=gitText(project,['ls-tree','-r','-z',commit]).split('\0').filter(Boolean).map(x=>{const [meta,path]=x.split('\t');return{path,oid:meta.split(' ')[2]};}).filter(x=>safeFile(x.path)&&x.path!=='.nickyoung/artifacts.json');const all=new Map(entries.map(e=>[e.path,e]));const selected=new Set();
 const add=(file)=>{file=posix.normalize(file);if(selected.has(file)||!all.has(file))return;selected.add(file);if(!/\.(m?[jt]sx?|cjs|html|css)$/.test(file))return;const text=gitText(project,['show',commit+':'+file]);const refs=[...text.matchAll(/(?:from\s*|import\s*\(|require\s*\()\s*['"](\.[^'"]+)['"]|(?:src|href)=["'](\.?\/?[^"'#]+)["']/g)];for(const literal of text.matchAll(/['"]([.\w/-]+\.(?:html|css|mjs|cjs|js|json|svg))['"]/g)){const base=posix.join(posix.dirname(file),literal[1]);add(base);}for(const r of refs){const ref=r[1]||r[2];if(/^(https?:|data:)/.test(ref))continue;const base=ref.startsWith('/')?ref.slice(1):posix.join(posix.dirname(file),ref);for(const p of [base,base+'.js',base+'.ts',base+'.tsx',base+'.mjs',base+'/index.js',base+'/index.ts'])add(p);}};
 add(d.entry);if(d.type==='web')for(const f of entries)if(/\.(html|css|svg|png|jpe?g|webp|woff2?)$/.test(f.path)||f.path.startsWith('public/'))add(f.path);if(d.start?.[1])add(posix.join(d.cwd||'.',d.start[1]));if(d.example?.args?.[0])add(posix.join(d.cwd||'.',d.example.args[0]));
 for(const f of ['package.json','package-lock.json','tsconfig.json','vite.config.ts','vite.config.js'])add(f);
 if(d.build)for(const f of entries)if(!/^(tests?|docs)\//.test(f.path)&&!/^README/i.test(f.path))add(f.path);
 for(const scope of d.inputs||[])for(const f of entries)if(f.path===scope||f.path.startsWith(scope.replace(/\/$/,'')+'/'))add(f.path);
 if(d.type==='document')add(d.entry);
 return entries.filter(e=>selected.has(e.path)).sort((a,b)=>a.path.localeCompare(b.path));
}
export async function command(bin,args,{cwd,timeout=120000,onProcess=()=>{},env={}}){return new Promise((yes,no)=>{const child=spawn(bin,args,{cwd,detached:true,env:{PATH:process.env.PATH,HOME:cwd,NODE_OPTIONS:'--max-old-space-size=384',UV_THREADPOOL_SIZE:'2',...env},stdio:['ignore','pipe','pipe']});onProcess(child);let output='',expired=false;const kill=()=>{try{process.kill(-child.pid,'SIGTERM');}catch{}setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},1000).unref();};const timer=setTimeout(()=>{expired=true;kill();},timeout);for(const stream of [child.stdout,child.stderr])stream.on('data',x=>output=(output+x).slice(-200000));child.on('error',e=>{clearTimeout(timer);no(e);});child.on('close',(code,signal)=>{clearTimeout(timer);code===0?yes({output,code}):no(Error((expired?'命令超时':'命令失败 '+code+' '+(signal||''))+'\n'+output));});});}
export async function prepareArtifact(manager,a,root){
 const info=inspectProject(root);a.projectSupport=info;
 if(!a.build&&['cli','library','web'].includes(a.type)&&info.dependencies.length){if(!info.locked)throw Error('Node 依赖缺少 package-lock.json，无法准备可复现成果');a.install=true;}
 if(!a.build&&!a.install)return;
 if(!info.locked)throw Error('依赖准备需要 package-lock.json；请补充锁文件后重试');
 const started=Date.now(),release=await manager.resources?.acquire('build:'+a.name,2,()=>manager.event(a.conversation,'resource_wait',{artifact:a.id,reason:'等待安装/构建资源'}))||(()=>{});
 manager.event(a.conversation,'resource_ready',{artifact:a.id});
 const run={artifact:a.id,child:null};manager.preparations??=new Set();manager.preparations.add(run);
 try{
  const key=createHash('sha256').update(JSON.stringify({inputs:a.inputs,build:a.build,node:process.versions.node})).digest('hex');
  const cache=join(manager.data,'build-cache',key);const output=a.build?.output||'dist';
  if(a.build&&existsSync(join(cache,'ready.json'))){cpSync(join(cache,'output'),join(root,output),{recursive:true});a.runtimeEntry=posix.join(output,'index.html');a.buildEvidence={status:'passed',cached:true,key,time:new Date().toISOString()};return;}
  mkdirSync(join(manager.data,'npm-cache'),{recursive:true});
  const installAt=Date.now();await command('npm',['ci','--ignore-scripts','--no-audit','--no-fund'],{cwd:root,env:{npm_config_cache:join(manager.data,'npm-cache')},onProcess:p=>run.child=p});manager.event(a.conversation,'timing',{kind:'install',artifact:a.id,duration:Date.now()-installAt});
  if(a.build){const pkg=JSON.parse(readFileSync(join(root,'package.json')));const args=['run',a.build.script||'build'];if(pkg.devDependencies?.vite||pkg.dependencies?.vite)args.push('--','--base=./');const result=await command('npm',args,{cwd:root,onProcess:p=>run.child=p});if(!existsSync(join(root,output,'index.html')))throw Error('构建未产生 '+output+'/index.html');a.runtimeEntry=posix.join(output,'index.html');mkdirSync(cache,{recursive:true});cpSync(join(root,output),join(cache,'output'),{recursive:true});writeFileSync(join(cache,'ready.json'),JSON.stringify({commit:a.commit,inputs:a.inputs,time:new Date().toISOString()}));a.buildEvidence={status:'passed',output:result.output.slice(-4000),key,time:new Date().toISOString()};}
 }finally{release();manager.preparations.delete(run);manager.event(a.conversation,'timing',{kind:'preparation',artifact:a.id,duration:Date.now()-started});}
}
export function sourcePackage(manager,a,kind='source'){
 const root=manager.snapshot(a),dir=join(manager.data,'packages',a.id);mkdirSync(dir,{recursive:true});const stage=join(dir,'stage-'+kind);rmSync(stage,{recursive:true,force:true});mkdirSync(stage);
 let files=a.sourceFiles;try{files=gitText(a.project,['ls-tree','-r','--name-only','-z',a.commit]).split('\0').filter(Boolean).filter(safeFile);}catch{}if(!files)throw Error('缺少可恢复的源码文件清单');
 if(kind==='build'){if(!a.runtimeEntry)throw Error('此成果没有构建产物');cpSync(join(root,dirname(a.runtimeEntry)),join(stage,'site'),{recursive:true});}
 else{for(const file of files){const source=join(root,file),target=join(stage,file);mkdirSync(dirname(target),{recursive:true});cpSync(source,target);}}
 const quote=value=>"'"+String(value).replaceAll("'","'\\''")+"'";
 const staticWeb=a.type==='web'&&(a.build||!a.start?.length),serveDir=kind==='build'?'site':a.build?.output||dirname(a.entry);
 if(staticWeb)cpSync(new URL('./package-server.mjs',import.meta.url),join(stage,'NICKYOUNG-SERVE.mjs'));
 const prefix=a.cwd&&a.cwd!=='.'?'cd '+quote(a.cwd)+'\n':'';
 const usage=kind==='build'?'node NICKYOUNG-SERVE.mjs site':a.type==='web'?(a.build?'npm ci --ignore-scripts\nnpm run '+(a.build.script||'build')+' -- --base=./\nnode NICKYOUNG-SERVE.mjs '+quote(serveDir):a.start?.length?prefix+(a.install?'npm ci --ignore-scripts\n':'')+'PORT=3000 HOST=127.0.0.1 '+a.start.map(quote).join(' '):'node NICKYOUNG-SERVE.mjs '+quote(serveDir)):a.example?prefix+(a.install?'npm ci --ignore-scripts\n':'')+'node '+a.example.args.map(quote).join(' '):'打开 '+a.entry;
 writeFileSync(join(stage,'NICKYOUNG-USAGE.txt'),`${a.name}\n版本 ${a.version}\n提交 ${a.commit}\n运行环境 Node 24 或更高版本；命令从解包目录执行。\n\n${usage}\n${a.type==='web'?'在浏览器打开 http://127.0.0.1:3000；静态服务打印实际地址，Ctrl+C 停止。':''}\n\n已知限制：${(a.limits||[]).join('；')}\n不包含凭据、用户数据、node_modules 或缓存。\n`);
 const target=join(dir,kind+'.tar.gz');execFileSync('tar',['-czf',target,'-C',stage,'.']);rmSync(stage,{recursive:true,force:true});return target;
}
