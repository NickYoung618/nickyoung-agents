export const members = [
  { id: "m", name: "实现" },
  { id: "r", name: "审查" },
];
export function plan(n = 3, policy = "final_review") {
  return {
    goal: "连续实现",
    scope: ["src/"],
    conventions: ["接口不变"],
    deliveryTarget: "downloadable_source",
    contractPaths: ["src/api/"],
    criteria: [{ id: "c", text: "运行正确" }],
    tasks: Array.from({ length: n }, (_, i) => ({
      id: "t" + i,
      title: "实现" + i,
      description: "实现独立步骤",
      executorId: "m",
      dependsOn: i ? ["t" + (i - 1)] : [],
      gateIds: [],
      waitsForQuestions: [],
      scope: ["src/"],
    })),
    gates: [
      {
        id: "check",
        kind: "check",
        phase: "final",
        scope: ["src/"],
        afterTasks: [],
        criteriaIds: ["c"],
        commands: [
          `node -e "const fs=require('node:fs'),assert=require('node:assert/strict');for(let i=0;i<${n};i++)assert.equal(fs.readFileSync('src/t'+i+'.txt','utf8'),'实现'+i)"`,
        ],
        reviewerId: "",
        assumption: "",
        deterministic: true,
        outputs: [],
      },
      ...(policy === "checks_only"
        ? []
        : [
            {
              id: "review",
              kind: "model",
              phase: "final",
              scope: ["src/"],
              afterTasks: [],
              criteriaIds: ["c"],
              commands: [],
              reviewerId: "r",
              assumption: "",
              deterministic: true,
              outputs: [],
            },
          ]),
    ],
    policy,
    reason: "明确范围和客观测试；可逆本地修改",
    facts: ["没有外部操作", "已有覆盖测试"],
  };
}
