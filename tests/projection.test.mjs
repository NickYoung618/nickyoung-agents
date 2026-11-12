import test from "node:test";
import assert from "node:assert/strict";
import { speaker } from "../public/event-projection.mjs";
test("换模后历史发言仍标注当时的实际模型", () => {
  const state = {
    members: [{ id: "leader", model: "gpt-6.1-sol", effort: "high" }],
    events: [
      {
        id: 1,
        type: "run_start",
        data: { member: "leader", model: "sonnet", effort: "low" },
      },
      {
        id: 2,
        type: "model_result",
        data: { member: "leader", model: "claude-sonnet-5-5" },
      },
      { id: 3, type: "message", data: { member: "leader", text: "历史发言" } },
      {
        id: 4,
        type: "member",
        data: { id: "leader", model: "gpt-6.1-sol", effort: "high" },
      },
    ],
  };
  assert.equal(speaker(state, state.events[2]).model, "claude-sonnet-5-5");
  assert.equal(speaker(state, state.events[2]).effort, "low");
});
