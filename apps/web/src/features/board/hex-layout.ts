import { legacyBoardX, legacyBoardY, type LegacyBoardSpec } from "@secret-toaster/domain";

import type { PositionedHex } from "./types";

const SQRT_3 = Math.sqrt(3);

function hexPoints(cx: number, cy: number, radius: number): number[] {
  const halfWidth = (SQRT_3 / 2) * radius;
  return [
    cx,
    cy - radius,
    cx + halfWidth,
    cy - radius / 2,
    cx + halfWidth,
    cy + radius / 2,
    cx,
    cy + radius,
    cx - halfWidth,
    cy + radius / 2,
    cx - halfWidth,
    cy - radius / 2,
  ];
}

export interface BoardLayout {
  width: number;
  height: number;
  radius: number;
  hexes: PositionedHex[];
}

export function buildBoardLayout(input: {
  boardSpec: LegacyBoardSpec;
  radius?: number;
  padding?: number;
}): BoardLayout {
  const { boardSpec, radius = 34, padding = 24 } = input;
  const halfWidth = (SQRT_3 / 2) * radius;
  const columnStep = 2 * halfWidth;
  const rowStep = radius * 1.5;

  const rawHexes: PositionedHex[] = boardSpec.hexes.map((hex) => {
    const gridX = legacyBoardX(hex.index);
    const gridY = legacyBoardY(hex.index);
    const rowOffset = gridY % 2 === 0 ? halfWidth : 0;
    const cx = gridX * columnStep + rowOffset;
    const cy = gridY * rowStep;

    return {
      index: hex.index,
      type: hex.type,
      neighbors: hex.neighbors,
      gridX,
      gridY,
      cx,
      cy,
      points: hexPoints(cx, cy, radius),
    };
  });

  const minX = Math.min(...rawHexes.map((hex) => hex.cx - halfWidth));
  const minY = Math.min(...rawHexes.map((hex) => hex.cy - radius));

  const hexes = rawHexes.map((hex) => {
    const cx = hex.cx - minX + padding;
    const cy = hex.cy - minY + padding;
    return {
      ...hex,
      cx,
      cy,
      points: hexPoints(cx, cy, radius),
    };
  });

  const maxX = Math.max(...hexes.map((hex) => hex.cx + halfWidth));
  const maxY = Math.max(...hexes.map((hex) => hex.cy + radius));

  return {
    width: Math.ceil(maxX + padding),
    height: Math.ceil(maxY + padding),
    radius,
    hexes,
  };
}
