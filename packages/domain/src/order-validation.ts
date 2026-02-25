import { LEGACY_MAX_ORDERS_PER_PLAYER, LEGACY_TROOPS_TO_PROMOTE_KNIGHT } from "./parity";

export type LegacyOrderType = "move" | "fortify" | "promote" | "attack";

export interface LegacyOrderInput {
  orderNumber: number;
  type: LegacyOrderType;
  knightName: string;
  from: number;
  to: number;
  ownerNickname: string;
  troops: number;
}

export interface ValidationHexState {
  index: number;
  neighbors: Array<number | null>;
  ownerNickname: string | null;
  troopsByPlayer: Record<string, number>;
}

export interface ValidationKnightState {
  name: string;
  ownerNickname: string;
  location: number;
  alive?: boolean;
  projectedPositions?: [number, number, number];
}

export interface ValidationPlayerState {
  nickname: string;
  allianceName: string;
  knights: ValidationKnightState[];
}

export interface OrderValidationState {
  hexesByIndex: Record<number, ValidationHexState>;
  playersByNickname: Record<string, ValidationPlayerState>;
}

export type OrderValidationErrorCode =
  | "INVALID_ORDER_NUMBER"
  | "PLAYER_NOT_FOUND"
  | "KNIGHT_NOT_FOUND"
  | "KNIGHT_NOT_OWNED"
  | "KNIGHT_DEAD"
  | "HEX_NOT_FOUND"
  | "FROM_MISMATCH"
  | "NOT_NEIGHBOR"
  | "INVALID_TROOP_COUNT"
  | "INSUFFICIENT_TROOPS"
  | "FORTIFY_DESTINATION_INVALID"
  | "PROMOTE_DESTINATION_INVALID"
  | "PROMOTE_INSUFFICIENT_TROOPS"
  | "ATTACK_TARGET_NOT_ENEMY";

export interface OrderValidationFailure {
  ok: false;
  code: OrderValidationErrorCode;
  message: string;
}

export interface OrderValidationSuccess {
  ok: true;
  normalized: LegacyOrderInput;
}

export type OrderValidationResult = OrderValidationFailure | OrderValidationSuccess;

function ok(normalized: LegacyOrderInput): OrderValidationSuccess {
  return { ok: true, normalized };
}

function fail(code: OrderValidationErrorCode, message: string): OrderValidationFailure {
  return { ok: false, code, message };
}

function projectedPositionForOrder(knight: ValidationKnightState, orderNumber: number): number {
  if (orderNumber <= 1) return knight.location;
  if (!knight.projectedPositions) return knight.location;
  return knight.projectedPositions[orderNumber - 2] ?? knight.location;
}

function isNeighbor(fromHex: ValidationHexState, toIndex: number): boolean {
  return fromHex.neighbors.includes(toIndex);
}

function troopsOnHex(hex: ValidationHexState, ownerNickname: string): number {
  return hex.troopsByPlayer[ownerNickname] ?? 0;
}

export function validateLegacyOrder(
  input: LegacyOrderInput,
  state: OrderValidationState,
): OrderValidationResult {
  if (input.orderNumber < 1 || input.orderNumber > LEGACY_MAX_ORDERS_PER_PLAYER) {
    return fail("INVALID_ORDER_NUMBER", "Order number must be between 1 and 3");
  }

  const player = state.playersByNickname[input.ownerNickname];
  if (!player) {
    return fail("PLAYER_NOT_FOUND", "Order owner is not in game state");
  }

  const knight = player.knights.find((k) => k.name === input.knightName);
  if (!knight) {
    return fail("KNIGHT_NOT_FOUND", "Knight does not exist for player");
  }

  if (knight.ownerNickname !== input.ownerNickname) {
    return fail("KNIGHT_NOT_OWNED", "Knight owner does not match order owner");
  }

  if (knight.alive === false) {
    return fail("KNIGHT_DEAD", "Knight is not alive");
  }

  const fromHex = state.hexesByIndex[input.from];
  const toHex = state.hexesByIndex[input.to];
  if (!fromHex || !toHex) {
    return fail("HEX_NOT_FOUND", "Order references unknown hex index");
  }

  const expectedFrom = projectedPositionForOrder(knight, input.orderNumber);
  if (expectedFrom !== input.from) {
    return fail(
      "FROM_MISMATCH",
      `Order from hex ${input.from} does not match projected knight location ${expectedFrom}`,
    );
  }

  if (input.type === "fortify") {
    if (input.to !== input.from) {
      return fail("FORTIFY_DESTINATION_INVALID", "Fortify must target the same hex as source");
    }

    return ok(input);
  }

  if (input.type === "promote") {
    if (input.to !== input.from) {
      return fail("PROMOTE_DESTINATION_INVALID", "Promote must target the same hex as source");
    }

    if (troopsOnHex(fromHex, input.ownerNickname) < LEGACY_TROOPS_TO_PROMOTE_KNIGHT) {
      return fail("PROMOTE_INSUFFICIENT_TROOPS", "Not enough troops to promote a knight");
    }

    return ok(input);
  }

  if (!isNeighbor(fromHex, input.to)) {
    return fail("NOT_NEIGHBOR", "Move or attack destination must be a neighboring hex");
  }

  if (input.troops <= 0) {
    return fail("INVALID_TROOP_COUNT", "Move or attack troop count must be greater than zero");
  }

  if (troopsOnHex(fromHex, input.ownerNickname) < input.troops) {
    return fail("INSUFFICIENT_TROOPS", "Move or attack troop count exceeds available troops");
  }

  if (input.type === "attack") {
    if (!toHex.ownerNickname || toHex.ownerNickname === input.ownerNickname) {
      return fail("ATTACK_TARGET_NOT_ENEMY", "Attack order requires an enemy-owned destination");
    }
  }

  return ok(input);
}
