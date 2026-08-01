import { describe, expect, it } from "vitest";
import {
  directBranchPath,
  directSubBranchPath,
  referenceArrowHandles,
} from "./connections.js";

describe("directBranchPath", () => {
  it("connects a right-side parent directly to the child's left edge", () => {
    expect(
      directBranchPath({
        pT: 20,
        pL: 40,
        pW: 100,
        pH: 60,
        cT: 140,
        cL: 260,
        cW: 80,
        cH: 100,
        direction: "rhs",
      }),
    ).toBe("M 140 50 C 190.4 50 209.6 190 260 190");
  });

  it("mirrors the connector for a left-side branch", () => {
    expect(
      directBranchPath({
        pT: 20,
        pL: 260,
        pW: 100,
        pH: 60,
        cT: 140,
        cL: 40,
        cW: 80,
        cH: 100,
        direction: "lhs",
      }),
    ).toBe("M 260 50 C 201.2 50 178.8 190 120 190");
  });

  it("keeps a useful curve when nodes are close together", () => {
    expect(
      directBranchPath({
        pT: 0,
        pL: 0,
        pW: 100,
        pH: 40,
        cT: 0,
        cL: 130,
        cW: 100,
        cH: 40,
        direction: "rhs",
      }),
    ).toBe("M 100 20 C 115 20 115 20 130 20");
  });
});

describe("directSubBranchPath", () => {
  it("accounts for the child wrapper inset on a right-side branch", () => {
    expect(
      directSubBranchPath({
        pT: 350,
        pL: 50,
        pW: 224,
        pH: 54,
        cT: 350,
        cL: 284,
        cW: 384,
        cH: 65,
        direction: "rhs",
      }),
    ).toBe("M 274 377 C 303 377 303 382.5 332 382.5");
  });

  it("mirrors the child wrapper inset on a left-side branch", () => {
    expect(
      directSubBranchPath({
        pT: 350,
        pL: 394,
        pW: 224,
        pH: 54,
        cT: 350,
        cL: 0,
        cW: 384,
        cH: 65,
        direction: "lhs",
      }),
    ).toBe("M 394 377 C 365 377 365 382.5 336 382.5");
  });
});

describe("referenceArrowHandles", () => {
  it("aims an upward reference from the source's upper edge to the target's lower edge", () => {
    expect(referenceArrowHandles(3, 1)).toEqual({
      delta1: { x: 240, y: -72 },
      delta2: { x: -240, y: 72 },
    });
  });

  it("keeps references on the same row horizontal", () => {
    expect(referenceArrowHandles(2, 2)).toEqual({
      delta1: { x: 240, y: 0 },
      delta2: { x: -240, y: 0 },
    });
  });
});
