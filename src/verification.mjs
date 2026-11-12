import { createHash } from "node:crypto";
import { runProcess } from "./runner.mjs";
export const fingerprint = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function checkFingerprint({
  commit,
  tree,
  gate,
  planRevision,
  criteria,
  environment,
}) {
  return fingerprint({
    commit,
    tree,
    checkSpec: {
      scope: gate.scope,
      kind: gate.kind,
      phase: gate.phase,
      assumption: gate.assumption,
      commands: gate.commands,
      outputs: gate.outputs,
      criteriaIds: gate.criteriaIds,
      deterministic: gate.deterministic,
    },
    planRevision,
    criteria,
    environment,
  });
}
export function reusableEvidence(evidence, fingerprintValue, gate) {
  return (
    gate.deterministic === true &&
    evidence.findLast(
      (e) =>
        e.fingerprint === fingerprintValue &&
        e.result === "passed" &&
        e.source === "executed",
    )
  );
}
export function inScope(file, scope) {
  return scope.some(
    (p) =>
      p === "." ||
      file === p.replace(/\/$/, "") ||
      file.startsWith(p.endsWith("/") ? p : p + "/"),
  );
}
export function unexpectedChanges(git, cwd, outputs = []) {
  const tracked = git(cwd, ["diff", "--name-only", "HEAD"])
    .split("\n")
    .filter(Boolean);
  const untracked = git(cwd, ["ls-files", "--others", "--exclude-standard"])
    .split("\n")
    .filter(Boolean);
  const ignored = git(cwd, [
    "ls-files",
    "--others",
    "--ignored",
    "--exclude-standard",
    "--directory",
  ])
    .split("\n")
    .filter(Boolean);
  return [...new Set([...tracked, ...untracked, ...ignored])].filter(
    (file) => tracked.includes(file) || !inScope(file, outputs),
  );
}
export function verificationEnvironment(config = {}) {
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    runtime: config.verificationEnvironment || "local",
    environment: fingerprint(
      Object.fromEntries(
        ["NODE_ENV", "TZ", "LANG", "PATH"].map((k) => [
          k,
          process.env[k] || "",
        ]),
      ),
    ),
  };
}
export async function executeCheck(engine, c, cwd, gate, trace) {
  const output = [];
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  let exitCode = 0,
    interrupted = false;
  for (const [index, command] of gate.commands.entries()) {
    const commandId = fingerprint([trace.scheduleId, gate.id, index]);
    engine.event(c, "command_start", {
      ...trace,
      commandId,
      index,
      command,
      started: new Date().toISOString(),
    });
    const proc = runProcess(
      process.env.NY_SANDBOX || "codex",
      [
        "sandbox",
        "-c",
        'sandbox_mode="workspace-write"',
        "-c",
        "sandbox_workspace_write.network_access=true",
        "--",
        "bash",
        "-lc",
        command,
      ],
      {
        cwd,
        env: environment,
        timeout: engine.config.timeout,
        onEvent: (event) => {
          output.push(event.text || JSON.stringify(event));
          engine.event(c, "process", {
            member: "machine",
            ...trace,
            commandId,
            event,
          });
        },
      },
    );
    engine.running.set(c + ":machine", proc);
    try {
      await proc.promise;
    } catch (e) {
      exitCode = e.exitCode ?? 1;
      interrupted = !!e.signal && !e.timedOut;
      output.push(e.message);
    } finally {
      engine.running.delete(c + ":machine");
      engine.event(c, "command_result", {
        ...trace,
        commandId,
        index,
        exitCode,
        interrupted,
        ended: new Date().toISOString(),
      });
    }
    if (exitCode) break;
  }
  return { exitCode, interrupted, output: output.join("\n") };
}
