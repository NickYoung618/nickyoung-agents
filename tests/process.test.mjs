import test from "node:test";
import assert from "node:assert/strict";
import { runProcess } from "../src/runner.mjs";
test("停止回合确实终止子进程", async () => {
  const proc = runProcess(
    process.execPath,
    ["-e", "setInterval(()=>{},1000)"],
    { timeout: 5000 },
  );
  const promise = assert.rejects(proc.promise, /SIGTERM|SIGKILL/);
  proc.stop();
  await promise;
  assert.throws(() => process.kill(proc.child.pid, 0), { code: "ESRCH" });
});
test("进程非零退出码和标准输出保留", async () => {
  const proc = runProcess(process.execPath, [
    "-e",
    'console.log("evidence");process.exit(7)',
  ]);
  await assert.rejects(
    proc.promise,
    (e) => e.exitCode === 7 && e.events.some((x) => x.text === "evidence"),
  );
});
