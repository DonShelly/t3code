// @effect-diagnostics nodeBuiltinImport:off - runs the generated launch script in a real shell against fake T3 processes.
import { assert, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { buildRemoteLaunchScript } from "./tunnel.ts";

// Stands in for the desktop-managed `t3 serve`: records the launch, then answers.
const fakeServe = (callsFile: string) => `const fs = require("node:fs");
const http = require("node:http");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(callsFile)}, args.join(" ") + "\\n");
const port = Number(args[args.indexOf("--port") + 1]);
http.createServer((_, response) => response.end()).listen(port, "127.0.0.1");
setTimeout(() => process.exit(0), 30_000);
`;

// Stands in for the boot service's launcher, which brings its server up late,
// as it does after a self-update hands off.
const fakeServiceLauncher = (
  runtimeFile: string,
  delayMs: number,
) => `const fs = require("node:fs");
const http = require("node:http");
setTimeout(() => {
  const server = http.createServer((_, response) => response.end());
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    fs.writeFileSync(${JSON.stringify(runtimeFile)}, JSON.stringify({
      version: 1,
      pid: process.pid,
      host: "127.0.0.1",
      port,
      origin: "http://127.0.0.1:" + port,
      startedAt: new Date().toISOString(),
      serviceManaged: true,
    }));
  });
}, ${delayMs});
setTimeout(() => process.exit(0), 30_000);
`;

interface LaunchResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

const runLaunchScript = (home: string, script: string) =>
  new Promise<LaunchResult>((resolve, reject) => {
    const child = NodeChildProcess.spawn("sh", ["-s", "--", "test-state"], {
      env: { HOME: home, PATH: process.env.PATH ?? "" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
    child.stdin.end(script);
  });

const lastJsonLine = (stdout: string) =>
  JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}") as {
    readonly remotePort?: number;
    readonly serverKind?: string;
  };

const withHome = <A>(run: (root: string, home: string) => Promise<A>) =>
  Effect.promise(async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-ssh-launch-"));
    const home = NodePath.join(root, "home");
    await NodeFSP.mkdir(NodePath.join(home, ".t3", "userdata"), { recursive: true });
    try {
      return await run(root, home);
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });

// The real launcher runs as `<home>/runtime/versions/<version>/t3 __service-launcher`.
const startServiceLauncher = async (root: string, home: string, serverDelayMs: number) => {
  const launcherDir = NodePath.join(root, "launcher");
  await NodeFSP.mkdir(launcherDir);
  await NodeFSP.writeFile(
    NodePath.join(launcherDir, "__service-launcher"),
    fakeServiceLauncher(NodePath.join(home, ".t3/userdata/server-runtime.json"), serverDelayMs),
  );
  return NodeChildProcess.spawn(process.execPath, ["__service-launcher"], {
    argv0: NodePath.join(home, ".t3/runtime/versions/9.9.9/t3"),
    cwd: launcherDir,
    stdio: "ignore",
  });
};

// The PID the launch script recorded when it spawned the fake server.
const stopManagedServer = async (home: string) => {
  const recorded = await NodeFSP.readFile(
    NodePath.join(home, ".t3/ssh-launch/test-state/pid"),
    "utf8",
  ).catch(() => "");
  const pid = Number(recorded.trim());
  if (Number.isInteger(pid) && pid > 0) {
    try {
      process.kill(pid);
    } catch {}
  }
};

it.effect("waits for a restarting background service instead of starting a second server", () =>
  Effect.gen(function* () {
    if ((yield* HostProcess.Platform) === "win32") return;
    yield* withHome(async (root, home) => {
      const callsFile = NodePath.join(root, "serve-calls");
      await NodeFSP.writeFile(NodePath.join(root, "fake-t3.cjs"), fakeServe(callsFile));
      const launcher = await startServiceLauncher(root, home, 2_500);
      try {
        const result = await runLaunchScript(
          home,
          buildRemoteLaunchScript({ nodeScriptPath: NodePath.join(root, "fake-t3.cjs") }),
        );
        assert.equal(result.exitCode, 0, result.stderr);
        const runtime = JSON.parse(
          await NodeFSP.readFile(NodePath.join(home, ".t3/userdata/server-runtime.json"), "utf8"),
        ) as { readonly port: number };
        assert.deepEqual(lastJsonLine(result.stdout), {
          remotePort: runtime.port,
          serverKind: "external",
        });
        assert.isFalse(
          await NodeFSP.access(callsFile).then(
            () => true,
            () => false,
          ),
          "the launch script started its own server",
        );
      } finally {
        launcher.kill();
      }
    });
  }),
);

it.effect("still starts its own server when no background service owns the home", () =>
  Effect.gen(function* () {
    if ((yield* HostProcess.Platform) === "win32") return;
    yield* withHome(async (root, home) => {
      const callsFile = NodePath.join(root, "serve-calls");
      await NodeFSP.writeFile(NodePath.join(root, "fake-t3.cjs"), fakeServe(callsFile));
      const result = await runLaunchScript(
        home,
        buildRemoteLaunchScript({ nodeScriptPath: NodePath.join(root, "fake-t3.cjs") }),
      );
      try {
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(lastJsonLine(result.stdout).serverKind, "managed");
        assert.lengthOf((await NodeFSP.readFile(callsFile, "utf8")).trim().split("\n"), 1);
      } finally {
        await stopManagedServer(home);
      }
    });
  }),
);

it.effect("still replaces its own server while a refused service launcher idles", () =>
  Effect.gen(function* () {
    if ((yield* HostProcess.Platform) === "win32") return;
    yield* withHome(async (root, home) => {
      const callsFile = NodePath.join(root, "serve-calls");
      await NodeFSP.writeFile(NodePath.join(root, "fake-t3.cjs"), fakeServe(callsFile));
      // A server from an older runner owns the home, so the launcher beside it
      // was refused and will not bring a server back.
      const previous = NodeChildProcess.spawn(
        process.execPath,
        ["-e", "setInterval(() => {}, 1_000)"],
        {
          stdio: "ignore",
        },
      );
      const stateDir = NodePath.join(home, ".t3/ssh-launch/test-state");
      await NodeFSP.mkdir(stateDir, { recursive: true });
      await NodeFSP.writeFile(NodePath.join(stateDir, "pid"), `${String(previous.pid)}\n`);
      await NodeFSP.writeFile(NodePath.join(stateDir, "port"), "3773\n");
      await NodeFSP.writeFile(NodePath.join(stateDir, "managed"), "managed\n");
      await NodeFSP.writeFile(NodePath.join(stateDir, "run-t3.sh"), "# an older runner\n");
      const launcher = await startServiceLauncher(root, home, 60_000);
      try {
        const result = await runLaunchScript(
          home,
          buildRemoteLaunchScript({ nodeScriptPath: NodePath.join(root, "fake-t3.cjs") }),
        );
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(lastJsonLine(result.stdout).serverKind, "managed");
        assert.lengthOf((await NodeFSP.readFile(callsFile, "utf8")).trim().split("\n"), 1);
      } finally {
        launcher.kill();
        previous.kill();
        await stopManagedServer(home);
      }
    });
  }),
);
