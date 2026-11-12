import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  checkFingerprint,
  reusableEvidence,
  unexpectedChanges,
} from "../src/verification.mjs";
import { plan } from "./workflow-fixtures.mjs";
import { setup, drain } from "./workflow-harness.mjs";
test("正式证据只复用同源码、规格、目标、环境；不复用网络/时间/随机检查或自述", () => {
  const gate = plan().gates[0],
    args = {
      commit: "c",
      tree: "t",
      gate,
      planRevision: 1,
      criteria: ["c"],
      environment: { node: "24" },
    };
  const fp = checkFingerprint(args),
    e = {
      evidenceId: "e",
      fingerprint: fp,
      result: "passed",
      source: "executed",
    };
  assert.equal(reusableEvidence([e], fp, gate), e);
  for (const change of [
    { commit: "d" },
    { tree: "u" },
    { gate: { ...gate, commands: ["other"] } },
    { criteria: ["other"] },
    { environment: { node: "25" } },
    { planRevision: 2 },
  ])
    assert.equal(
      reusableEvidence([e], checkFingerprint({ ...args, ...change }), gate),
      undefined,
    );
  assert.equal(
    reusableEvidence([{ ...e, source: "self_report" }], fp, gate),
    undefined,
  );
  assert.equal(
    reusableEvidence([e], fp, { ...gate, deterministic: false }),
    false,
  );
});
test("验证副本识别未知跟踪与未跟踪文件；只允许声明的构建输出", () => {
  const f = setup();
  try {
    writeFileSync(join(f.path, "source.txt"), "original");
    f.e.git(f.path, ["add", "."]);
    f.e.git(f.path, ["commit", "-m", "source"]);
    mkdirSync(join(f.path, "dist"));
    writeFileSync(join(f.path, "dist", "bundle"), "build");
    assert.deepEqual(
      unexpectedChanges(f.e.git.bind(f.e), f.path, ["dist/"]),
      [],
    );
    writeFileSync(join(f.path, "unknown"), "unknown");
    assert.deepEqual(unexpectedChanges(f.e.git.bind(f.e), f.path, ["dist/"]), [
      "unknown",
    ]);
    writeFileSync(join(f.path, "source.txt"), "changed");
    assert.ok(
      unexpectedChanges(f.e.git.bind(f.e), f.path, [
        "dist/",
        "source.txt",
      ]).includes("source.txt"),
    );
  } finally {
    f.clean();
  }
});
test("阻塞缺陷直达原执行者；局部检查闭合不重复全量审查", async () => {
  const f = setup();
  try {
    const original = f.e.model;
    let reviews = 0;
    f.e.model = async (c, m, p, o) => {
      if (o.role === "reviewer" && !reviews++) {
        const x = JSON.parse(p);
        return {
          message: "缺陷",
          reviewedCommit: x.reviewedCommit,
          criteriaIds: ["c"],
          blockingIssues: [
            {
              issueId: "bug",
              taskId: f.e.state(c).cycle.tasks[0].id,
              criterionId: "c",
              location: "src/t0.txt:1",
              evidence: "fixture 指定错误",
              expected: "实现0",
              checkIds: ["check"],
              semantic: false,
            },
          ],
          advisories: [],
          needsVerification: [],
        };
      }
      return original(c, m, p, o);
    };
    f.e.workflow.start("a", "局部修复");
    f.e.workflow.submit("a", plan(1));
    await drain(f.e);
    assert.equal(f.e.state("a").status, "done");
    assert.equal(f.calls.filter((c) => c.role === "reviewer").length, 0);
    assert.equal(reviews, 1);
    assert.equal(f.calls.filter((c) => c.purpose === "repair").length, 1);
    const x = f.e.state("a").cycle;
    assert.ok(x.issues.every((i) => i.closed));
    assert.notEqual(x.reviewedCommit, x.finalCommit);
    assert.equal(
      x.gates.find((g) => g.kind === "model").coverage,
      "reviewed_plus_checked_patch",
    );
  } finally {
    f.clean();
  }
});
test("语义修复只做一次范围复查；高影响疑点有有限验证路径", async () => {
  const f = setup();
  try {
    const original = f.e.model;
    let reviews = 0;
    f.e.model = async (c, m, p, o) => {
      if (o.role === "reviewer") {
        reviews++;
        const x = JSON.parse(p);
        return {
          message: "审查",
          reviewedCommit: x.reviewedCommit,
          criteriaIds: ["c"],
          blockingIssues:
            reviews === 1
              ? [
                  {
                    issueId: "semantic",
                    taskId: f.e.state(c).cycle.tasks[0].id,
                    criterionId: "c",
                    location: "src/t0.txt:1",
                    evidence: "需要语义确认",
                    expected: "语义不变量成立",
                    checkIds: ["check"],
                    semantic: true,
                  },
                ]
              : [],
          advisories: [],
          needsVerification: [],
        };
      }
      return original(c, m, p, o);
    };
    f.e.workflow.start("a", "语义修复");
    f.e.workflow.submit("a", plan(1));
    await drain(f.e);
    assert.equal(f.e.state("a").status, "done");
    assert.equal(reviews, 2);
    assert.equal(f.e.state("a").cycle.rechecks, 1);
    assert.ok(
      f.e
        .state("a")
        .cycle.gates.some(
          (g) => g.phase === "recheck" && g.status === "passed",
        ),
    );
  } finally {
    f.clean();
  }
});
test("修复触及公共约定路径触发有证据升级，预算不允许循环重建任务", async () => {
  const f = setup();
  try {
    const original = f.e.model;
    f.e.model = async (c, m, p, o) => {
      if (o.role === "reviewer") {
        const x = JSON.parse(p);
        return {
          message: "缺陷",
          reviewedCommit: x.reviewedCommit,
          criteriaIds: ["c"],
          blockingIssues: [
            {
              issueId: "bug",
              taskId: f.e.state(c).cycle.tasks[0].id,
              criterionId: "c",
              location: "src/t0.txt:1",
              evidence: "接口问题",
              expected: "接口成立",
              checkIds: ["check"],
              semantic: false,
            },
          ],
          advisories: [],
          needsVerification: [],
        };
      }
      const r = await original(c, m, p, o);
      if (o.purpose === "repair") {
        mkdirSync(join(f.path, "src/api"), { recursive: true });
        writeFileSync(join(f.path, "src/api/contract"), "changed");
      }
      return r;
    };
    const reasons = [];
    f.e.wake = async (c, o) => reasons.push(o.reason);
    f.e.workflow.start("a", "约定");
    f.e.workflow.submit("a", plan(1));
    await drain(f.e);
    assert.equal(f.e.state("a").cycle.phase, "blocked");
    assert.deepEqual(reasons, ["contract_invalid"]);
    assert.ok(
      f.e
        .state("a")
        .events.some(
          (e) => e.type === "planner_trigger" && e.data.evidenceIds.length,
        ),
    );
  } finally {
    f.clean();
  }
});
test("源码污染使正式证据失败，原目录保持实现成果；正常输出允许", async () => {
  for (const mutate of [false, true]) {
    const f = setup();
    try {
      const p = plan(1, "checks_only");
      p.gates[0].commands.push(
        mutate
          ? `printf polluted > src/t0.txt`
          : `mkdir -p dist && printf bundle > dist/build`,
      );
      p.gates[0].outputs = ["dist/"];
      f.e.workflow.start("a", "输出");
      f.e.workflow.submit("a", p);
      f.e.workflow.update("a", {
        budgets: { ...f.e.state("a").cycle.budgets, cycleRepairs: 0 },
      });
      await drain(f.e);
      assert.equal(
        f.e.state("a").cycle.evidence[0].result,
        mutate ? "failed" : "passed",
      );
      assert.equal(f.e.git(f.path, ["show", "HEAD:src/t0.txt"]), "实现0");
      if (!mutate) assert.equal(f.e.state("a").status, "done");
    } finally {
      f.clean();
    }
  }
});

test("实际缺陷补丁与新增回归：原审查提交和最终补丁提交分开，正式检查覆盖新增断言", async () => {
  const f = setup();
  try {
    const base = f.e.model;
    let reviews = 0;
    f.e.model = async (c, m, p, o) => {
      if (o.role === "reviewer") {
        reviews++;
        const x = JSON.parse(p);
        return {
          message: "下界缺陷",
          reviewedCommit: x.reviewedCommit,
          criteriaIds: ["c"],
          blockingIssues: [
            {
              issueId: "lower-bound",
              taskId: f.e.state(c).cycle.tasks[0].id,
              criterionId: "c",
              location: "src/clamp.mjs:1",
              evidence: "clamp(-1,0,10) 得到 -1，违反下界",
              expected: "返回 0 并增加下界回归断言",
              checkIds: ["check"],
              semantic: false,
            },
          ],
          advisories: [],
          needsVerification: [],
        };
      }
      const result = await base(c, m, p, o);
      const repair = o.purpose === "repair";
      writeFileSync(
        join(f.path, "src/clamp.mjs"),
        repair
          ? "export const clamp=(n,min,max)=>Math.max(min,Math.min(n,max));\n"
          : "export const clamp=(n,min,max)=>Math.min(n,max);\n",
      );
      writeFileSync(
        join(f.path, "src/behavior.test.mjs"),
        "import test from 'node:test';import assert from 'node:assert/strict';import {clamp} from './clamp.mjs';test('within range',()=>assert.equal(clamp(5,0,10),5));\n" +
          (repair
            ? "test('lower bound',()=>assert.equal(clamp(-1,0,10),0));\n"
            : ""),
      );
      return result;
    };
    const p = plan(1);
    p.gates[0].commands = ["node --test src/behavior.test.mjs"];
    f.e.workflow.start("a", "下界修复");
    f.e.workflow.submit("a", p);
    await drain(f.e);
    const x = f.e.state("a").cycle;
    assert.equal(f.e.state("a").status, "done");
    assert.equal(reviews, 1);
    assert.notEqual(x.reviewedCommit, x.finalCommit);
    assert.match(
      f.e.git(f.path, ["diff", x.reviewedCommit, x.finalCommit]),
      /lower bound/,
    );
    assert.match(x.evidence.at(-1).output, /pass 2/);
    assert.ok(x.issues.every((i) => i.closed));
  } finally {
    f.clean();
  }
});
