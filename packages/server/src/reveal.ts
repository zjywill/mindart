import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export type RevealMode = "finder" | "browser";

/**
 * Hand a file to the desktop so the user can see it at full size. The canvas
 * runs sandboxed and cannot reach the filesystem or spawn anything, so this has
 * to happen server-side.
 *
 * Callers must pass a path already validated as belonging to a board — the
 * argument reaches the OS.
 */
export async function revealFile(
  filePath: string,
  mode: RevealMode,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const [command, args] = revealCommand(filePath, mode, platform);
  await run(command, args);
}

export function revealCommand(
  filePath: string,
  mode: RevealMode,
  platform: NodeJS.Platform,
): [string, string[]] {
  if (platform === "darwin") {
    // -R reveals without opening; -a Safari is the one browser guaranteed
    // present, and unlike a bare `open` it will not hand a PNG to Preview.
    return mode === "finder"
      ? ["open", ["-R", filePath]]
      : ["open", ["-a", "Safari", filePath]];
  }

  if (platform === "win32") {
    return mode === "finder"
      ? ["explorer.exe", [`/select,${filePath}`]]
      : ["cmd.exe", ["/c", "start", "", pathToFileUrl(filePath)]];
  }

  return mode === "finder"
    ? ["xdg-open", [path.dirname(filePath)]]
    : ["xdg-open", [pathToFileUrl(filePath)]];
}

function pathToFileUrl(filePath: string): string {
  const normalized = filePath.replaceAll("\\", "/");
  const prefixed = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return `file://${prefixed.split("/").map(encodeURIComponent).join("/")}`;
}
