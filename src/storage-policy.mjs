import {readdirSync,statSync,rmSync,existsSync} from 'node:fs';import {join} from 'node:path';
export function cleanCaches(manager,now=Date.now()){
 if(manager.preparations.size||manager.verifying.size)throw Error('安装或验收运行中，稍后清理缓存');const removed=[];
 for(const name of ['build-cache','npm-cache']){const root=join(manager.data,name);if(!existsSync(root))continue;for(const entry of readdirSync(root)){const path=join(root,entry);if(now-statSync(path).mtimeMs>30*86400000){rmSync(path,{recursive:true,force:true});removed.push(name+'/'+entry);}}}
 return{removed,retained:'成果、使用数据、升级备份、数据库备份和发布版本不自动删除',temporary:'验收和示例目录完成即清理；服务启动清理中断验收目录',cache:'30天无活动缓存可在空闲窗口清理'};
}
