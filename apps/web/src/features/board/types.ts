import type { LegacyHexType } from "@secret-toaster/domain";

export interface HexSnapshot {
  ownerUserId: string | null;
  troopCount: number | null;
  knightCount: number | null;
}

export interface PositionedHex {
  index: number;
  type: LegacyHexType;
  neighbors: Array<number | null>;
  gridX: number;
  gridY: number;
  cx: number;
  cy: number;
  points: number[];
}
