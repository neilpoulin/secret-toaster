export type GameStatus = "lobby" | "active" | "completed" | "archived";

export interface GameSummary {
  id: string;
  code: string;
  status: GameStatus;
  round: number;
}

export { validateLegacyOrder } from "./order-validation";
export { resolveLegacyBattle } from "./battle-resolver";
export { runLegacyRoundExecutor } from "./round-executor";
export type {
  LegacyOrderInput,
  LegacyOrderType,
  OrderValidationResult,
  ValidationHexState,
  ValidationKnightState,
  ValidationPlayerState,
  OrderValidationState,
} from "./order-validation";
export type { LegacyBattleInput, LegacyBattleResult, LegacyBattleRound } from "./battle-resolver";
export type { RoundExecutorInput, RoundExecutorResult, RoundPlayerState, RoundEvent } from "./round-executor";

export {
  buildLegacyBoardSpec,
  calculateLegacyBattleBonus,
  getLegacyHexNeighbors,
  LEGACY_BOARD_HEIGHT,
  LEGACY_BOARD_WIDTH,
  LEGACY_CASTLE_ID,
  LEGACY_FORTIFY_VALUE,
  LEGACY_KEEP_IDS,
  LEGACY_LAND_OVERRIDES,
  LEGACY_MAX_ORDERS_PER_PLAYER,
  LEGACY_TROOPS_TO_PROMOTE_KNIGHT,
  legacyBoardIndex,
  legacyBoardX,
  legacyBoardY,
  resolveLegacyBattleStep,
} from "./parity";
export type { LegacyBoardSpec, LegacyHexSpec, LegacyHexType } from "./parity";
