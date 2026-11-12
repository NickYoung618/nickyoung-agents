import test from "node:test";
import assert from "node:assert/strict";
import { statistics } from "../src/statistics.mjs";
test("统计按交付时的模型归属，缓存用量与返修可对账", () => {
  const c = {
    tasks: [{ id: "t", member: "m", status: "passed" }],
    events: [
      {
        id: 1,
        type: "model_result",
        data: {
          member: "m",
          model: "old",
          tier: "main",
          channel: "claude",
          duration: 100,
          usage: {
            input_tokens: 2,
            cache_creation_input_tokens: 3,
            cache_read_input_tokens: 5,
            output_tokens: 4,
          },
        },
      },
      { id: 2, type: "task_update", data: { id: "t", commit: "a" } },
      { id: 3, type: "task_update", data: { id: "t", failures: 1 } },
      {
        id: 4,
        type: "model_result",
        data: {
          member: "m",
          model: "new",
          tier: "main",
          channel: "codex",
          duration: 200,
          usage: { input_tokens: 20, output_tokens: 6 },
        },
      },
      { id: 5, type: "task_update", data: { id: "t", commit: "b" } },
    ],
  };
  const result = statistics([c]);
  assert.equal(result[0].input, 10);
  assert.equal(result[0].repairs, 1);
  assert.equal(result[0].firstPassed, 0);
  assert.equal(result[1].repairs, 0);
  assert.equal(result[1].firstPassed, 1);
  assert.equal(result[1].tasks, 1);
});
