import test from 'node:test';
import assert from 'node:assert/strict';
import { progress, timeline, deliveryEvidence } from '../public/studio/event-projection.mjs';
import { graphPositions, studioEdges } from '../public/studio/agent-graph.mjs';
import { draftManager } from '../public/studio/draft-manager.mjs';
const state = () => ({ status: 'working', members: [{id:'leader',name:'知行'},{id:'dev',name:'砚舟',status:'running'},{id:'reviewer',name:'青禾'}], tasks:[{id:'t',title:'实现工具',status:'reviewing',member:'dev',reviewer:'reviewer'}], questions:[], events:[] });
test('摘要区分审查者、暂停、已交付和等待决定', () => {
  const s = state(); assert.match(progress(s).action, /青禾/);
  s.status = 'paused'; assert.match(progress(s).next, /继续/);
  s.status = 'done'; assert.match(progress(s).action, /已交付/);
  s.status = 'idle'; s.tasks = []; s.members = []; s.questions = [{answered:false}];
  assert.equal(progress(s).waiting, 1); assert.match(progress(s).next, /待你决定/);
});
test('5000 条事件只投影最近关键进展，过程不会淹没结论', () => {
  const events = Array.from({length:5000}, (_,id)=>({id, type:id%100 ? 'process' : 'message'}));
  assert.equal(timeline(events).length,8); assert.equal(timeline(events).at(-1).id,4900);
});
test('1 至 8 成员布局均在边界内，节点不重叠', () => {
  for(const width of [220,252,298,380]) for(let n=1;n<=8;n++) {
    const height = n>4 ? Math.ceil(n/2)*106 : 282;
    const points = [...graphPositions(Array.from({length:n},(_,id)=>({id})),width,height).values()];
    for(const p of points) { assert.ok(p.x>=50 && p.x<=width-50); assert.ok(p.y>=41 && p.y<=height-41); }
    points.forEach((a,i)=>points.slice(i+1).forEach(b=>assert.ok(Math.abs(a.x-b.x)>=100 || Math.abs(a.y-b.y)>=82)));
  }
});
test('派发、送审、返修和同伴问答保留事件 ID 与正确方向', () => {
  const s=state(); s.events=[{id:1,type:'task',data:{id:'t',member:'dev'}},{id:2,type:'task_update',data:{id:'t',status:'review'}},{id:3,type:'review',data:{task:'t',verdict:'fail'}},{id:4,type:'member_question',data:{from:'dev',to:'青禾'}},{id:5,type:'member_answer',data:{from:'reviewer',to:'dev'}}];
  assert.deepEqual(studioEdges(s).map(e=>[e.id,e.from,e.to]),[[1,'leader','dev'],[2,'dev','reviewer'],[3,'reviewer','dev'],[4,'dev','reviewer'],[5,'reviewer','dev']]);
});
test('草稿按会话隔离，存储不可用有反馈', () => {
  const map=new Map(), drafts=draftManager({getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)});
  drafts.write(undefined,{text:'首页'}); drafts.write('a',{text:'补充'}); assert.equal(drafts.read().text,'首页'); assert.equal(drafts.read('a').text,'补充'); drafts.clear('a'); assert.deepEqual(drafts.read('a'),{});
  let failed=false; draftManager({setItem(){throw Error();}},()=>failed=true).write('a',{}); assert.ok(failed);
});
test('多次交付证据只统计相应报告前的回合，不隐藏失败', () => {
  const s=state(); s.events=[{id:1,type:'check',data:{passed:true}},{id:2,type:'report',data:{text:'旧报告'}},{id:3,type:'check',data:{passed:false}},{id:4,type:'check',data:{passed:true}},{id:5,type:'review',data:{verdict:'pass',commit:'abc'}},{id:6,type:'report',data:{text:'新报告'}}];
  const evidence=deliveryEvidence(s,s.events.at(-1)); assert.equal(evidence.passed,1); assert.equal(evidence.failed,1); assert.equal(evidence.reviews[0].commit,'abc');
});
