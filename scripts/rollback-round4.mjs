import {Store} from '../src/store.mjs';import {mkdirSync,readFileSync,writeFileSync,symlinkSync,existsSync} from 'node:fs';import {join,resolve} from 'node:path';import {execFileSync} from 'node:child_process';import {homedir} from 'node:os';
export async function rollbackRelease(backupDir){
 const root=resolve(import.meta.dirname,'..'),data=join(root,'data'),store=new Store(join(data,'events.sqlite'));
 if(store.summaries().some(s=>s.status==='working'||s.members.some(m=>m.status==='running')))throw Error('有运行中任务，拒绝强行回滚');
 const previous=JSON.parse(readFileSync(join(backupDir,'previous.json'))),target=previous.root===root?join(data,'releases','rollback-'+Date.now()):previous.root;
 if(previous.root===root){mkdirSync(target,{recursive:true});execFileSync('tar',['-xf',join(backupDir,'known-good-code.tar'),'-C',target]);symlinkSync(join(root,'node_modules'),join(target,'node_modules'),'dir');}
 // Reconstruct the legacy representation before running a version without external payload support.
 if(!previous.version.version.startsWith('20261113-workbench-4'))store.materializePayloads();
 const dir=join(homedir(),'.config/systemd/user/nickyoung.service.d');mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'release.conf'),`[Service]\nWorkingDirectory=${target}\nExecStart=\nExecStart=${process.execPath} ${target}/src/server.mjs\nEnvironment=NY_DATA=${data}\nEnvironment=NY_REVISION=${previous.version.revision||'rollback'}\nTimeoutStopSec=20\n`);
 execFileSync('systemctl',['--user','daemon-reload']);execFileSync('systemctl',['--user','restart','nickyoung'],{timeout:22000});store.db.close();return{target,database:'保留当前数据库和使用数据，未覆盖备份'};
}
if(process.argv[1]===import.meta.filename){if(!process.argv[2])throw Error('用法：node scripts/rollback-round4.mjs <backup绝对路径>');console.log(await rollbackRelease(resolve(process.argv[2])));}
