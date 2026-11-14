import https from 'node:https';import {Store} from '../src/store.mjs';import {mkdirSync,readFileSync,writeFileSync,symlinkSync,existsSync} from 'node:fs';import {join,resolve} from 'node:path';import {execFileSync} from 'node:child_process';import {homedir} from 'node:os';
export async function drainForRollback(origin,token){
 const result=await new Promise((yes,no)=>{const req=https.request(origin+'/api/maintenance',{method:'POST',rejectUnauthorized:false,agent:false,headers:{Cookie:'ny_session='+token,'Content-Type':'application/json'}},res=>{let text='';res.on('data',x=>text+=x);res.on('end',()=>yes({status:res.statusCode,text}));});req.on('error',no);req.end(JSON.stringify({action:'drain'}));});
 if(result.status!==200)throw Error('回滚前无法进入安全排空窗口：'+result.text);return JSON.parse(result.text);
}
export async function rollbackRelease(backupDir){
 const root=resolve(import.meta.dirname,'..'),data=resolve(process.env.NY_DATA||resolve(backupDir,'../..')),store=new Store(join(data,'events.sqlite'));
 if(store.summaries().some(s=>s.status==='working'||s.members.some(m=>m.status==='running')))throw Error('有运行中任务，拒绝强行回滚');
 const active=execFileSync('systemctl',['--user','show','--value','--property=ActiveState','nickyoung'],{encoding:'utf8'}).trim();
 if(active==='active'){try{const token=store.db.prepare('SELECT token FROM sessions WHERE expires>? LIMIT 1').get(Date.now())?.token;await drainForRollback('https://127.0.0.1:8787',token);}catch(error){const pid=execFileSync('systemctl',['--user','show','--value','--property=MainPID','nickyoung'],{encoding:'utf8'}).trim();if(!readFileSync('/proc/'+pid+'/environ','utf8').split('\0').includes('NY_MAINTENANCE=1'))throw error;}}
 if(store.summaries().some(s=>s.status==='working'||s.members.some(m=>m.status==='running')))throw Error('排空后仍有运行任务，拒绝切换代码');
 const previous=JSON.parse(readFileSync(join(backupDir,'previous.json'))),target=!existsSync(join(previous.root,'release.json'))?join(data,'releases','rollback-'+Date.now()):previous.root;
 if(!existsSync(join(previous.root,'release.json'))){mkdirSync(target,{recursive:true});execFileSync('tar',['-xf',join(backupDir,'known-good-code.tar'),'-C',target]);symlinkSync(join(root,'node_modules'),join(target,'node_modules'),'dir');}
 // Reconstruct the legacy representation before running a version without external payload support.
 if(!previous.version.version.includes('workbench-4')&&!previous.version.version.includes('integrated'))store.materializePayloads();
 const dir=join(homedir(),'.config/systemd/user/nickyoung.service.d');mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'release.conf'),`[Service]\nWorkingDirectory=${target}\nExecStart=\nExecStart=${process.execPath} ${target}/src/server.mjs\nEnvironment=NY_DATA=${data}\nEnvironment=NY_REVISION=${previous.version.revision||'rollback'}\nTimeoutStopSec=20\n`);
 execFileSync('systemctl',['--user','daemon-reload']);execFileSync('systemctl',['--user','restart','nickyoung'],{timeout:22000});store.db.close();return{target,database:'保留当前数据库和使用数据，未覆盖备份'};
}
if(process.argv[1]===import.meta.filename){if(!process.argv[2])throw Error('用法：node scripts/rollback-round4.mjs <backup绝对路径>');console.log(await rollbackRelease(resolve(process.argv[2])));}
