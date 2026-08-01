import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(pluginRoot, "..", "..");
const serverEntry = path.join(repositoryRoot, "packages", "server", "dist", "index.js");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: { ...process.env, FORCE_COLOR: "0" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit ${result.status}.`);
  }
}

if (!existsSync(path.join(repositoryRoot, "node_modules"))) {
  run("corepack", ["pnpm", "install", "--frozen-lockfile"]);
}
if (!existsSync(serverEntry)) {
  run("corepack", ["pnpm", "build"]);
}

const child = spawn(process.execPath, [serverEntry], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
