import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildLegacyBoardSpec,
  calculateLegacyBattleBonus,
  LEGACY_FORTIFY_VALUE,
  LEGACY_MAX_ORDERS_PER_PLAYER,
  LEGACY_TROOPS_TO_PROMOTE_KNIGHT,
  resolveLegacyBattleStep,
} from "../src";

interface BoardFixture {
  width: number;
  height: number;
  keepIds: number[];
  castleId: number;
  landOverrides: number[];
  typeCounts: Record<string, number>;
  landIds: number[];
  neighbors: Record<string, Array<number | null>>;
  battleRules: {
    tieGoesToDefender: boolean;
  };
  economy: {
    fortifyValue: number;
    troopsToPromoteKnight: number;
    maxOrdersPerPlayer: number;
  };
}

const fixturePath = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "fixtures",
  "board-fixture.json",
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as BoardFixture;

describe("legacy board parity", () => {
  const board = buildLegacyBoardSpec();

  it("matches expected board dimensions and fixed special ids", () => {
    expect(board.width).toBe(fixture.width);
    expect(board.height).toBe(fixture.height);
    expect(board.hexes).toHaveLength(fixture.width * fixture.height);
    expect(board.keepIds).toEqual(fixture.keepIds);
    expect(board.castleId).toBe(fixture.castleId);
  });

  it("matches legacy neighbor indexing for fixture samples", () => {
    for (const [indexText, expected] of Object.entries(fixture.neighbors)) {
      const index = Number(indexText);
      expect(board.hexes[index]?.neighbors).toEqual(expected);
    }
  });

  it("keeps keep/castle types and marks known land overrides", () => {
    for (const keepId of fixture.keepIds) {
      expect(board.hexes[keepId]?.type).toBe("KEEP");
    }

    expect(board.hexes[fixture.castleId]?.type).toBe("CASTLE");

    for (const landId of fixture.landOverrides) {
      expect(board.hexes[landId]?.type).toBe("LAND");
    }
  });

  it("matches full legacy type distribution and land id set", () => {
    const byType = board.hexes.reduce<Record<string, number>>((acc, hex) => {
      acc[hex.type] = (acc[hex.type] ?? 0) + 1;
      return acc;
    }, {});

    expect(byType).toEqual(fixture.typeCounts);

    const landIds = board.hexes.filter((hex) => hex.type === "LAND").map((hex) => hex.index);
    expect(landIds).toEqual(fixture.landIds);
  });

  it("maintains symmetric non-null neighbor relationships", () => {
    for (const hex of board.hexes) {
      for (const neighborId of hex.neighbors) {
        if (neighborId === null) continue;

        const neighbor = board.hexes[neighborId];
        expect(neighbor.neighbors).toContain(hex.index);
      }
    }
  });
});

describe("legacy battle and economy parity", () => {
  it("applies tie-to-defender battle behavior", () => {
    const tieWinner = resolveLegacyBattleStep({
      attackerRoll: 4,
      defenderRoll: 4,
      attackerBonus: 2,
      defenderBonus: 2,
    });

    expect(fixture.battleRules.tieGoesToDefender).toBe(true);
    expect(tieWinner).toBe("defender");
  });

  it("uses alliance size as battle bonus", () => {
    expect(calculateLegacyBattleBonus(1)).toBe(1);
    expect(calculateLegacyBattleBonus(3)).toBe(3);
  });

  it("captures core economy constants from legacy Java", () => {
    expect(LEGACY_FORTIFY_VALUE).toBe(fixture.economy.fortifyValue);
    expect(LEGACY_TROOPS_TO_PROMOTE_KNIGHT).toBe(fixture.economy.troopsToPromoteKnight);
    expect(LEGACY_MAX_ORDERS_PER_PLAYER).toBe(fixture.economy.maxOrdersPerPlayer);
  });
});
