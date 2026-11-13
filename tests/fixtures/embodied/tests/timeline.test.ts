import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sample, CYCLE_MS, SOURCE, TARGET, SHOULDER, ARM_LENGTHS } from '../src/timeline.ts';

test('四阶段边界与两轮循环重置', () => {
  for (const offset of [0, CYCLE_MS, CYCLE_MS * 2]) {
    for (const [time, phase] of [[0, 0], [5999, 0], [6000, 1], [9999, 1], [10000, 2], [24999, 2], [25000, 3], [29999, 3]]) {
      assert.equal(sample(offset + Number(time)).phase, phase);
    }
    assert.deepEqual(sample(offset), sample(0));
  }
  assert.equal(CYCLE_MS, 30000);
});

test('夹取、运输、释放后物体坐标符合实际抓持关系', () => {
  assert.deepEqual(sample(12000).object, SOURCE);
  assert.equal(sample(13999).holding, false);
  for (const time of [14000, 16000, 18000, 21000, 22999]) {
    const pose = sample(time);
    assert.equal(pose.holding, true);
    assert.equal(pose.object.x, pose.wrist.x);
    assert.equal(pose.object.y, pose.wrist.y + 28);
    assert.equal(pose.gap, 25);
  }
  assert.ok(sample(18000).object.y < SOURCE.y - 50);
  assert.ok(sample(20000).object.x > SOURCE.x + 50);
  for (const time of [23000, 24000, 26000, 29999]) {
    assert.deepEqual(sample(time).object, TARGET);
    assert.equal(sample(time).holding, false);
  }
  assert.equal(sample(26000).success, true);
  assert.equal(sample(0).success, false);
});

test('所有姿态连续且机械臂长度固定，不出现不可达点或数值异常', () => {
  let previous = sample(0);
  for (let t = 10; t < CYCLE_MS; t += 10) {
    const pose = sample(t);
    assert.ok(Math.hypot(pose.wrist.x - previous.wrist.x, pose.wrist.y - previous.wrist.y) < 2);
    assert.ok(Math.abs(pose.gap - previous.gap) < 1);
    assert.ok(Math.abs(Math.hypot(pose.elbow.x - SHOULDER.x, pose.elbow.y - SHOULDER.y) - ARM_LENGTHS[0]) < 1e-8);
    assert.ok(Math.abs(Math.hypot(pose.elbow.x - pose.wrist.x, pose.elbow.y - pose.wrist.y) - ARM_LENGTHS[1]) < 1e-8);
    previous = pose;
  }
  assert.deepEqual(sample(CYCLE_MS).object, SOURCE);
});
