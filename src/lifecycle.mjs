export class Lifecycle{
 constructor(server,engine,artifacts,clients,store){Object.assign(this,{server,engine,artifacts,clients,store});this.maintenance=false;this.sockets=new Set();server.on('connection',s=>{this.sockets.add(s);s.on('close',()=>this.sockets.delete(s));});}
 busy(){return this.engine.running.size||this.engine.busyProjects.size||this.engine.waking.size||this.artifacts.starting.size||this.artifacts.verifying.size||this.artifacts.preparations.size||this.artifacts.upgrades?.size||this.store.summaries().some(s=>s.status==='working');}
 async drain(){if(this.busy())throw Error('仍有运行中任务，请等待安全窗口');this.maintenance=true;this.engine.draining=true;await this.artifacts.close();return this.status();}
 status(){return{maintenance:this.maintenance,connections:this.sockets.size,running:this.engine.running.size};}
 async shutdown(){if(this.stopping)return this.stopping;this.maintenance=true;this.engine.draining=true;
 this.stopping=(async()=>{
  const started=Date.now();for(const r of this.clients)r.end();this.clients.clear();
  // Persist stop intent before process cancellation; task finalizers persist their final work checkpoint.
  const processes=[...this.engine.running.values()];this.resources?.close();this.engine.shutdown();const closingArtifacts=this.artifacts.close();
  await Promise.allSettled(processes.map(p=>p.promise));
  while(this.engine.busyProjects.size||this.engine.waking.size)await new Promise(r=>setTimeout(r,20));
  await closingArtifacts;
  const closed=new Promise(resolve=>this.server.close(resolve));this.server.closeIdleConnections?.();
  for(const socket of this.sockets)socket.destroy();this.server.closeAllConnections?.();await closed;
  return{duration:Date.now()-started,connections:this.sockets.size};
 })();return this.stopping;}
}
