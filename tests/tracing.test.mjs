import test from 'node:test';
import assert from 'node:assert/strict';
import { cycleStatistics } from '../src/statistics.mjs';
test('runId 去重、用途、未知用量与墙钟分别统计',()=>{
 const events=[{type:'run_start',time:'2026-01-01T00:00:00Z',data:{runId:'1',cycleId:'c',purpose:'execute',waitDuration:4}},
 {type:'model_result',time:'2026-01-01T00:00:01Z',data:{runId:'1',cycleId:'c',purpose:'execute',duration:1000,usage:{input_tokens:20,output_tokens:5,cached_input_tokens:3}}},
 {type:'run_start',time:'2026-01-01T00:00:00Z',data:{runId:'2',cycleId:'c',purpose:'review'}},
 {type:'run_failed',time:'2026-01-01T00:00:01Z',data:{runId:'2',cycleId:'c',purpose:'review',duration:1000}},
 {type:'run_interrupted',time:'2026-01-01T00:00:02Z',data:{runId:'3',cycleId:'c',purpose:'repair',duration:500,usage:{input_tokens:2}}}];
 const [s]=cycleStatistics([{events:[...events,events[1]]}]);
 assert.equal(s.calls.execute,1);assert.equal(s.failed,1);assert.equal(s.interrupted,1);assert.equal(s.usageKnown,1);assert.equal(s.usageUnknown,2);assert.equal(s.input,22);assert.equal(s.output,5);assert.equal(s.cached,3);assert.equal(s.wallDuration,2000);assert.equal(s.modelDuration,2500);
});
