export type LegacyHexType = "BLANK" | "LAND" | "KEEP" | "CASTLE";

export interface LegacyHexSpec {
  index: number;
  type: LegacyHexType;
  neighbors: Array<number | null>;
}

export interface LegacyBoardSpec {
  width: number;
  height: number;
  keepIds: number[];
  castleId: number;
  hexes: LegacyHexSpec[];
}

export const LEGACY_BOARD_WIDTH = 10;
export const LEGACY_BOARD_HEIGHT = 11;
export const LEGACY_KEEP_IDS = [23, 26, 52, 58, 83, 86] as const;
export const LEGACY_CASTLE_ID = 55;
export const LEGACY_LAND_OVERRIDES = [35, 46, 75, 63, 43, 66] as const;
const LEGACY_LAND_OVERRIDE_SET: ReadonlySet<number> = new Set<number>(LEGACY_LAND_OVERRIDES);

export const LEGACY_FORTIFY_VALUE = 200;
export const LEGACY_TROOPS_TO_PROMOTE_KNIGHT = 100;
export const LEGACY_MAX_ORDERS_PER_PLAYER = 3;

export function legacyBoardIndex(x: number, y: number): number {
  return x + LEGACY_BOARD_WIDTH * y;
}

export function legacyBoardX(index: number): number {
  return index % LEGACY_BOARD_WIDTH;
}

export function legacyBoardY(index: number): number {
  return Math.floor(index / LEGACY_BOARD_WIDTH);
}

export function getLegacyHexNeighbors(index: number): Array<number | null> {
  const x = legacyBoardX(index);
  const y = legacyBoardY(index);

  const points: Array<[number, number]> = y % 2 !== 0
    ? [
        [x, y - 1],
        [x + 1, y],
        [x, y + 1],
        [x - 1, y + 1],
        [x - 1, y],
        [x - 1, y - 1],
      ]
    : [
        [x + 1, y - 1],
        [x + 1, y],
        [x + 1, y + 1],
        [x, y + 1],
        [x - 1, y],
        [x, y - 1],
      ];

  return points.map(([nx, ny]) => {
    if (nx < 0 || nx >= LEGACY_BOARD_WIDTH || ny < 0 || ny >= LEGACY_BOARD_HEIGHT) {
      return null;
    }

    return legacyBoardIndex(nx, ny);
  });
}

export function buildLegacyBoardSpec(): LegacyBoardSpec {
  const totalHexes = LEGACY_BOARD_WIDTH * LEGACY_BOARD_HEIGHT;
  const keepSet = new Set<number>(LEGACY_KEEP_IDS);

  const hexes: LegacyHexSpec[] = Array.from({ length: totalHexes }, (_, index) => ({
    index,
    type: keepSet.has(index)
      ? "KEEP"
      : index === LEGACY_CASTLE_ID
        ? "CASTLE"
        : "BLANK",
    neighbors: [],
  }));

  for (const hex of hexes) {
    const neighbors = getLegacyHexNeighbors(hex.index);
    hex.neighbors = neighbors;

    if (hex.type === "KEEP" || hex.type === "CASTLE") {
      for (const neighborIndex of neighbors) {
        if (neighborIndex === null) continue;
        const neighbor = hexes[neighborIndex];
        if (neighbor.type !== "KEEP" && neighbor.type !== "CASTLE") {
          neighbor.type = "LAND";
        }
      }
    }

    if (LEGACY_LAND_OVERRIDE_SET.has(hex.index)) {
      hex.type = "LAND";
    }
  }

  return {
    width: LEGACY_BOARD_WIDTH,
    height: LEGACY_BOARD_HEIGHT,
    keepIds: [...LEGACY_KEEP_IDS],
    castleId: LEGACY_CASTLE_ID,
    hexes,
  };
}

export function calculateLegacyBattleBonus(allianceMemberCount: number): number {
  return allianceMemberCount;
}

export function resolveLegacyBattleStep(input: {
  attackerRoll: number;
  defenderRoll: number;
  attackerBonus: number;
  defenderBonus: number;
}): "attacker" | "defender" {
  const attackerScore = input.attackerRoll + input.attackerBonus;
  const defenderScore = input.defenderRoll + input.defenderBonus;

  return defenderScore >= attackerScore ? "defender" : "attacker";
}
