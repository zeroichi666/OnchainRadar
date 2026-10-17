import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { delimiter, resolve } from "node:path";
import { tmpdir } from "node:os";
import { resolveTwitterCli } from "./agent-reach-adapter.mjs";

const tempDirs = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function runPython(args, env) {
  return new Promise((resolvePromise) => {
    const child = spawn("python3", args, { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

describe("twitter-cli local compatibility shim", () => {
  it("finds a uv-managed executable under HOME when it is absent from PATH", async () => {
    const home = await mkdtemp(resolve(tmpdir(), "radar-twitter-path-"));
    tempDirs.push(home);
    const binDir = resolve(home, ".local", "bin");
    await mkdir(binDir, { recursive: true });
    const executable = resolve(binDir, "twitter");
    await writeFile(executable, "#!/bin/sh\nexit 0\n");
    await chmod(executable, 0o700);

    assert.equal(resolveTwitterCli({ HOME: home, PATH: "/usr/bin" }), executable);
    assert.equal(resolveTwitterCli({ HOME: home, TWITTER_CLI_BIN: "/explicit/twitter" }), "/explicit/twitter");
  });

  it("rewrites only the x.com bootstrap request and strips credentials from CDN requests", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "radar-twitter-compat-"));
    tempDirs.push(dir);
    const fakeRoot = resolve(dir, "fake-modules");
    const fakePackage = resolve(fakeRoot, "twitter_cli");
    await mkdir(fakePackage, { recursive: true });
    const distInfo = resolve(fakeRoot, "twitter_cli-0.8.5.dist-info");
    await mkdir(distInfo, { recursive: true });
    await writeFile(resolve(distInfo, "METADATA"), "Metadata-Version: 2.1\nName: twitter-cli\nVersion: 0.8.5\n");
    await writeFile(resolve(fakePackage, "__init__.py"), "\n");
    await writeFile(resolve(fakePackage, "client.py"), `calls = []
class FakeSession:
    def get(self, url, *args, **kwargs):
        calls.append({"url": url, "headers": kwargs.get("headers", {}), "allow_redirects": kwargs.get("allow_redirects")})
        return None
_session = FakeSession()
def _get_cffi_session():
    return _session
`);
    const shimPath = resolve(process.cwd(), "worker/twitter-cli-compat");
    const env = {
      PATH: process.env.PATH,
      HOME: dir,
      PYTHONPATH: [shimPath, fakeRoot].join(delimiter),
      PYTHONDONTWRITEBYTECODE: "1",
      TWITTER_AUTH_TOKEN: "auth-test-value",
      TWITTER_CT0: "csrf-test-value",
    };
    const code = `import json
from twitter_cli.client import _get_cffi_session, calls
session = _get_cffi_session()
session.get("https://x.com", headers={"Authorization": "bearer-test", "User-Agent": "test-agent"})
session.get("https://abs.twimg.com/responsive-web/client-web/test.js", headers={"Cookie": "must-not-forward", "X-Csrf-Token": "must-not-forward", "Authorization": "must-not-forward", "User-Agent": "test-agent"})
print(json.dumps(calls))`;
    const result = await runPython(["-c", code], env);
    assert.equal(result.code, 0, result.stderr);
    const calls = JSON.parse(result.stdout.trim());
    assert.equal(calls[0].url, "https://x.com/home");
    assert.equal(calls[0].allow_redirects, false);
    assert.equal(calls[0].headers.Cookie, "auth_token=auth-test-value; ct0=csrf-test-value");
    assert.equal(calls[0].headers["X-Csrf-Token"], "csrf-test-value");
    assert.equal(calls[1].url, "https://abs.twimg.com/responsive-web/client-web/test.js");
    assert.deepEqual(calls[1].headers, { "User-Agent": "test-agent" });
    assert.equal(JSON.stringify(calls[1].headers).includes("must-not-forward"), false);

    await writeFile(resolve(distInfo, "METADATA"), "Metadata-Version: 2.1\nName: twitter-cli\nVersion: 0.8.6\n");
    const laterCode = `import json
from twitter_cli.client import _get_cffi_session, calls
_get_cffi_session().get("https://x.com", headers={"User-Agent": "test-agent"})
print(json.dumps(calls))`;
    const later = await runPython(["-c", laterCode], env);
    assert.equal(later.code, 0, later.stderr);
    const laterCalls = JSON.parse(later.stdout.trim());
    assert.equal(laterCalls[0].url, "https://x.com");
    assert.equal(laterCalls[0].headers.Cookie, undefined);
  });
});
