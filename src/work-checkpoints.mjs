import {readFileSync,writeFileSync,lstatSync,readlinkSync,symlinkSync,mkdirSync,rmSync,chmodSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {productFiles} from './artifacts.mjs';
export function readWorkFile(root,file){
 try{const path=join(root,file),stat=lstatSync(path);return stat.isSymbolicLink()?{link:readlinkSync(path)}:{content:readFileSync(path).toString('base64'),mode:stat.mode&0o777};}catch(e){if(e.code==='ENOENT')return null;throw e;}
}
export function dirtyWork(root){return Object.fromEntries(productFiles(root).map(f=>[f,readWorkFile(root,f)]));}
export const sameWork=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function preserveWork(root,files){for(const [file,value] of Object.entries(files)){const path=join(root,file);if(value===null){rmSync(path,{force:true});continue;}mkdirSync(dirname(path),{recursive:true});if(value.link!==undefined){rmSync(path,{force:true});symlinkSync(value.link,path);}else{writeFileSync(path,Buffer.from(value.content,'base64'));chmodSync(path,value.mode);}}}
export function workChanges(root,checkpoint,currentHead){
 const dirty=dirtyWork(root),own=checkpoint?.own||{},protectedFiles={...checkpoint?.protected};const conflicts=[];
 if(checkpoint && checkpoint.head!==currentHead)conflicts.push({file:'HEAD',reason:'暂停后提交已变化',expected:checkpoint.head,actual:currentHead});
 for(const [file,value] of Object.entries(own))if(!sameWork(value,readWorkFile(root,file)))conflicts.push({file,reason:'任务检查点之后文件发生变化'});
 for(const [file,value] of Object.entries(dirty))if(!(file in own))protectedFiles[file]=value;
 return {dirty,protected:protectedFiles,conflicts};
}
