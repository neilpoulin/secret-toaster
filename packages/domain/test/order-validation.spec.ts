import { describe, expect, it } from "vitest";

import type { OrderValidationState } from "../src";
import { validateLegacyOrder } from "../src";

function createState(): OrderValidationState {
  return {
    playersByNickname: {
      Alice: {
        nickname: "Alice",
        allianceName: "A",
        knights: [
          {
            name: "Sir Alice 0",
            ownerNickname: "Alice",
            location: 23,
            projectedPositions: [23, 24, 24],
            alive: true,
          },
        ],
      },
      Bob: {
        nickname: "Bob",
        allianceName: "B",
        knights: [],
      },
    },
    hexesByIndex: {
      23: {
        index: 23,
        neighbors: [14, 24, 34, 33, 22, 13],
        ownerNickname: "Alice",
        troopsByPlayer: { Alice: 150 },
      },
      24: {
        index: 24,
        neighbors: [15, 25, 35, 34, 23, 14],
        ownerNickname: "Bob",
        troopsByPlayer: { Bob: 100 },
      },
      33: {
        index: 33,
        neighbors: [23, 34, 43, 42, 32, 22],
        ownerNickname: null,
        troopsByPlayer: {},
      },
      55: {
        index: 55,
        neighbors: [45, 56, 65, 64, 54, 44],
        ownerNickname: "Bob",
        troopsByPlayer: { Bob: 50 },
      },
    },
  };
}

describe("legacy order validation", () => {
  it("accepts a valid move order", () => {
    const result = validateLegacyOrder(
      {
        orderNumber: 1,
        type: "move",
        knightName: "Sir Alice 0",
        from: 23,
        to: 24,
        ownerNickname: "Alice",
        troops: 10,
      },
      createState(),
    );

    expect(result.ok).toBe(true);
  });

  it("rejects invalid order number", () => {
    const result = validateLegacyOrder(
      {
        orderNumber: 4,
        type: "move",
        knightName: "Sir Alice 0",
        from: 23,
        to: 24,
        ownerNickname: "Alice",
        troops: 10,
      },
      createState(),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_ORDER_NUMBER");
  });

  it("rejects move with non-neighbor destination", () => {
    const result = validateLegacyOrder(
      {
        orderNumber: 1,
        type: "move",
        knightName: "Sir Alice 0",
        from: 23,
        to: 55,
        ownerNickname: "Alice",
        troops: 10,
      },
      createState(),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_NEIGHBOR");
  });

  it("rejects fortify if destination differs from source", () => {
    const result = validateLegacyOrder(
      {
        orderNumber: 1,
        type: "fortify",
        knightName: "Sir Alice 0",
        from: 23,
        to: 24,
        ownerNickname: "Alice",
        troops: 0,
      },
      createState(),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORTIFY_DESTINATION_INVALID");
  });

  it("rejects promote without enough troops", () => {
    const state = createState();
    state.hexesByIndex[23]!.troopsByPlayer.Alice = 99;

    const result = validateLegacyOrder(
      {
        orderNumber: 1,
        type: "promote",
        knightName: "Sir Alice 0",
        from: 23,
        to: 23,
        ownerNickname: "Alice",
        troops: 0,
      },
      state,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("PROMOTE_INSUFFICIENT_TROOPS");
  });

  it("rejects attack when destination is not enemy-owned", () => {
    const state = createState();
    state.hexesByIndex[24]!.ownerNickname = "Alice";

    const result = validateLegacyOrder(
      {
        orderNumber: 1,
        type: "attack",
        knightName: "Sir Alice 0",
        from: 23,
        to: 24,
        ownerNickname: "Alice",
        troops: 10,
      },
      state,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("ATTACK_TARGET_NOT_ENEMY");
  });

  it("rejects order when from does not match projected location", () => {
    const result = validateLegacyOrder(
      {
        orderNumber: 2,
        type: "move",
        knightName: "Sir Alice 0",
        from: 24,
        to: 24,
        ownerNickname: "Alice",
        troops: 10,
      },
      createState(),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FROM_MISMATCH");
  });
});
