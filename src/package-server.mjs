import http from 'node:http';
import {readFileSync,statSync} from 'node:fs';
import {resolve,join,extname} from 'node:path';
const root=resolve(process.argv[2]||'.');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
http.createServer((req,res)=>{try{const url=new URL(req.url,'http://localhost'),file=resolve(root,'.'+decodeURIComponent(url.pathname));if(file!==root&&!file.startsWith(root+'/')){res.writeHead(403);res.end();return;}const path=statSync(file).isDirectory()?join(file,'index.html'):file;res.setHeader('Content-Type',types[extname(path)]||'application/octet-stream');res.end(readFileSync(path));}catch{res.writeHead(404);res.end('Not found');}}).listen(Number(process.env.PORT||3000),'127.0.0.1',function(){console.log('http://127.0.0.1:'+this.address().port);});
