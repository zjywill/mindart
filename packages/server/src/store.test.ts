import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MindArtStore } from "./store.js";

const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);

describe("MindArtStore", () => {
  let root: string;
  let store: MindArtStore;
  let parentPath: string;
  let sourcePath: string;
  let resultPath: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "mindart-store-"));
    parentPath = path.join(root, "parent.png");
    sourcePath = path.join(root, "source.png");
    resultPath = path.join(root, "result.png");
    await Promise.all([
      writeFile(parentPath, PIXEL),
      writeFile(sourcePath, PIXEL),
      writeFile(resultPath, PIXEL),
    ]);
    store = new MindArtStore(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("persists a complete import, request, and result workflow", async () => {
    let board = await store.openBoard("board-flow", "角色设计");
    const parent = await store.importImage({
      boardId: board.id,
      sourcePath: parentPath,
      title: "体型",
    });
    const source = await store.importImage({
      boardId: board.id,
      sourcePath,
      title: "配色",
    });
    board = source.board;

    const parentNode = board.root.children.find(
      (node) => node.id === parent.nodeId,
    )!;
    parentNode.children.push({
      id: "target",
      title: "新角色",
      status: "draft",
      prompt: "把图2的配色用于图1的体型",
      note: "统一材质",
      refs: [{ order: 1, source: "parent", usage: "体型" }],
      children: [],
    });
    board = await store.updateBoard(board.id, { root: board.root });

    const queued = await store.requestGeneration(board.id, "target", {
      prompt: "把图2的配色用于图1的体型",
      note: "统一材质",
      refs: [
        { sourceNodeId: parent.nodeId, usage: "体型" },
        { sourceNodeId: source.nodeId, usage: "绿色配色" },
      ],
    });

    expect(queued.refs.map((reference) => reference.node)).toEqual([
      parent.nodeId,
      source.nodeId,
    ]);
    expect(queued.compiledPrompt).toContain("参考图 2");
    expect(
      queued.board.requests[queued.requestId]?.status,
    ).toBe("queued");

    const ready = await store.applyResult(queued.requestId, resultPath);
    const target = ready.root.children
      .find((node) => node.id === parent.nodeId)!
      .children.find((node) => node.id === "target")!;
    expect(target.status).toBe("ready");
    expect(target.asset).toMatch(/^assets\/req-/u);

    const asset = await store.readAsset(ready.id, target.asset!);
    expect(asset.mimeType).toBe("image/png");
    expect(Buffer.from(asset.data, "base64")).toEqual(PIXEL);

    const reopened = await store.getBoard(board.id);
    expect(reopened.requests[queued.requestId]?.status).toBe("ready");
    expect(
      JSON.parse(await readFile(store.boardFile(board.id), "utf8")),
    ).toMatchObject({ id: board.id, version: 1 });
  });

  it("reopens the most recently updated board when no id is provided", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-02T01:00:00.000Z"));
      await store.openBoard("board-first", "First");
      vi.setSystemTime(new Date("2026-08-02T01:01:00.000Z"));
      await store.openBoard("board-second", "Second");

      expect((await store.openBoard()).id).toBe("board-second");

      vi.setSystemTime(new Date("2026-08-02T01:02:00.000Z"));
      await store.updateBoard("board-first", { title: "First updated" });
      expect((await store.openBoard()).id).toBe("board-first");
    } finally {
      vi.useRealTimers();
    }
  });

  it("creates a new board when a title is explicitly provided", async () => {
    const existing = await store.openBoard("board-existing", "Existing");
    const created = await store.openBoard(undefined, "New board");

    expect(created.id).not.toBe(existing.id);
    expect(created.title).toBe("New board");
  });

  it("resolves an asset path only inside the board it belongs to", async () => {
    const board = await store.openBoard("board-paths", "Paths");

    expect(store.assetFilePath(board.id, "assets/art.png")).toBe(
      path.join(root, "mindart", board.id, "assets", "art.png"),
    );
    expect(() =>
      store.assetFilePath(board.id, "../../../etc/passwd.png"),
    ).toThrow("Only board assets can be read");
    expect(() =>
      store.assetFilePath(board.id, "assets/../../other/art.png"),
    ).toThrow("escapes the MindArt board directory");
    expect(() => store.assetFilePath(board.id, "assets/run.sh")).toThrow(
      "Unsupported image type",
    );
  });

  it("reports whether a board id resolves under the current project root", async () => {
    await store.openBoard("board-present", "Present");

    await expect(store.hasBoard("board-present")).resolves.toBe(true);
    await expect(store.hasBoard("board-absent")).resolves.toBe(false);
  });

  it("does not see a board that lives under a different project root", async () => {
    await store.openBoard("board-elsewhere", "Elsewhere");
    const otherRoot = await mkdtemp(path.join(os.tmpdir(), "mindart-other-"));
    try {
      const other = new MindArtStore(otherRoot);
      await other.initialize();

      await expect(other.hasBoard("board-elsewhere")).resolves.toBe(false);
    } finally {
      await rm(otherRoot, { recursive: true, force: true });
    }
  });

  it("records a retryable error on both request and node", async () => {
    let board = await store.openBoard("board-error", "Error");
    board.root.children.push({
      id: "target",
      title: "Target",
      status: "draft",
      prompt: "生成",
      children: [],
    });
    board = await store.updateBoard(board.id, { root: board.root });
    const queued = await store.requestGeneration(board.id, "target", {
      prompt: "生成",
      refs: [],
    });

    const failed = await store.reportError(queued.requestId, "No image tool");
    expect(failed.requests[queued.requestId]?.status).toBe("error");
    expect(failed.root.children[0]?.status).toBe("error");
    expect(failed.root.children[0]?.error).toBe("No image tool");
  });

  it("imports uploaded image data without a local source path", async () => {
    const board = await store.openBoard("board-upload", "Upload");
    const imported = await store.importImage({
      boardId: board.id,
      imageData: PIXEL.toString("base64"),
      fileName: "reference.png",
      mimeType: "image/png",
    });
    const node = imported.board.root.children[0]!;

    expect(node).toMatchObject({
      title: "reference",
      status: "ready",
    });
    expect(node.asset).toMatch(/^assets\/reference-/u);
    const asset = await store.readAsset(imported.board.id, node.asset!);
    expect(Buffer.from(asset.data, "base64")).toEqual(PIXEL);
  });

  it("rejects invalid uploaded image data", async () => {
    await expect(
      store.importImage({
        imageData: "not-base64",
        fileName: "broken.png",
      }),
    ).rejects.toThrow("valid base64");
  });

  it("enforces the total five-reference limit including the parent", async () => {
    let board = await store.openBoard("board-limit", "Limit");
    const parent = await store.importImage({
      boardId: board.id,
      sourcePath: parentPath,
      title: "Parent",
    });
    board = parent.board;

    const sourceIds: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const imported = await store.importImage({
        boardId: board.id,
        sourcePath,
        title: `Source ${index}`,
      });
      board = imported.board;
      sourceIds.push(imported.nodeId);
    }
    const parentNode = board.root.children.find(
      (node) => node.id === parent.nodeId,
    )!;
    parentNode.children.push({
      id: "target",
      title: "Target",
      status: "draft",
      prompt: "Generate",
      children: [],
    });
    await store.updateBoard(board.id, { root: board.root });

    await expect(
      store.requestGeneration(board.id, "target", {
        prompt: "Generate",
        refs: sourceIds.map((sourceNodeId) => ({
          sourceNodeId,
          usage: "",
        })),
      }),
    ).rejects.toThrow("at most 5 reference images");
  });

  it("rejects asset path traversal", async () => {
    await store.openBoard("board-traversal", "Traversal");
    await expect(
      store.readAsset("board-traversal", "../parent.png"),
    ).rejects.toThrow("Only board assets can be read");
  });

  it("rejects board ids that could escape the MindArt root", async () => {
    await expect(store.openBoard("../outside", "Outside")).rejects.toThrow(
      "Invalid board id",
    );
  });

  it("preserves server-owned generation state during canvas saves", async () => {
    let board = await store.openBoard("board-merge", "Merge");
    board.root.children.push({
      id: "target",
      title: "Target",
      status: "draft",
      prompt: "Generate",
      children: [],
    });
    board = await store.updateBoard(board.id, { root: board.root });
    const queued = await store.requestGeneration(board.id, "target", {
      prompt: "Generate",
      refs: [],
    });
    const staleRoot = structuredClone(queued.board.root);

    const ready = await store.applyResult(queued.requestId, resultPath);
    const staleTarget = staleRoot.children[0]!;
    staleTarget.title = "Renamed";
    staleTarget.status = "queued";
    delete staleTarget.asset;
    const saved = await store.updateBoard(board.id, { root: staleRoot });
    const savedTarget = saved.root.children[0]!;

    expect(savedTarget).toMatchObject({
      title: "Renamed",
      status: "ready",
      asset: ready.root.children[0]!.asset,
      requestId: queued.requestId,
    });
    expect(saved.requests[queued.requestId]?.status).toBe("ready");
  });
});
