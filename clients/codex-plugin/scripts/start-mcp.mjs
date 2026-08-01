import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverEntry = path.join(pluginRoot, "dist", "server.mjs");

if (!existsSync(serverEntry)) {
  throw new Error(`MindArt runtime bundle is missing: ${serverEntry}`);
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
