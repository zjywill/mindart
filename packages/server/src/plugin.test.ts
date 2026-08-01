import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "..", "..", "..");

describe("plugin packaging", () => {
  it("keeps one user-visible skill in each plugin shell", async () => {
    const paths = [
      "clients/codex-plugin/skills/mindart/SKILL.md",
      "clients/claude-plugin/skills/mindart/SKILL.md",
    ];
    for (const relativePath of paths) {
      const contents = await readFile(
        path.join(repositoryRoot, relativePath),
        "utf8",
      );
      expect(contents).toContain("name: mindart");
      expect(contents).not.toContain("[TODO:");
      expect(contents).toContain("mindart_apply_result");
    }
  });

  it("uses matching normalized names in both plugin manifests", async () => {
    const codex = JSON.parse(
      await readFile(
        path.join(
          repositoryRoot,
          "clients/codex-plugin/.codex-plugin/plugin.json",
        ),
        "utf8",
      ),
    ) as { name: string; mcpServers: string; skills: string };
    const claude = JSON.parse(
      await readFile(
        path.join(
          repositoryRoot,
          "clients/claude-plugin/.claude-plugin/plugin.json",
        ),
        "utf8",
      ),
    ) as { name: string };

    expect(codex).toMatchObject({
      name: "mindart",
      mcpServers: "./.mcp.json",
      skills: "./skills/",
    });
    expect(claude.name).toBe("mindart");
  });

  it("ships a self-contained Codex runtime bundle", async () => {
    const pluginRoot = path.join(repositoryRoot, "clients/codex-plugin");
    const startScript = await readFile(
      path.join(pluginRoot, "scripts/start-mcp.mjs"),
      "utf8",
    );

    expect(startScript).toContain('path.join(pluginRoot, "dist", "server.mjs")');
    expect(startScript).not.toContain("corepack");
    await access(path.join(pluginRoot, "dist", "server.mjs"));
    await access(path.join(pluginRoot, "dist", "ui", "mcp-app.html"));
  });
});
