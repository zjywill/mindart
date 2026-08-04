import { describe, expect, it } from "vitest";
import { revealCommand } from "./reveal.js";

const FILE = "/projects/demo/mindart/board-1/assets/art.png";

describe("revealCommand", () => {
  it("reveals without opening on macOS", () => {
    expect(revealCommand(FILE, "finder", "darwin")).toEqual([
      "open",
      ["-R", FILE],
    ]);
  });

  it("names a browser on macOS so a PNG does not land in Preview", () => {
    const [command, args] = revealCommand(FILE, "browser", "darwin");
    expect(command).toBe("open");
    expect(args).toEqual(["-a", "Safari", FILE]);
  });

  it("selects the file in Explorer on Windows", () => {
    expect(revealCommand(FILE, "finder", "win32")).toEqual([
      "explorer.exe",
      [`/select,${FILE}`],
    ]);
  });

  it("falls back to the containing directory on Linux", () => {
    expect(revealCommand(FILE, "finder", "linux")).toEqual([
      "xdg-open",
      ["/projects/demo/mindart/board-1/assets"],
    ]);
  });

  it("passes a file URL when opening in a browser off macOS", () => {
    const [, args] = revealCommand(FILE, "browser", "linux");
    expect(args[0]).toBe(`file://${FILE}`);
  });

  it("encodes characters that would break a file URL", () => {
    const [, args] = revealCommand(
      "/projects/my art/board 1/assets/a b.png",
      "browser",
      "linux",
    );
    expect(args[0]).toBe("file:///projects/my%20art/board%201/assets/a%20b.png");
  });

  it("keeps the path intact for the file manager, which takes a path not a URL", () => {
    const [, args] = revealCommand(
      "/projects/my art/board 1/assets/a b.png",
      "finder",
      "darwin",
    );
    expect(args[1]).toBe("/projects/my art/board 1/assets/a b.png");
  });
});
