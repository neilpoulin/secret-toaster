import { describe, expect, it } from "vitest";

import type { LegacyOrderInput } from "../src";
import { runLegacyRoundExecutor } from "../src";

function order(owner: string, orderNumber: number): LegacyOrderInput {
  return {
    orderNumber,
    type: "move",
    knightName: `Sir ${owner} 0`,
    from: 23,
    to: 24,
    ownerNickname: owner,
    troops: 10,
  };
}

describe("legacy round executor", () => {
  it("does not execute when not all players are ready", () => {
    const result = runLegacyRoundExecutor({
      round: 3,
      players: [
        { nickname: "Alice", ready: true, orders: [order("Alice", 1)] },
        { nickname: "Bob", ready: false, orders: [order("Bob", 1)] },
      ],
      random: () => 0,
    });

    expect(result.executed).toBe(false);
    expect(result.round).toBe(3);
    expect(result.events).toHaveLength(0);
  });

  it("issues all queued orders and advances round when all ready", () => {
    const randomValues = [0, 0.8, 0.8, 0.1];
    let randomIndex = 0;

    const result = runLegacyRoundExecutor({
      round: 7,
      players: [
        { nickname: "Alice", ready: true, orders: [order("Alice", 1), order("Alice", 2)] },
        { nickname: "Bob", ready: true, orders: [order("Bob", 1)] },
      ],
      random: () => {
        const value = randomValues[randomIndex] ?? 0;
        randomIndex += 1;
        return value;
      },
    });

    expect(result.executed).toBe(true);
    expect(result.round).toBe(8);

    const issued = result.events.filter((event) => event.kind === "order_issued");
    expect(issued).toHaveLength(3);
    expect(issued.map((event) => event.player)).toEqual(["Alice", "Bob", "Alice"]);

    const advanced = result.events.find((event) => event.kind === "round_advanced");
    expect(advanced).toEqual({ kind: "round_advanced", fromRound: 7, toRound: 8 });

    for (const player of result.players) {
      expect(player.ready).toBe(false);
      expect(player.orders).toHaveLength(0);
    }
  });
});
