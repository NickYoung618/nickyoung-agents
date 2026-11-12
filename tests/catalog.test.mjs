import test from "node:test";
import assert from "node:assert/strict";
import { codexModels, claudeModels } from "../src/model-catalog.mjs";
test("原样保留所有原生强度与隐藏标记，不按固定名单截断", () => {
  const [m] = codexModels([
    {
      model: "future-model",
      displayName: "Future",
      hidden: true,
      defaultReasoningEffort: "ultra",
      supportedReasoningEfforts: [
        { reasoningEffort: "medium" },
        { reasoningEffort: "ultra" },
        { reasoningEffort: "future-effort" },
      ],
    },
  ]);
  assert.deepEqual(m.efforts, ["medium", "ultra", "future-effort"]);
  assert.equal(m.hidden, true);
  assert.equal(m.defaultEffort, "ultra");
});
test("Claude 按各模型实际能力列出强度，缺少元数据不猜测", () => {
  const models = claudeModels([
    {
      value: "sonnet",
      resolvedModel: "claude-sonnet-v",
      supportedEffortLevels: ["low", "medium", "high", "max"],
    },
    { value: "haiku-old", supportsEffort: false },
  ]);
  assert.deepEqual(models.find((m) => m.model === "sonnet").efforts, [
    "low",
    "medium",
    "high",
    "max",
  ]);
  assert.deepEqual(models.find((m) => m.model === "claude-sonnet-v").efforts, [
    "low",
    "medium",
    "high",
    "max",
  ]);
  assert.deepEqual(models.find((m) => m.model === "haiku-old").efforts, []);
  assert.equal(
    models.find((m) => m.model === "haiku-old").effortCapability,
    "none",
  );
});
test("同一 Claude 完整模型被多个别名引用时只列一次", () => {
  const models = claudeModels([
    { value: "default", resolvedModel: "claude-sonnet-v" },
    { value: "sonnet", resolvedModel: "claude-sonnet-v" },
  ]);
  assert.equal(models.filter((m) => m.model === "claude-sonnet-v").length, 1);
});
