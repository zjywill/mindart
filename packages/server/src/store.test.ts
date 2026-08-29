import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CARD_SLOT_HEIGHT } from "./model.js";
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
    const body = await store.importImage({
      boardId: board.id,
      sourcePath: parentPath,
      title: "体型",
    });
    const palette = await store.importImage({
      boardId: board.id,
      sourcePath,
      title: "配色",
    });
    board = palette.board;

    board.nodes.push({
      id: "target",
      title: "新角色",
      status: "draft",
      prompt: "把图2的配色用于图1的体型",
      note: "统一材质",
      x: 0,
      y: CARD_SLOT_HEIGHT,
    });
    board = await store.updateBoard(board.id, { nodes: board.nodes });

    const queued = await store.requestGeneration(board.id, "target", {
      prompt: "把图2的配色用于图1的体型",
      note: "统一材质",
      refs: [
        { sourceNodeId: body.nodeId, usage: "体型" },
        { sourceNodeId: palette.nodeId, usage: "绿色配色" },
      ],
    });

    expect(queued.refs.map((reference) => reference.node)).toEqual([
      body.nodeId,
      palette.nodeId,
    ]);
    expect(queued.compiledPrompt).toContain("参考图 2");
    expect(
      queued.board.requests[queued.requestId]?.status,
    ).toBe("queued");

    const ready = await store.applyResult(queued.requestId, resultPath);
    const target = ready.nodes.find((card) => card.id === "target")!;
    expect(target.status).toBe("ready");
    expect(target.asset).toMatch(/^assets\/req-/u);
    expect(target.refs).toEqual([
      { order: 1, source: body.nodeId, usage: "体型" },
      { order: 2, source: palette.nodeId, usage: "绿色配色" },
    ]);

    const asset = await store.readAsset(ready.id, target.asset!);
    expect(asset.mimeType).toBe("image/png");
    expect(Buffer.from(asset.data, "base64")).toEqual(PIXEL);

    const reopened = await store.getBoard(board.id);
    expect(reopened.requests[queued.requestId]?.status).toBe("ready");
    expect(
      JSON.parse(await readFile(store.boardFile(board.id), "utf8")),
    ).toMatchObject({ id: board.id, version: 2 });
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

  it("migrates a v1 board file on read and persists it back as v2", async () => {
    const legacy = {
      version: 1,
      id: "board-legacy",
      title: "Legacy",
      styleNote: "",
      root: {
        id: "root",
        title: "Legacy",
        expanded: true,
        children: [
          {
            id: "body",
            title: "Body",
            status: "ready",
            asset: "assets/body.png",
            expanded: true,
            children: [
              {
                id: "result",
                title: "Result",
                status: "draft",
                prompt: "combine",
                refs: [{ order: 1, source: "parent", usage: "体型" }],
                children: [],
              },
            ],
          },
        ],
      },
      refLines: [],
      requests: {},
      createdAt: "2026-08-01T08:00:00.000Z",
      updatedAt: "2026-08-01T08:01:00.000Z",
    };
    await store.openBoard("board-legacy", "placeholder");
    await writeFile(
      store.boardFile("board-legacy"),
      JSON.stringify(legacy),
      "utf8",
    );
    await writeFile(
      path.join(store.boardDirectory("board-legacy"), "assets", "body.png"),
      PIXEL,
    );

    const board = await store.getBoard("board-legacy");
    expect(board.version).toBe(2);
    const result = board.nodes.find((card) => card.id === "result")!;
    expect(result.refs).toEqual([{ order: 1, source: "body", usage: "体型" }]);
    expect(result.y).toBe(CARD_SLOT_HEIGHT);

    const saved = await store.updateBoard("board-legacy", { title: "Legacy" });
    expect(saved.version).toBe(2);
    expect(
      JSON.parse(await readFile(store.boardFile("board-legacy"), "utf8")),
    ).toMatchObject({ version: 2 });
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
    board.nodes.push({
      id: "target",
      title: "Target",
      status: "draft",
      prompt: "生成",
      x: 0,
      y: 0,
    });
    board = await store.updateBoard(board.id, { nodes: board.nodes });
    const queued = await store.requestGeneration(board.id, "target", {
      prompt: "生成",
      refs: [],
    });

    const failed = await store.reportError(queued.requestId, "No image tool");
    expect(failed.requests[queued.requestId]?.status).toBe("error");
    expect(failed.nodes[0]?.status).toBe("error");
    expect(failed.nodes[0]?.error).toBe("No image tool");
  });

  it("imports uploaded image data without a local source path", async () => {
    const board = await store.openBoard("board-upload", "Upload");
    const imported = await store.importImage({
      boardId: board.id,
      imageData: PIXEL.toString("base64"),
      fileName: "reference.png",
      mimeType: "image/png",
    });
    const node = imported.board.nodes[0]!;

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

  it("enforces the five-reference limit on a card", async () => {
    let board = await store.openBoard("board-limit", "Limit");
    const sourceIds: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      const imported = await store.importImage({
        boardId: board.id,
        sourcePath,
        title: `Source ${index}`,
      });
      board = imported.board;
      sourceIds.push(imported.nodeId);
    }
    const target = await store.importImage({
      boardId: board.id,
      sourcePath: resultPath,
      title: "Target",
    });

    await expect(
      store.linkSources(board.id, target.nodeId, {
        sources: sourceIds.map((nodeId) => ({ nodeId, usage: "" })),
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
    board.nodes.push({
      id: "target",
      title: "Target",
      status: "draft",
      prompt: "Generate",
      x: 0,
      y: 0,
    });
    board = await store.updateBoard(board.id, { nodes: board.nodes });
    const queued = await store.requestGeneration(board.id, "target", {
      prompt: "Generate",
      refs: [],
    });
    const staleNodes = structuredClone(queued.board.nodes);

    const ready = await store.applyResult(queued.requestId, resultPath);
    const staleTarget = staleNodes[0]!;
    staleTarget.title = "Renamed";
    staleTarget.status = "queued";
    staleTarget.x = 720;
    delete staleTarget.asset;
    const saved = await store.updateBoard(board.id, { nodes: staleNodes });
    const savedTarget = saved.nodes[0]!;

    expect(savedTarget).toMatchObject({
      title: "Renamed",
      status: "ready",
      asset: ready.nodes[0]!.asset,
      requestId: queued.requestId,
      x: 720,
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

    const generatedNode = generated.board.nodes.find(
      (card) => card.id === generated.nodeId,
    )!;
    expect(generatedNode.prompt).toBe("把角色的头做成风格图那样的 icon");
    expect(generated.refs).toEqual([
      { order: 1, source: character.nodeId, usage: "保留头部特征与配色" },
      { order: 2, source: style.nodeId, usage: "沿用绿色圆角方形 icon 风格" },
    ]);

    // A derived card lands below its primary source on the canvas.
    const characterNode = generated.board.nodes.find(
      (card) => card.id === character.nodeId,
    )!;
    expect(generatedNode.y).toBe(characterNode.y + CARD_SLOT_HEIGHT);
  });

  it("honours an explicit canvas position on import", async () => {
    const board = await store.openBoard("board-position", "Position");
    const imported = await store.importImage({
      boardId: board.id,
      sourcePath,
      title: "落点",
      x: 123.5,
      y: -456,
    });
    const node = imported.board.nodes.find(
      (card) => card.id === imported.nodeId,
    )!;
    expect(node.x).toBe(123.5);
    expect(node.y).toBe(-456);
  });

  it("refuses to import against a source that has no image", async () => {
    let board = await store.openBoard("board-bad-source", "Bad");
    board.nodes.push({
      id: "sketch",
      title: "Sketch",
      status: "draft",
      x: 0,
      y: 0,
    });
    board = await store.updateBoard(board.id, { nodes: board.nodes });

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

    const linked = await store.linkSources(board.id, flat.nodeId, {
      parentNodeId: character.nodeId,
      sources: [{ nodeId: style.nodeId, usage: "风格" }],
    });

    expect(linked.refs).toEqual([
      { order: 1, source: character.nodeId, usage: "" },
      { order: 2, source: style.nodeId, usage: "风格" },
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
      { order: 1, source: character.nodeId, usage: "" },
      { order: 2, source: style.nodeId, usage: "配色" },
    ]);
  });

  it("refuses to make a card its own source", async () => {
    const board = await store.openBoard("board-self", "Self");
    const imported = await store.importImage({
      boardId: board.id,
      sourcePath,
      title: "自己",
    });

    await expect(
      store.linkSources(board.id, imported.nodeId, {
        parentNodeId: imported.nodeId,
      }),
    ).rejects.toThrow("A card cannot be its own source");
  });

  it("chains edits so each new image references the one it was made from", async () => {
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

    // Each accepted edit references the image it was made from, so the lineage
    // reads as the edit history of one image.
    expect(first.refs).toEqual([
      { order: 1, source: original.nodeId, usage: "保留主体，只换背景" },
    ]);
    expect(second.refs).toEqual([
      { order: 1, source: first.nodeId, usage: "保留蓝色背景与主体" },
    ]);

    // And each lands one row deeper on the canvas.
    const cards = new Map(
      second.board.nodes.map((card) => [card.id, card]),
    );
    expect(cards.get(first.nodeId)!.y).toBe(
      cards.get(original.nodeId)!.y + CARD_SLOT_HEIGHT,
    );
    expect(cards.get(second.nodeId)!.y).toBe(
      cards.get(first.nodeId)!.y + CARD_SLOT_HEIGHT,
    );
  });

  it("keeps variants of one prompt referencing the same base", async () => {
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

    // Every variant references the base directly. A chain would claim each
    // option was generated from the previous one.
    for (const variant of variants) {
      expect(variant.refs).toEqual([
        { order: 1, source: base.nodeId, usage: "保留构图" },
      ]);
    }
    // Variants share the base's row below it, sliding right, never stacking.
    const final = variants.at(-1)!.board;
    const positions = variants.map((variant) => {
      const card = final.nodes.find((node) => node.id === variant.nodeId)!;
      return `${card.x},${card.y}`;
    });
    expect(new Set(positions).size).toBe(positions.length);
  });
});
