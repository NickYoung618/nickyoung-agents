import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..');
const task=JSON.parse(readFileSync(resolve(root,'evidence/ux-vnext/live-task.json')));
const data=dirname(dirname(task.path));
const child=spawn(process.execPath,['src/server.mjs'],{cwd:root,env:{...process.env,NY_DATA:data,NY_PORT:'18879',NY_HOST:'127.0.0.1'},stdio:'ignore'});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try {
 const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1536,height:864}});
 let ready=false;for(let n=0;n<80;n++){try{const r=await context.request.post('https://127.0.0.1:18879/api/login',{data:{password:readFileSync(resolve(data,'initial-password'),'utf8').trim()}});if(r.ok()){ready=true;break;}}catch{}await delay(100);}
 assert.ok(ready);
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto('https://127.0.0.1:18879');await page.waitForSelector('#homeRecent button');
 for(const view of ['task','result']){await page.click(`[data-view-nav="${view}"]`);await page.waitForSelector('.ny-node');await page.screenshot({path:resolve(root,`evidence/ux-vnext/live-${view}.png`)});}
 assert.deepEqual(errors,[]);
 console.log('真实 HTTPS 页面：任务、协作图、交付成果均已截图，脚本错误 0。');
}finally{await browser.close();child.kill('SIGTERM');await new Promise(r=>child.once('close',r));}
