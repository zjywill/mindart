import { access, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.resolve(packageDir, "../ui/dist/mcp-app.html");
const targetDir = path.join(packageDir, "dist", "ui");
const target = path.join(targetDir, "mcp-app.html");

await access(source);
await mkdir(targetDir, { recursive: true });
await copyFile(source, target);
