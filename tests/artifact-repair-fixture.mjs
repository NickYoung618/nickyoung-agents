import {DatabaseSync,backup} from 'node:sqlite';
import {mkdtempSync,readFileSync,writeFileSync,cpSync,existsSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawn,execFileSync} from 'node:child_process';import https from 'node:https';import {setTimeout as delay} from 'node:timers/promises';
export async function launchFixture(port=18931,options={}){
 const persisted=JSON.parse(readFileSync('evidence/artifact-repair-20261113/fixture-source.json'));
 const source=persisted;const dir=mkdtempSync(join(tmpdir(),'ny-workbench-repair-'));
 const project=join(dir,'fixture-project');execFileSync('git',['clone','-q',resolve('evidence/artifact-repair-20261113/fixture-source.bundle'),project]);
 const {Store}=await import('../src/store.mjs');const store=new Store(join(dir,'events.sqlite'));
 store.append(source.conversationId,'created',{path:project,title:'真实成果提交重建的隔离夹具',branch:execFileSync('git',['-C',project,'branch','--show-current'],{encoding:'utf8'}).trim(),status:'done'});
 for(const m of source.members)store.append(source.conversationId,'recruit',{...m,status:'idle'});
 for(const t of source.tasks)store.append(source.conversationId,'task',t);
 for(const original of source.artifacts){const a={...original,project};store.append(source.conversationId,'artifact',a);const snapshot=join(dir,'artifacts',a.id);mkdirSync(snapshot,{recursive:true});execFileSync('tar',['-x','-C',snapshot],{input:execFileSync('git',['-C',project,'archive',a.commit],{maxBuffer:8000000})});}
 store.db.close();
 const config={data:dir,workspace:join(dir,'workspace'),host:'127.0.0.1',port,leader:{channel:'codex',model:'fixture',effort:'low'},tiers:[],names:[],concurrency:2,timeout:60000};Object.assign(config,options.config||{});await options.setup?.(dir,config);writeFileSync(join(dir,'config.json'),JSON.stringify(config));let token;
 const spawnServer=()=>spawn(process.execPath,[resolve(options.sourceRoot||process.env.NY_FIXTURE_SOURCE_ROOT||'.','src/server.mjs')],{env:{...process.env,NY_DATA:dir,NY_PORT:String(port),NY_HOST:'127.0.0.1',...options.env},stdio:['ignore','ignore','pipe']});let child=spawnServer();let stderr='';child.stderr.on('data',x=>stderr+=x);
 const origin=`https://127.0.0.1:${port}`;
 const call=(path,data)=>new Promise((yes,no)=>{const req=https.request(origin+'/api/'+path,{method:data===undefined?'GET':'POST',rejectUnauthorized:false,headers:{Cookie:'ny_session='+token,'Content-Type':'application/json'}},res=>{let text='';res.on('data',x=>text+=x);res.on('end',()=>{try{yes({status:res.statusCode,body:JSON.parse(text)});}catch{no(Error(text));}});});req.on('error',no);req.end(data===undefined?undefined:JSON.stringify(data));});
 let ready=false;for(let n=0;n<80;n++){try{await call('ui-version');ready=true;break;}catch{if(child.exitCode!==null)throw Error(stderr);await delay(100);}}if(!ready)throw Error('fixture startup timeout '+stderr);
 const login=await new Promise((yes,no)=>{const req=https.request(origin+'/api/login',{method:'POST',rejectUnauthorized:false,headers:{'Content-Type':'application/json'}},res=>{res.resume();res.on('end',()=>yes(res.headers['set-cookie']));});req.on('error',no);req.end(JSON.stringify({password:readFileSync(join(dir,'initial-password'),'utf8').trim()}));});token=login[0].split(';')[0].split('=')[1];
 const artifacts=(await call(`conversations/${source.conversationId}/artifacts`)).body;
 return{dir,origin,token,call,source,artifacts,get child(){return child;},async close(){if(child.exitCode!==null||child.signalCode!==null)return;child.kill('SIGTERM');await new Promise(r=>child.once('close',r));},async restart(){await this.close();child=spawnServer();child.stderr.on('data',x=>stderr+=x);for(let n=0;n<100;n++){try{await call('ui-version');return;}catch{await delay(100);}}throw Error('restart timeout '+stderr);},base(a){return`conversations/${source.conversationId}/artifacts/${a.id}`;}};
}
