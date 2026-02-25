import { calculateLegacyBattleBonus } from "./parity";

export interface LegacyBattleInput {
  attackerNickname: string;
  defenderNickname: string;
  attackerTroops: number;
  defenderTroops: number;
  attackerAllianceMembers: number;
  defenderAllianceMembers: number;
  attackerKnightsOnHex: string[];
  defenderKnightsOnHex: string[];
  rollDie?: () => number;
}

export interface LegacyBattleRound {
  attackerRoll: number;
  defenderRoll: number;
  attackerScore: number;
  defenderScore: number;
  loser: "attacker" | "defender";
  attackerTroopsAfter: number;
  defenderTroopsAfter: number;
}

export interface LegacyBattleResult {
  winnerNickname: string;
  loserNickname: string;
  attackerTroopsRemaining: number;
  defenderTroopsRemaining: number;
  attackerBonus: number;
  defenderBonus: number;
  rounds: LegacyBattleRound[];
  eliminatedKnightNames: string[];
  newOwnerNickname: string;
}

function defaultRollDie(): number {
  return 1 + Math.floor(Math.random() * 6);
}

function clampTroops(value: number): number {
  return Math.max(0, Math.floor(value));
}

export function resolveLegacyBattle(input: LegacyBattleInput): LegacyBattleResult {
  const rollDie = input.rollDie ?? defaultRollDie;

  const attackerBonus = calculateLegacyBattleBonus(input.attackerAllianceMembers);
  const defenderBonus = calculateLegacyBattleBonus(input.defenderAllianceMembers);

  let attackerTroops = clampTroops(input.attackerTroops);
  let defenderTroops = clampTroops(input.defenderTroops);

  const rounds: LegacyBattleRound[] = [];

  while (attackerTroops > 0 && defenderTroops > 0) {
    const attackerRoll = rollDie();
    const defenderRoll = rollDie();

    const attackerScore = attackerRoll + attackerBonus;
    const defenderScore = defenderRoll + defenderBonus;

    const loser = defenderScore >= attackerScore ? "attacker" : "defender";

    if (loser === "attacker") {
      attackerTroops -= 1;
    } else {
      defenderTroops -= 1;
    }

    rounds.push({
      attackerRoll,
      defenderRoll,
      attackerScore,
      defenderScore,
      loser,
      attackerTroopsAfter: attackerTroops,
      defenderTroopsAfter: defenderTroops,
    });
  }

  const attackerWon = attackerTroops > 0;

  const winnerNickname = attackerWon ? input.attackerNickname : input.defenderNickname;
  const loserNickname = attackerWon ? input.defenderNickname : input.attackerNickname;
  const eliminatedKnightNames = attackerWon
    ? [...input.defenderKnightsOnHex]
    : [...input.attackerKnightsOnHex];

  return {
    winnerNickname,
    loserNickname,
    attackerTroopsRemaining: attackerTroops,
    defenderTroopsRemaining: defenderTroops,
    attackerBonus,
    defenderBonus,
    rounds,
    eliminatedKnightNames,
    newOwnerNickname: winnerNickname,
  };
}
