import {project,applyEvent} from '../public/studio/conversation-state.mjs';
import {realpathSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
const retain=new Set(['created','project_update','task','task_update','report','artifact','artifact_feedback','artifact_user_acceptance','artifact_validation','artifact_archive','check','review','question','answer','question_closed','intent','requirement_status','decision','notice','work_conflict','historical_candidate','historical_result','artifact_link','artifact_reuse','usage_track','usage_upgrade_failed','delivery_gate']);
export class Store {
 constructor(file){this.db=new DatabaseSync(file);this.cache=new Map();this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,conversation TEXT NOT NULL,type TEXT NOT NULL,data TEXT NOT NULL,time TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS conversation_registry(conversation TEXT PRIMARY KEY,first_id INTEGER,last_id INTEGER);
 CREATE TRIGGER IF NOT EXISTS register_event AFTER INSERT ON events BEGIN INSERT INTO conversation_registry VALUES(new.conversation,new.id,new.id) ON CONFLICT(conversation) DO UPDATE SET last_id=new.id; END;
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,expires INTEGER);
 CREATE INDEX IF NOT EXISTS events_conversation_id ON events(conversation,id);
 CREATE INDEX IF NOT EXISTS events_conversation_type_id ON events(conversation,type,id);
 CREATE TABLE IF NOT EXISTS project_aliases(path TEXT PRIMARY KEY,project_id TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,path TEXT UNIQUE NOT NULL);
 CREATE TABLE IF NOT EXISTS projections(conversation TEXT PRIMARY KEY,cursor INTEGER NOT NULL,state TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS event_payloads(event_id INTEGER PRIMARY KEY,data TEXT NOT NULL);`);if(!this.db.prepare('SELECT conversation FROM conversation_registry LIMIT 1').get())this.db.exec('INSERT INTO conversation_registry SELECT conversation,min(id),max(id) FROM events GROUP BY conversation');}
 append(conversation,type,data){const time=new Date().toISOString(),raw=JSON.stringify(data);const large=['work_checkpoint','process','check'].includes(type)&&raw.length>4096;
 const metadata=large?(type==='check'?{payload:true,task:data.task,passed:data.passed,commit:data.commit,command:data.command,output:'完整输出按需读取'}:{payload:true,task:data.task,head:data.head,files:Object.keys(data.own||{}),member:data.member,event:{type:data.event?.type,text:'大内容按需读取'}}):data;
 const ownTransaction=large&&!this.db.isTransaction;if(ownTransaction)this.db.exec('BEGIN');
 let id;try{const r=this.db.prepare('INSERT INTO events(conversation,type,data,time) VALUES(?,?,?,?)').run(conversation,type,JSON.stringify(metadata),time);id=Number(r.lastInsertRowid);
 if(large)this.db.prepare('INSERT INTO event_payloads VALUES(?,?)').run(id,raw);if(ownTransaction)this.db.exec('COMMIT');}catch(e){if(ownTransaction)this.db.exec('ROLLBACK');throw e;}
 this.cache.delete(conversation);return{id,conversation,type,data:metadata,time};}
 decode(row,hydrate=false){if(!row)return;const payload=hydrate&&this.db.prepare('SELECT data FROM event_payloads WHERE event_id=?').get(row.id);return{...row,data:JSON.parse(payload?.data||row.data)};}
 events(c,{light=false}={}){return this.db.prepare('SELECT * FROM events WHERE conversation=? ORDER BY id').all(c).map(r=>this.decode(r,!light));}
 latest(c,type,task){const r=task?this.db.prepare("SELECT * FROM events WHERE conversation=? AND type=? AND json_extract(data,'$.task')=? ORDER BY id DESC LIMIT 1").get(c,type,task):this.db.prepare('SELECT * FROM events WHERE conversation=? AND type=? ORDER BY id DESC LIMIT 1').get(c,type);return this.decode(r,true)?.data;}
 state(c){const max=Number(this.db.prepare('SELECT last_id id FROM conversation_registry WHERE conversation=?').get(c)?.id||0);let entry=this.cache.get(c);if(entry?.cursor===max)return structuredClone(entry.state);
 const saved=this.db.prepare('SELECT * FROM projections WHERE conversation=?').get(c);let s=saved&&saved.cursor<=max?JSON.parse(saved.state):project([]),cursor=saved&&saved.cursor<=max?saved.cursor:0;
 const rows=this.db.prepare('SELECT * FROM events WHERE conversation=? AND id>? ORDER BY id').all(c,cursor);
 for(const row of rows){const e=this.decode(row);if(!s.id)s.id=c;applyEvent(s,e);}
 const events=s.events,recent=new Set(events.slice(-80).map(e=>e.id));
 // Large process/checkpoint contents stay in the payload table, outside common projections.
 s.events=events.filter(e=>retain.has(e.type)||e.type.startsWith('cycle')||['artifact_ready','preview_status','workflow_start','planner_result','model_result','run_start','command_start','command_result'].includes(e.type)||recent.has(e.id));if(s.path&&!s.projectId)s.projectId=this.projectId(s.path);s.historyCursor=max;s.partialHistory=true;
 this.db.prepare('INSERT INTO projections VALUES(?,?,?) ON CONFLICT(conversation) DO UPDATE SET cursor=excluded.cursor,state=excluded.state').run(c,max,JSON.stringify(s));this.cache.set(c,{cursor:max,state:s});return structuredClone(s);}
 projectId(path){const canonical=existsSync(path)?realpathSync(path):resolve(path);let common=canonical;try{common=realpathSync(execFileSync('git',['-C',canonical,'rev-parse','--path-format=absolute','--git-common-dir'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim());}catch{}
 let value=this.db.prepare('SELECT project_id id FROM project_aliases WHERE path=?').get(common)||this.db.prepare('SELECT id FROM projects WHERE path=?').get(canonical)||this.db.prepare('SELECT id FROM projects WHERE path=?').get(common);
 if(!value){value={id:randomUUID()};this.db.prepare('INSERT INTO projects VALUES(?,?)').run(value.id,canonical);}
 for(const alias of [common,canonical])this.db.prepare('INSERT OR IGNORE INTO project_aliases VALUES(?,?)').run(alias,value.id);return value.id;}

 summaries(){return this.db.prepare("SELECT conversation,last_id last FROM conversation_registry WHERE conversation<>'system' ORDER BY first_id").all().map(x=>{const s=this.state(x.conversation);return{...s,events:s.events.filter((e,i)=>retain.has(e.type)||e.type.startsWith('cycle')||['artifact_ready','preview_status'].includes(e.type)||i>=s.events.length-8)};});}
 conversations(){return this.db.prepare("SELECT DISTINCT conversation FROM events WHERE conversation<>'system'").all().map(x=>project(this.events(x.conversation)));}
 page(after=0,limit=250,c){limit=Math.min(500,Math.max(1,Number(limit)||250));const rows=c?this.db.prepare('SELECT * FROM events WHERE conversation=? AND id>? ORDER BY id LIMIT ?').all(c,after,limit+1):this.db.prepare('SELECT * FROM events WHERE id>? ORDER BY id LIMIT ?').all(after,limit+1);const hasMore=rows.length>limit;return{events:rows.slice(0,limit).map(r=>this.decode(r)),cursor:Number(rows.slice(0,limit).at(-1)?.id||after),hasMore};}
 rawPage(c,before=0,limit=100){limit=Math.min(250,Math.max(1,Number(limit)||100));const rows=this.db.prepare('SELECT * FROM events WHERE conversation=? AND id<? ORDER BY id DESC LIMIT ?').all(c,Number(before)||Number.MAX_SAFE_INTEGER,limit+1);return{events:rows.slice(0,limit).reverse().map(r=>this.decode(r)),hasMore:rows.length>limit};}
 materializePayloads(){this.db.exec("UPDATE events SET data=(SELECT data FROM event_payloads WHERE event_id=events.id) WHERE id IN (SELECT event_id FROM event_payloads); DELETE FROM projections");this.cache.clear();}
}
export {project};
export function failureState(failures,design=false){return failures>=3?'stopped':design?'consultation':failures===2?'consultation':'repair';}
