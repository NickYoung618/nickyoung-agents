import test from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
test("HTTPS 登录隔离、限速、来源校验及改密注销", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nickyoung-auth-")),
    port = 18787;
  const child = spawn(process.execPath, ["src/server.mjs"], {
    env: {
      ...process.env,
      NY_DATA: dir,
      NY_PORT: String(port),
      NY_HOST: "127.0.0.1",
    },
    stdio: "ignore",
  });
  const call = (path, data, cookie, origin) =>
    new Promise((resolve, reject) => {
      const r = https.request(
        `https://127.0.0.1:${port}${path}`,
        {
          rejectUnauthorized: false,
          method: data ? "POST" : "GET",
          headers: {
            "Content-Type": "application/json",
            ...(cookie ? { Cookie: cookie } : {}),
            ...(origin ? { Origin: origin } : {}),
          },
        },
        (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              body,
              cookie: res.headers["set-cookie"]?.[0],
            }),
          );
        },
      );
      r.on("error", reject);
      r.end(data ? JSON.stringify(data) : undefined);
    });
  try {
    let ready = false;
    for (let n = 0; n < 50; n++) {
      try {
        await call("/login");
        ready = true;
        break;
      } catch {
        await delay(100);
      }
    }
    assert.ok(ready, "服务启动");
    assert.equal((await call("/api/state")).status, 401);
    assert.equal((await call("/app.js")).status, 401);
    const password = readFileSync(join(dir, "initial-password"), "utf8").trim();
    const login = await call("/api/login", { password });
    assert.equal(login.status, 200);
    assert.match(login.cookie, /HttpOnly/);
    assert.match(login.cookie, /Secure/);
    assert.match(login.cookie, /SameSite=Strict/);
    const cookie = login.cookie.split(";")[0];
    assert.equal((await call("/api/state", undefined, cookie)).status, 200);
    assert.equal(
      (
        await call(
          "/api/password",
          { password: "new-password-long-enough" },
          cookie,
          "https://evil.example",
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call(
          "/api/password",
          { password: "new-password-long-enough" },
          cookie,
        )
      ).status,
      200,
    );
    assert.equal((await call("/api/state", undefined, cookie)).status, 401);
    for (let n = 0; n < 5; n++)
      assert.equal(
        (await call("/api/login", { password: "wrong" })).status,
        401,
      );
    assert.equal(
      (await call("/api/login", { password: "new-password-long-enough" }))
        .status,
      429,
    );
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => child.once("close", r));
    rmSync(dir, { recursive: true, force: true });
  }
});
