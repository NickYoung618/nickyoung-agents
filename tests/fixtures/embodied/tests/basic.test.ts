import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phases, pageTitle } from '../src/content.ts';

test('中文标题与闭环阶段保持完整且顺序正确', () => {
  assert.equal(pageTitle, '具身智能');
  assert.deepEqual(phases.map((phase) => phase.name), ['感知', '规划', '行动', '反馈']);
  assert.equal(new Set(phases.map((phase) => phase.id)).size, 4);
  for (const phase of phases) {
    assert.match(phase.id, /^[a-z]+$/);
    assert.ok(phase.description.length >= 12, `${phase.name} 需要提供科普说明`);
  }
});
