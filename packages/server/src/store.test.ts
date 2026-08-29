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

  it("reports a deleted asset file as missing, not as a read failure", async () => {
    await store.openBoard("board-missing", "Missing");
    await expect(
      store.readAsset("board-missing", "assets/gone.png"),
    ).rejects.toThrow("Asset missing: assets/gone.png");
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
  it("records the lineage of an imported generated image", async () => {
    const board = await store.openBoard("board-lineage", "Icon");
    const style = await store.importImage({
      boardId: board.id,
      sourcePath: parentPath,
      title: "参考图 1：风格",
    });
    const character = await store.importImage({
      boardId: board.id,
      sourcePath,
      title: "参考图 2：角色",
    });

    const generated = await store.importImage({
      boardId: board.id,
      sourcePath: resultPath,
      title: "角色头像 Icon",
      parentNodeId: character.nodeId,
      sources: [
        { nodeId: character.nodeId, usage: "保留头部特征与配色" },
        { nodeId: style.nodeId, usage: "沿用绿色圆角方形 icon 风格" },
      ],
      prompt: "把角色的头做成风格图那样的 icon",
    });

    const characterNode = generated.board.root.children.find(
      (node) => node.id === character.nodeId,
    )!;
    const generatedNode = characterNode.children[0]!;

    expect(generatedNode.id).toBe(generated.nodeId);
    expect(generatedNode.prompt).toBe("把角色的头做成风格图那样的 icon");
    expect(generated.refs).toEqual([
      { order: 1, source: "parent", usage: "保留头部特征与配色" },
      {
        order: 2,
        source: style.nodeId,
        usage: "沿用绿色圆角方形 icon 风格",
        refLineId: `ref-${style.nodeId}-${generated.nodeId}`,
      },
    ]);
    expect(generated.board.refLines).toEqual([
      {
        id: `ref-${style.nodeId}-${generated.nodeId}`,
        from: style.nodeId,
        to: generated.nodeId,
      },
    ]);
  });

  it("refuses to import against a source that has no image", async () => {
    let board = await store.openBoard("board-bad-source", "Bad");
    board.root.children.push({
      id: "sketch",
      title: "Sketch",
      status: "draft",
      children: [],
    });
    board = await store.updateBoard(board.id, { root: board.root });

    await expect(
      store.importImage({
        boardId: board.id,
        sourcePath: resultPath,
        sources: [{ nodeId: "sketch", usage: "" }],
      }),
    ).rejects.toThrow("Source node sketch has no image to reference yet");
  });

  it("repairs a flat board by linking a card to its sources", async () => {
    const board = await store.openBoard("board-repair", "Repair");
    const style = await store.importImage({
      boardId: board.id,
      sourcePath: parentPath,
      title: "风格",
    });
    const character = await store.importImage({
      boardId: board.id,
      sourcePath,
      title: "角色",
    });
    const flat = await store.importImage({
      boardId: board.id,
      sourcePath: resultPath,
      title: "结果",
    });

    expect(flat.refs).toEqual([]);
    expect(flat.board.root.children).toHaveLength(3);

    const linked = await store.linkSources(board.id, flat.nodeId, {
      parentNodeId: character.nodeId,
      sources: [{ nodeId: style.nodeId, usage: "风格" }],
    });

    expect(linked.board.root.children.map((node) => node.id)).toEqual([
      style.nodeId,
      character.nodeId,
    ]);
    const characterNode = linked.board.root.children[1]!;
    expect(characterNode.children[0]!.id).toBe(flat.nodeId);
    expect(linked.refs).toEqual([
      { order: 1, source: "parent", usage: "" },
      {
        order: 2,
        source: style.nodeId,
        usage: "风格",
        refLineId: `ref-${style.nodeId}-${flat.nodeId}`,
      },
    ]);
  });

  it("keeps existing references when only the primary source moves", async () => {
    const board = await store.openBoard("board-keep-refs", "Keep");
    const style = await store.importImage({
      boardId: board.id,
      sourcePath: parentPath,
      title: "风格",
    });
    const character = await store.importImage({
      boardId: board.id,
      sourcePath,
      title: "角色",
    });
    const result = await store.importImage({
      boardId: board.id,
      sourcePath: resultPath,
      title: "结果",
      sources: [{ nodeId: style.nodeId, usage: "配色" }],
    });

    const linked = await store.linkSources(board.id, result.nodeId, {
      parentNodeId: character.nodeId,
    });

    expect(linked.refs).toEqual([
      { order: 1, source: "parent", usage: "" },
      {
        order: 2,
        source: style.nodeId,
        usage: "配色",
        refLineId: `ref-${style.nodeId}-${result.nodeId}`,
      },
    ]);
  });

  it("refuses to move a card under its own descendant", async () => {
    const board = await store.openBoard("board-cycle", "Cycle");
    const top = await store.importImage({
      boardId: board.id,
      sourcePath: parentPath,
      title: "上",
    });
    const below = await store.importImage({
      boardId: board.id,
      sourcePath: resultPath,
      title: "下",
      parentNodeId: top.nodeId,
    });

    await expect(
      store.linkSources(board.id, top.nodeId, {
        parentNodeId: below.nodeId,
      }),
    ).rejects.toThrow(
      `Cannot move ${top.nodeId} under its own descendant ${below.nodeId}`,
    );
  });

  it("grows a branch as one image is edited again and again", async () => {
    const board = await store.openBoard("board-edits", "Edits");
    const original = await store.importImage({
      boardId: board.id,
      sourcePath: parentPath,
      title: "原图",
    });
    const first = await store.importImage({
      boardId: board.id,
      sourcePath: resultPath,
      title: "改版 1：换蓝色背景",
      parentNodeId: original.nodeId,
      sources: [{ nodeId: original.nodeId, usage: "保留主体，只换背景" }],
      prompt: "把背景换成蓝色",
    });
    const second = await store.importImage({
      boardId: board.id,
      sourcePath: sourcePath,
      title: "改版 2：加帽子",
      parentNodeId: first.nodeId,
      sources: [{ nodeId: first.nodeId, usage: "保留蓝色背景与主体" }],
      prompt: "给角色加一顶帽子",
    });

    // Each accepted edit hangs off the image it was made from, so the branch
    // reads top to bottom as the edit history of one image.
    const originalNode = second.board.root.children[0]!;
    expect(originalNode.id).toBe(original.nodeId);
    const firstNode = originalNode.children[0]!;
    expect(firstNode.id).toBe(first.nodeId);
    expect(firstNode.children[0]!.id).toBe(second.nodeId);
    expect(second.board.root.children).toHaveLength(1);
    expect(second.refs).toEqual([
      { order: 1, source: "parent", usage: "保留蓝色背景与主体" },
    ]);
    // An edit chain is pure parent links, so it draws no cross-branch lines.
    expect(second.board.refLines).toEqual([]);
  });

  it("keeps variants of one prompt as siblings rather than a chain", async () => {
    const board = await store.openBoard("board-variants", "Variants");
    const base = await store.importImage({
      boardId: board.id,
      sourcePath: parentPath,
      title: "底图",
    });

    const variants = [];
    for (const [index, file] of [parentPath, sourcePath, resultPath].entries()) {
      variants.push(
        await store.importImage({
          boardId: board.id,
          sourcePath: file,
          title: `方案 ${index + 1}`,
          parentNodeId: base.nodeId,
          sources: [{ nodeId: base.nodeId, usage: "保留构图" }],
          prompt: "换一种配色",
        }),
      );
    }

    const baseNode = variants.at(-1)!.board.root.children[0]!;
    expect(baseNode.children.map((node) => node.id)).toEqual(
      variants.map((variant) => variant.nodeId),
    );
    // Every variant is one generation deep. A chain would claim each option was
    // generated from the previous one.
    for (const variant of baseNode.children) {
      expect(variant.children).toEqual([]);
    }
  });
});
