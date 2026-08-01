import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "./paths.js";

describe("project root resolution", () => {
  it("prefers MINDART_PROJECT_DIR", () => {
    expect(
      resolveProjectRoot({
        cwd: "/tmp/current",
        homeDirectory: "/tmp/home",
        env: { MINDART_PROJECT_DIR: "../explicit" },
      }),
    ).toBe(path.resolve("../explicit"));
  });

  it("falls back to Documents/MindArt outside a project", () => {
    expect(
      resolveProjectRoot({
        cwd: "/tmp/no-project",
        homeDirectory: "/tmp/home",
        env: {},
      }),
    ).toBe("/tmp/home/Documents/MindArt");
  });
});
