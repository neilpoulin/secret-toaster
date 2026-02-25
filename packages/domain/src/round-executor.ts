import type { LegacyOrderInput } from "./order-validation";

export interface RoundPlayerState {
  nickname: string;
  ready: boolean;
  orders: LegacyOrderInput[];
}

export interface RoundExecutorInput {
  round: number;
  players: RoundPlayerState[];
  random?: () => number;
}

export interface IssuedOrderEvent {
  kind: "order_issued";
  round: number;
  player: string;
  order: LegacyOrderInput;
}

export interface RoundAdvancedEvent {
  kind: "round_advanced";
  fromRound: number;
  toRound: number;
}

export type RoundEvent = IssuedOrderEvent | RoundAdvancedEvent;

export interface RoundExecutorResult {
  executed: boolean;
  round: number;
  players: RoundPlayerState[];
  events: RoundEvent[];
}

function defaultRandom(): number {
  return Math.random();
}

function clonePlayers(players: RoundPlayerState[]): RoundPlayerState[] {
  return players.map((player) => ({
    ...player,
    orders: [...player.orders],
  }));
}

export function runLegacyRoundExecutor(input: RoundExecutorInput): RoundExecutorResult {
  const random = input.random ?? defaultRandom;
  const players = clonePlayers(input.players);
  const events: RoundEvent[] = [];

  const allReady = players.every((player) => player.ready);
  if (!allReady) {
    return {
      executed: false,
      round: input.round,
      players,
      events,
    };
  }

  const hasPendingOrders = () => players.some((player) => player.orders.length > 0);

  while (hasPendingOrders()) {
    const index = Math.floor(random() * players.length);
    const player = players[index];

    if (!player || player.orders.length === 0) {
      continue;
    }

    const order = player.orders.shift();
    if (!order) continue;

    events.push({
      kind: "order_issued",
      round: input.round,
      player: player.nickname,
      order,
    });
  }

  for (const player of players) {
    player.ready = false;
  }

  const nextRound = input.round + 1;
  events.push({
    kind: "round_advanced",
    fromRound: input.round,
    toRound: nextRound,
  });

  return {
    executed: true,
    round: nextRound,
    players,
    events,
  };
}
