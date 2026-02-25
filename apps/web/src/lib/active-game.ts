export interface ActiveGame {
  gameId: string;
  gameCode?: string;
  source: "created" | "joined";
}

const ACTIVE_GAME_STORAGE_KEY = "secret-toaster.active-game";

export function getActiveGameStorageKey(): string {
  return ACTIVE_GAME_STORAGE_KEY;
}

export function getStoredActiveGame(): ActiveGame | null {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(ACTIVE_GAME_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as ActiveGame;
    if (!parsed.gameId || (parsed.source !== "created" && parsed.source !== "joined")) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function setStoredActiveGame(activeGame: ActiveGame | null): void {
  if (typeof window === "undefined") return;

  if (!activeGame) {
    window.localStorage.removeItem(ACTIVE_GAME_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(ACTIVE_GAME_STORAGE_KEY, JSON.stringify(activeGame));
}
