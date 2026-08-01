import os from "node:os";
import path from "node:path";
import { accessSync, constants, existsSync } from "node:fs";

export interface ResolveRootOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  homeDirectory?: string;
}

export function resolveProjectRoot({
  cwd = process.cwd(),
  env = process.env,
  homeDirectory = os.homedir(),
}: ResolveRootOptions = {}): string {
  const explicit = env.MINDART_PROJECT_DIR?.trim();
  if (explicit) return path.resolve(explicit);

  if (existsSync(path.join(cwd, ".git")) || existsSync(path.join(cwd, "mindart"))) {
    return path.resolve(cwd);
  }

  return path.join(homeDirectory, "Documents", "MindArt");
}

export function assertReadableFile(filePath: string): void {
  accessSync(filePath, constants.R_OK);
}

export function isPathInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative !== "" &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative)
  );
}

export function resolveInside(parent: string, relativePath: string): string {
  const resolved = path.resolve(parent, relativePath);
  if (!isPathInside(parent, resolved)) {
    throw new Error("Path escapes the MindArt board directory");
  }
  return resolved;
}
