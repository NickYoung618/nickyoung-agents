#!/usr/bin/env node
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';import {join} from 'node:path';
const leader=process.argv.some(a=>a.endsWith('leader-schema.json'));
const done=result=>{console.log(JSON.stringify({type:'thread.started',thread_id:'recovery-fixture'}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(result)}}));};
if(process.argv.at(-1)?.includes('"review":true')){done({message:'受控独立审查',completion:'complete',verdict:'pass',questions:[],issues:[],blockers:[]});}
else if(leader){done({message:'受控恢复负责人',actions:[]});}
else{
 const control=JSON.parse(readFileSync(process.env.NY_RECOVERY_CONTROL,'utf8'));
 if(control.mode==='wait'){
  writeFileSync(join(process.cwd(),'app.txt'),'member unfinished');writeFileSync(process.env.NY_RECOVERY_CONTROL+'.pid',String(process.pid));
  console.log(JSON.stringify({type:'thread.started',thread_id:'recovery-fixture'}));console.log(JSON.stringify({type:'item.completed',item:{type:'command_execution',command:'write app.txt',exit_code:0}}));setInterval(()=>{},1000);
 }else{
  appendFileSync(join(process.cwd(),'app.txt'),'\nresumed');done({message:'受控恢复完成',completion:'complete',questions:[],verdict:'pass',issues:[],blockers:[],files:['app.txt'],summary:'controlled recovery'});
 }
}
