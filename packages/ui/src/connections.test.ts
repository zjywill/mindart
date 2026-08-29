import { describe, expect, it } from "vitest";
import { cardLinkAnchors, cardLinkPath } from "./connections.js";

describe("cardLinkPath", () => {
  it("draws a vertical S-curve from source bottom to target top", () => {
    expect(cardLinkPath(150, 100, 400, 400)).toBe(
      "M 150 100 C 150 226 400 274 400 400",
    );
  });

  it("keeps a useful curve when cards are close together", () => {
    expect(cardLinkPath(100, 100, 100, 140)).toBe(
      "M 100 100 C 100 124 100 116 100 140",
    );
  });

  it("mirrors the curve when the lineage points upward", () => {
    expect(cardLinkPath(150, 400, 400, 100)).toBe(
      "M 150 400 C 150 274 400 226 400 100",
    );
  });
});

describe("cardLinkAnchors", () => {
  const source = { x: 0, y: 0, width: 264, height: 300 };

  it("anchors bottom-of-source to top-of-target when the target sits below", () => {
    const target = { x: 100, y: 560, width: 288, height: 500 };
    expect(cardLinkAnchors(source, target)).toEqual({
      startX: 132,
      startY: 300,
      endX: 244,
      endY: 560,
      midX: 188,
      midY: 430,
    });
  });

  it("flips the anchors when the canvas puts the target above", () => {
    const target = { x: 100, y: -900, width: 288, height: 500 };
    const anchors = cardLinkAnchors(source, target);
    expect(anchors.startY).toBe(0);
    expect(anchors.endY).toBe(-400);
  });
});
