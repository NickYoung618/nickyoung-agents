import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { Engine } from "../src/engine.mjs";
import { Store } from "../src/store.mjs";
import { cycleStatistics } from "../src/statistics.mjs";
import { executeCheck } from "../src/verification.mjs";
import { cases } from "./evaluation-suite.mjs";
export function evaluationOptions(args) {
  const value = (key) => args[args.indexOf(key) + 1];
  if (!args.includes("--live"))
    return {
      live: false,
      status: "not_run",
      reason:
        "真实模型评估未运行；需要 --live、--budget-turns、--budget-ms 和 --config。",
    };
  const turns = Number(value("--budget-turns")),
    ms = Number(value("--budget-ms"));
  if (
    !args.includes("--budget-turns") ||
    !Number.isSafeInteger(turns) ||
    turns <= 0 ||
    !args.includes("--budget-ms") ||
    !Number.isSafeInteger(ms) ||
    ms <= 0 ||
    !args.includes("--config")
  )
    throw Error("必须明确正整数调用预算、总毫秒预算和现有配置文件");
  return {
    live: true,
    turns,
    ms,
    config: resolve(value("--config")),
    output: args.includes("--output")
      ? resolve(value("--output"))
      : mkdtempSync(join(tmpdir(), "ny-evaluation-")),
    repeats: args.includes("--repeats") ? Number(value("--repeats")) : 1,
  };
}
export async function evaluate(options) {
  if (!options.live) return options;
  if (!Number.isSafeInteger(options.repeats) || options.repeats < 1)
    throw Error("repeats 必须为正整数");
  const suite = options.suite || cases;
  const EngineClass = options.EngineClass || Engine;
  const configured = JSON.parse(readFileSync(options.config, "utf8"));
  if (!configured.leader || !configured.tiers?.length)
    throw Error("现有模型档位不完整");
  mkdirSync(options.output, { recursive: true });
  const scratch = mkdtempSync(join(options.output, "artifacts-")),
    deadline = Date.now() + options.ms;
  let calls = 0;
  const report = {
    live: true,
    status: "running",
    budget: { turns: options.turns, ms: options.ms },
    started: new Date().toISOString(),
    results: [],
    limitations: [
      "订阅费用未知；token 不折算美元",
      "按任务类型逐项报告，不推断普适最优",
      "依次执行，记录轮换顺序；环境和缓存可能不同",
    ],
  };
  const persist = () =>
    writeFileSync(
      join(options.output, "evaluation.json"),
      JSON.stringify(report, null, 2),
    );
  const git = (path, args) =>
    execFileSync("git", ["-C", path, ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Evaluation",
        GIT_AUTHOR_EMAIL: "evaluation@localhost",
        GIT_COMMITTER_NAME: "Evaluation",
        GIT_COMMITTER_EMAIL: "evaluation@localhost",
      },
    }).trim();
  const wait = async (e, c) => {
    while (Date.now() < deadline) {
      const s = e.state(c);
      if (
        (["done", "error"].includes(s.status) ||
          s.cycle?.phase === "blocked") &&
        !e.busyProjects.size &&
        !e.waking.size
      )
        return;
      await new Promise((r) => setTimeout(r, 100));
    }
    e.pause(c);
    throw Error("总时间预算用尽");
  };
  for (let repeat = 0; repeat < options.repeats; repeat++)
    for (const [index, item] of suite.entries()) {
      if (calls >= options.turns || Date.now() >= deadline) break;
      const seed = join(scratch, `${repeat}-${item.id}-seed`);
      mkdirSync(seed);
      git(seed, ["init"]);
      for (const [file, content] of Object.entries(item.files)) {
        mkdirSync(dirname(join(seed, file)), { recursive: true });
        writeFileSync(join(seed, file), content);
      }
      mkdirSync(join(seed, "tests"));
      writeFileSync(
        join(seed, "tests/acceptance.mjs"),
        item.initialAcceptance || item.acceptance,
      );
      git(seed, ["add", "."]);
      git(seed, ["commit", "-m", "评估初始输入"]);
      const initialCommit = git(seed, ["rev-parse", "HEAD"]);
      const external = join(scratch, `${repeat}-${item.id}-acceptance.mjs`);
      writeFileSync(external, item.acceptance);
      const baseOrder = ["single", "legacy", "adaptive"];
      const offset = (repeat + index) % 3;
      const order = [...baseOrder.slice(offset), ...baseOrder.slice(0, offset)];
      for (const strategy of order) {
        if (calls >= options.turns || Date.now() >= deadline) break;
        const dir = join(scratch, `${repeat}-${item.id}-${strategy}`),
          source = join(dir, "source");
        mkdirSync(dir);
        execFileSync("git", ["clone", "--no-hardlinks", seed, source], {
          stdio: "ignore",
        });
        const data = join(dir, "data");
        mkdirSync(data);
        const db = new Store(join(data, "events.sqlite"));
        let e,
          c,
          pauseOnce = false;
        const started = Date.now();
        const row = {
          repeat,
          type: item.type,
          caseId: item.id,
          strategy,
          initialCommit,
          order,
          callsBefore: calls,
          started: new Date().toISOString(),
          modelPool: {
            leader: Object.fromEntries(
              ["channel", "model", "effort"].map((k) => [
                k,
                configured.leader[k],
              ]),
            ),
            tiers: configured.tiers.map((t) =>
              Object.fromEntries(
                ["id", "channel", "model", "effort"].map((k) => [k, t[k]]),
              ),
            ),
          },
          status: "running",
          externalAcceptance: { status: "not_run" },
          environment: { node: process.version, platform: process.platform },
          artifact: source,
        };
        report.results.push(row);
        persist();
        try {
          e = new EngineClass(
            db,
            {
              ...configured,
              data,
              workspace: dir,
              concurrency: 1,
              timeout: Math.min(
                configured.timeout || 3600000,
                Math.max(1, deadline - Date.now()),
              ),
            },
            () => {},
            (event) => {
              if (
                item.pause &&
                !pauseOnce &&
                event.type === "check" &&
                event.data.passed
              ) {
                pauseOnce = true;
                setTimeout(() => {
                  e.pause(c);
                  setTimeout(() => e.resume(c), 100);
                }, 0);
              }
            },
          );
          const model = e.model.bind(e);
          e.model = async (...args) => {
            if (calls >= options.turns || Date.now() >= deadline)
              throw Error("真实模型调用预算用尽");
            calls++;
            return model(...args);
          };
          c = await e.create(item.goal, source, {
            workflowVersion: strategy === "legacy" ? "legacy" : "adaptive_v1",
          });
          const appendInput = () => {
            writeFileSync(
              join(source, "tests/acceptance.mjs"),
              item.acceptance,
            );
            git(source, ["add", "tests/acceptance.mjs"]);
            git(source, [
              "commit",
              "--allow-empty",
              "-m",
              "记录追加需求的验收定义",
            ]);
            row.appendInputCommit = git(source, ["rev-parse", "HEAD"]);
          };
          const instructions = (goal) =>
            goal +
            "\n验收定义在 tests/acceptance.mjs；不得修改验收定义，仅在 src/ 实现需求。";
          if (strategy === "single") {
            const member = {
              id: "single",
              name: "单模型",
              role: "执行者",
              ...configured.leader,
            };
            e.event(c, "recruit", member);
            const submit = (goal) => {
              e.workflow.start(c, goal);
              e.workflow.submit(
                c,
                {
                  goal,
                  scope: ["src/"],
                  conventions: ["保持已有公共导出"],
                  contractPaths: [],
                  criteria: [{ id: "goal", text: goal }],
                  tasks: [
                    {
                      id: "implement",
                      title: goal,
                      description: goal,
                      executorId: "single",
                      dependsOn: [],
                      gateIds: [],
                      waitsForQuestions: [],
                      scope: ["src/"],
                    },
                  ],
                  gates: [
                    {
                      id: "formal",
                      kind: "check",
                      phase: "final",
                      scope: ["src/"],
                      afterTasks: [],
                      criteriaIds: ["goal"],
                      commands: ["node tests/acceptance.mjs"],
                      reviewerId: "",
                      assumption: "",
                      deterministic: true,
                      outputs: [],
                    },
                  ],
                  policy: "checks_only",
                  reason: "受约束的本地纯函数评估；外部独立验收",
                  facts: ["独立临时源码", "仅允许 src/ 范围", "无外部生产操作"],
                },
                { direct: true },
              );
              e.event(c, "status", { status: "working" });
              e.pump();
            };
            submit(instructions(item.goal));
            await wait(e, c);
            if (item.appendGoal && e.state(c).status === "done") {
              appendInput();
              submit(instructions(item.appendGoal));
              await wait(e, c);
            }
          } else {
            await e.message(c, instructions(item.goal));
            await wait(e, c);
            if (item.appendGoal && e.state(c).status === "done") {
              appendInput();
              await e.message(c, instructions(item.appendGoal));
              await wait(e, c);
            }
          }
          const s = e.state(c);
          row.status = s.status;
          row.phase = s.cycle?.phase;
          row.finalCommit = git(source, ["rev-parse", "HEAD"]);
          // The same fixed evaluator runs after all production work. Its cost is separate.
          if (Date.now() >= deadline)
            throw Error("总时间预算用尽，外部验收未运行");
          e.config.timeout = Math.max(1, deadline - Date.now());
          const evaluationStart = Date.now();
          const quote = (s) => "'" + s.replaceAll("'", "'\"'\"'") + "'";
          const command = `${quote(process.execPath)} ${quote(external)}`;
          const acceptance = await e.workflow.worktree(
            c,
            row.finalCommit,
            (path) =>
              executeCheck(
                e,
                c,
                path,
                { commands: [command] },
                { cycleId: s.cycleId, purpose: "evaluation" },
              ),
          );
          row.externalAcceptance = {
            status: acceptance.exitCode === 0 ? "passed" : "failed",
            exitCode: acceptance.exitCode,
            output: acceptance.output,
            duration: Date.now() - evaluationStart,
          };
          row.metrics = cycleStatistics([s]);
          if (strategy === "legacy") {
            const aggregate = "legacy:" + s.id;
            row.legacyConversationAggregate = true;
            row.metrics = cycleStatistics([
              {
                events: [
                  {
                    ...s.events[0],
                    type: "cycle",
                    data: { cycleId: aggregate },
                  },
                  ...s.events.map((e) => ({
                    ...e,
                    data: { ...e.data, cycleId: aggregate },
                  })),
                ],
              },
            ]);
          }
          row.repairs = s.cycle?.repairs;
          row.humanDecisions = s.events.filter(
            (x) => x.type === "answer",
          ).length;
        } catch (error) {
          row.status = "failed_or_budget_exhausted";
          row.error = error.message;
        } finally {
          if (e) {
            e.shutdown();
            while (e.running.size || e.busyProjects.size || e.waking.size)
              await new Promise((r) => setTimeout(r, 50));
            if (c) row.events = db.events(c);
          }
          row.calls = calls - row.callsBefore;
          row.duration = Date.now() - started;
          row.ended = new Date().toISOString();
          db.db.close();
          persist();
        }
      }
    }
  report.calls = calls;
  report.status =
    report.results.length === suite.length * 3 * options.repeats &&
    !report.results.some((r) => r.error?.includes("预算"))
      ? "complete"
      : "budget_exhausted";
  report.ended = new Date().toISOString();
  persist();
  return { status: report.status, calls, output: options.output };
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  try {
    console.log(
      JSON.stringify(
        await evaluate(evaluationOptions(process.argv.slice(2))),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
