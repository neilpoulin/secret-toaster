import type { HexSnapshot } from "./types";

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : null;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function getHexSnapshot(currentState: Record<string, unknown>, hexIndex: number): HexSnapshot | null {
  const hexKey = String(hexIndex);
  const directHexMaps = [
    asRecord(currentState.hexes),
    asRecord(currentState.cells),
    asRecord(asRecord(currentState.board)?.hexes),
  ];

  for (const mapValue of directHexMaps) {
    if (!mapValue) continue;
    const hexData = asRecord(mapValue[hexKey]);
    if (!hexData) continue;

    const ownerUserId =
      asText(hexData.ownerUserId) ?? asText(hexData.owner_id) ?? asText(hexData.owner) ?? asText(hexData.playerId) ?? null;
    const troopCount = asCount(hexData.troopCount) ?? asCount(hexData.troops);
    const knightCount = asCount(hexData.knightCount) ?? asCount(hexData.knights);

    if (ownerUserId || troopCount !== null || knightCount !== null) {
      return { ownerUserId, troopCount, knightCount };
    }
  }

  const ownerMaps = [asRecord(currentState.hexOwners), asRecord(currentState.owners)];
  const troopMaps = [asRecord(currentState.hexTroops), asRecord(currentState.troopsByHex)];
  const knightMaps = [asRecord(currentState.hexKnights), asRecord(currentState.knightsByHex)];

  const ownerUserId = ownerMaps.map((map) => (map ? asText(map[hexKey]) : null)).find((value) => value !== null) ?? null;
  const troopCount = troopMaps.map((map) => (map ? asCount(map[hexKey]) : null)).find((value) => value !== null) ?? null;
  const knightCount =
    knightMaps.map((map) => (map ? asCount(map[hexKey]) : null)).find((value) => value !== null) ?? null;

  if (!ownerUserId && troopCount === null && knightCount === null) return null;
  return { ownerUserId, troopCount, knightCount };
}
