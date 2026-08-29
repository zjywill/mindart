function coordinate(value: number): string {
  return Number(value.toFixed(2)).toString();
}

/**
 * A lineage link runs from the bottom edge of a source card to the top edge
 * of the card derived from it: a vertical S-curve, matching the way
 * generations grow downward on the canvas.
 */
export function cardLinkPath(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): string {
  const verticalDistance = Math.abs(endY - startY);
  const handleLength = Math.min(
    160,
    Math.max(40, verticalDistance * 0.42),
    Math.max(verticalDistance / 2, 24),
  );
  const directionSign = endY >= startY ? 1 : -1;
  const firstControlY = startY + handleLength * directionSign;
  const secondControlY = endY - handleLength * directionSign;

  return [
    `M ${coordinate(startX)} ${coordinate(startY)}`,
    `C ${coordinate(startX)} ${coordinate(firstControlY)}`,
    `${coordinate(endX)} ${coordinate(secondControlY)}`,
    `${coordinate(endX)} ${coordinate(endY)}`,
  ].join(" ");
}

export interface LinkAnchors {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  midX: number;
  midY: number;
}

interface CardBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Anchor a link on the facing edges of the two cards: bottom of the source to
 * top of the target when the target sits below, and the reverse when the
 * canvas has been rearranged so the lineage points upward.
 */
export function cardLinkAnchors(source: CardBox, target: CardBox): LinkAnchors {
  const sourceCenterY = source.y + source.height / 2;
  const targetCenterY = target.y + target.height / 2;
  const downward = targetCenterY >= sourceCenterY;
  const startX = source.x + source.width / 2;
  const endX = target.x + target.width / 2;
  const startY = downward ? source.y + source.height : source.y;
  const endY = downward ? target.y : target.y + target.height;
  return {
    startX,
    startY,
    endX,
    endY,
    midX: (startX + endX) / 2,
    midY: (startY + endY) / 2,
  };
}
