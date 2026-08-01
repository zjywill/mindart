export interface BranchPathParams {
  pT: number;
  pL: number;
  pW: number;
  pH: number;
  cT: number;
  cL: number;
  cW: number;
  cH: number;
  direction: string;
}

export interface ArrowHandle {
  x: number;
  y: number;
}

export const TREE_NODE_GAP_X = 48;

function coordinate(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function directCurve(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): string {
  const horizontalDistance = Math.abs(endX - startX);
  const handleLength = Math.min(
    160,
    Math.max(40, horizontalDistance * 0.42),
    horizontalDistance / 2,
  );
  const directionSign = endX >= startX ? 1 : -1;
  const firstControlX = startX + handleLength * directionSign;
  const secondControlX = endX - handleLength * directionSign;

  return [
    `M ${coordinate(startX)} ${coordinate(startY)}`,
    `C ${coordinate(firstControlX)} ${coordinate(startY)}`,
    `${coordinate(secondControlX)} ${coordinate(endY)}`,
    `${coordinate(endX)} ${coordinate(endY)}`,
  ].join(" ");
}

export function directBranchPath({
  pT,
  pL,
  pW,
  pH,
  cT,
  cL,
  cW,
  cH,
  direction,
}: BranchPathParams): string {
  const connectsLeftward = direction === "lhs";
  const startX = connectsLeftward ? pL : pL + pW;
  const endX = connectsLeftward ? cL + cW : cL;

  return directCurve(
    startX,
    pT + pH / 2,
    endX,
    cT + cH / 2,
  );
}

export function directSubBranchPath({
  pT,
  pL,
  pW,
  pH,
  cT,
  cL,
  cW,
  cH,
  direction,
}: BranchPathParams): string {
  const connectsLeftward = direction === "lhs";
  const startX = connectsLeftward ? pL : pL + pW;
  const endX = connectsLeftward
    ? cL + cW - TREE_NODE_GAP_X
    : cL + TREE_NODE_GAP_X;

  return directCurve(
    startX,
    pT + pH / 2,
    endX,
    cT + cH / 2,
  );
}

export function referenceArrowHandles(
  sourceIndex: number,
  targetIndex: number,
): { delta1: ArrowHandle; delta2: ArrowHandle } {
  const verticalDirection = Math.sign(targetIndex - sourceIndex);
  const verticalOffset = verticalDirection * 72;
  const targetVerticalOffset =
    verticalOffset === 0 ? 0 : -verticalOffset;

  return {
    delta1: { x: 240, y: verticalOffset },
    delta2: { x: -240, y: targetVerticalOffset },
  };
}
