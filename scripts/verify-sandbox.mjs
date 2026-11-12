import { Engine } from "../src/engine.mjs";
import { Store } from "../src/store.mjs";
import {
  readFileSync,
  mkdtempSync,
  existsSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { resolve, join } from "node:path";
const root = resolve(import.meta.dirname, ".."),
  config = JSON.parse(readFileSync(join(root, "data/config.json"))),
  cwd = mkdtempSync(join(config.workspace, "sandbox-check-")),
  outside = join(config.workspace, "outside-probe-" + Date.now());
const engine = new Engine(
  new Store(":memory:"),
  config,
  () => {},
  () => {},
);
engine.teamTokens.set("probe", {
  conversation: "qa",
  member: "worker",
  cwd,
  readOnly: false,
  leader: false,
});
const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
try {
  const inside = await engine.teamAction("probe", {
    type: "project_command",
    command:
      "node -e " +
      quote(
        'require("node:fs").writeFileSync("probe.txt","ok");console.log("inside-ok")',
      ),
  });
  const denied = await engine.teamAction("probe", {
    type: "project_command",
    command:
      "node -e " +
      quote(
        `require("node:fs").writeFileSync(${JSON.stringify(outside)},"probe")`,
      ),
  });
  const exit = await engine.teamAction("probe", {
    type: "project_command",
    command: "node -e " + quote("process.exit(7)"),
  });
  const result = {
    passed:
      inside.exitCode === 0 &&
      existsSync(join(cwd, "probe.txt")) &&
      denied.exitCode !== 0 &&
      !existsSync(outside) &&
      exit.exitCode === 7,
    inside,
    denied,
    outsideExists: existsSync(outside),
    exit,
  };
  writeFileSync(
    join(root, "evidence/workspace-sandbox.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: result.passed,
      inside: inside.exitCode,
      outside: denied.exitCode,
      exit: exit.exitCode,
    }),
  );
  if (!result.passed) process.exitCode = 1;
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
