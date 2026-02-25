import { legacyBoardX, legacyBoardY, type LegacyBoardSpec } from "@secret-toaster/domain";

import type { PositionedHex } from "./types";

const SQRT_3 = Math.sqrt(3);

function hexPoints(cx: number, cy: number, radius: number): number[] {
  const halfHeight = (SQRT_3 / 2) * radius;
  return [
    cx - radius,
    cy,
    cx - radius / 2,
    cy - halfHeight,
    cx + radius / 2,
    cy - halfHeight,
    cx + radius,
    cy,
    cx + radius / 2,
    cy + halfHeight,
    cx - radius / 2,
    cy + halfHeight,
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
  const halfHeight = (SQRT_3 / 2) * radius;
  const columnStep = radius * 1.5;
  const rowStep = halfHeight;

  const hexes: PositionedHex[] = boardSpec.hexes.map((hex) => {
    const gridX = legacyBoardX(hex.index);
    const gridY = legacyBoardY(hex.index);
    const rowOffset = gridY % 2 === 0 ? 0 : columnStep / 2;
    const cx = padding + radius + gridX * columnStep + rowOffset;
    const cy = padding + halfHeight + gridY * rowStep;

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

  const maxX = Math.max(...hexes.map((hex) => hex.cx + radius));
  const maxY = Math.max(...hexes.map((hex) => hex.cy + halfHeight));

  return {
    width: Math.ceil(maxX + padding),
    height: Math.ceil(maxY + padding),
    radius,
    hexes,
  };
}
