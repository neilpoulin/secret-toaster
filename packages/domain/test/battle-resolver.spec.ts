import { describe, expect, it } from "vitest";

import { resolveLegacyBattle } from "../src";

function sequenceRolls(values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index] ?? 1;
    index += 1;
    return value;
  };
}

describe("legacy battle resolver", () => {
  it("applies tie-to-defender rule", () => {
    const result = resolveLegacyBattle({
      attackerNickname: "Alice",
      defenderNickname: "Bob",
      attackerTroops: 1,
      defenderTroops: 1,
      attackerAllianceMembers: 1,
      defenderAllianceMembers: 1,
      attackerKnightsOnHex: ["Sir Alice 0"],
      defenderKnightsOnHex: ["Sir Bob 0"],
      rollDie: sequenceRolls([3, 3]),
    });

    expect(result.winnerNickname).toBe("Bob");
    expect(result.loserNickname).toBe("Alice");
    expect(result.attackerTroopsRemaining).toBe(0);
    expect(result.defenderTroopsRemaining).toBe(1);
    expect(result.rounds).toHaveLength(1);
    expect(result.rounds[0]?.loser).toBe("attacker");
    expect(result.eliminatedKnightNames).toEqual(["Sir Alice 0"]);
  });

  it("uses alliance size as score bonus", () => {
    const result = resolveLegacyBattle({
      attackerNickname: "Alice",
      defenderNickname: "Bob",
      attackerTroops: 1,
      defenderTroops: 1,
      attackerAllianceMembers: 3,
      defenderAllianceMembers: 1,
      attackerKnightsOnHex: ["Sir Alice 0"],
      defenderKnightsOnHex: ["Sir Bob 0"],
      rollDie: sequenceRolls([1, 2]),
    });

    expect(result.attackerBonus).toBe(3);
    expect(result.defenderBonus).toBe(1);
    expect(result.rounds[0]?.attackerScore).toBe(4);
    expect(result.rounds[0]?.defenderScore).toBe(3);
    expect(result.winnerNickname).toBe("Alice");
  });

  it("eliminates all loser knights on the contested hex", () => {
    const result = resolveLegacyBattle({
      attackerNickname: "Alice",
      defenderNickname: "Bob",
      attackerTroops: 3,
      defenderTroops: 2,
      attackerAllianceMembers: 2,
      defenderAllianceMembers: 1,
      attackerKnightsOnHex: ["Sir Alice 0"],
      defenderKnightsOnHex: ["Sir Bob 0", "Sir Bob 1"],
      rollDie: sequenceRolls([6, 1, 5, 1]),
    });

    expect(result.winnerNickname).toBe("Alice");
    expect(result.defenderTroopsRemaining).toBe(0);
    expect(result.eliminatedKnightNames).toEqual(["Sir Bob 0", "Sir Bob 1"]);
    expect(result.newOwnerNickname).toBe("Alice");
  });
});
