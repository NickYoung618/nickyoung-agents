import {readFileSync} from 'node:fs';
export class Resources{
 constructor(limit=4){this.limit=limit;this.active=new Map();this.queue=[];this.closed=false;this.sequence=0;this.memoryAvailable=()=>{try{return Number(readFileSync('/proc/meminfo','utf8').match(/MemAvailable:\s+(\d+)/)?.[1]||1048576)/1024;}catch{return 1024;}};this.timer=setInterval(()=>{if(this.queue.length)this.drain();},1000);this.timer.unref();}
 snapshot(){return{availableMb:Math.round(this.memoryAvailable()),limit:this.limit,used:[...this.active.values()].reduce((n,x)=>n+x.cost,0),active:[...this.active.values()],queue:this.queue.map(({name,cost,since})=>({name,cost,since}))};}
 acquire(name,cost=1,onWait=()=>{}){if(this.closed)return Promise.reject(Error('服务正在排空'));if(cost>this.limit)return Promise.reject(Error('任务需要的资源预算高于总预算，请调整资源预算')); return new Promise((resolve,reject)=>{const item={id:++this.sequence,name,cost,since:Date.now(),resolve,reject};this.queue.push(item);this.drain();if(this.queue.includes(item))onWait(this.snapshot());});}
 drain(){let available=this.limit-this.snapshot().used;for(const q of [...this.queue]){if(q.cost>available||q.cost>=2&&this.memoryAvailable()<512)continue;available-=q.cost;this.queue.splice(this.queue.indexOf(q),1);this.active.set(q.id,{name:q.name,cost:q.cost,since:Date.now()});q.resolve(()=>{this.active.delete(q.id);this.drain();});}}
 close(){this.closed=true;clearInterval(this.timer);for(const q of this.queue.splice(0))q.reject(Error('服务排空，资源等待已取消'));}
}
