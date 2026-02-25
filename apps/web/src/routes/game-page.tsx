import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { buildLegacyBoardSpec, legacyBoardX, legacyBoardY, type LegacyHexSpec } from "@secret-toaster/domain";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { type ActiveGame, getStoredActiveGame, setStoredActiveGame } from "@/lib/active-game";
import { supabase } from "@/lib/supabase";

interface CreateInviteResponse {
  ok: boolean;
  gameId: string;
  inviteToken: string;
  expiresAt: string;
}

interface ApplyCommandResponse {
  ok: boolean;
  accepted: boolean;
  eventId: number;
  createdAt: string;
}

interface GameEventRecord {
  id: number;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

interface GameDetailsRecord {
  id: string;
  game_code: string;
  title: string | null;
  status: string;
  round: number;
   current_state: Record<string, unknown>;
  created_at: string;
}

interface GameMembershipRecord {
  id: string;
  user_id: string;
  role: string;
  is_active: boolean;
  joined_at: string;
}

interface PlayerReadinessRecord {
  id: string;
  user_id: string;
  round: number;
  is_ready: boolean;
  updated_at: string;
}

interface CommandReplayEntry {
  sourceEventId: number;
  round: number;
  executionIndex: number;
  playerUserId: string;
  commandType: string;
  commandPayload: Record<string, unknown>;
  createdAt: string;
}

interface HexSnapshot {
  ownerUserId: string | null;
  troopCount: number | null;
  knightCount: number | null;
}

const LEGACY_BOARD = buildLegacyBoardSpec();
const LEGACY_BOARD_ROWS = Array.from({ length: LEGACY_BOARD.height }, (_, y) =>
  LEGACY_BOARD.hexes.slice(y * LEGACY_BOARD.width, (y + 1) * LEGACY_BOARD.width),
);
const HEXAGON_SHAPE_STYLE = {
  clipPath: "polygon(25% 6%, 75% 6%, 100% 50%, 75% 94%, 25% 94%, 0% 50%)",
};

function shortId(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : null;
  }
  return null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function getHexSnapshot(currentState: Record<string, unknown>, hexIndex: number): HexSnapshot | null {
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

function getHexToneClasses(hex: LegacyHexSpec): string {
  if (hex.type === "CASTLE") return "bg-amber-200/90 border-amber-600 text-amber-950";
  if (hex.type === "KEEP") return "bg-sky-200/90 border-sky-600 text-sky-950";
  if (hex.type === "LAND") return "bg-emerald-100/90 border-emerald-500 text-emerald-950";
  return "bg-muted/70 border-border text-muted-foreground";
}

function formatPayloadInline(payload: Record<string, unknown>): string {
  const raw = JSON.stringify(payload);
  if (raw.length <= 120) return raw;
  return `${raw.slice(0, 117)}...`;
}

function getCommandReplayEntries(events: GameEventRecord[]): CommandReplayEntry[] {
  return events
    .filter((event) => event.event_type === "command.executed")
    .map((event) => {
      const round = asNumber(event.payload.round);
      const executionIndex = asNumber(event.payload.executionIndex);
      const sourceEventId = asNumber(event.payload.sourceEventId);
      const playerUserId = asText(event.payload.playerUserId);
      const commandType = asText(event.payload.commandType);
      const commandPayload = asRecord(event.payload.payload) ?? {};

      if (
        round === null ||
        executionIndex === null ||
        sourceEventId === null ||
        !playerUserId ||
        !commandType
      ) {
        return null;
      }

      return {
        sourceEventId,
        round,
        executionIndex,
        playerUserId,
        commandType,
        commandPayload,
        createdAt: event.created_at,
      };
    })
    .filter((entry): entry is CommandReplayEntry => entry !== null);
}

export function GamePage() {
  const { gameId } = useParams({ from: "/games/$gameId" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const storedActiveGame = getStoredActiveGame();
  const initialGameCode = storedActiveGame?.gameId === gameId ? storedActiveGame.gameCode : undefined;
  const initialSource = storedActiveGame?.gameId === gameId ? storedActiveGame.source : "joined";

  const [activeGameCode, setActiveGameCode] = useState<string | undefined>(initialGameCode);
  const [activeGameSource] = useState<ActiveGame["source"]>(initialSource);

  const activeGame: ActiveGame = {
    gameId,
    gameCode: activeGameCode,
    source: activeGameSource,
  };
  const [inviteEmail, setInviteEmail] = useState("");
  const [generatedInvite, setGeneratedInvite] = useState<CreateInviteResponse | null>(null);
  const [commandType, setCommandType] = useState("order.submit");
  const [commandPayloadText, setCommandPayloadText] = useState('{"orderNumber":1}');
  const [lastCommandAck, setLastCommandAck] = useState<ApplyCommandResponse | null>(null);
  const [gameEvents, setGameEvents] = useState<GameEventRecord[]>([]);
  const [gameEventsError, setGameEventsError] = useState<string | null>(null);
  const [selectedHexId, setSelectedHexId] = useState<number>(LEGACY_BOARD.castleId);

  const authQuery = useQuery({
    queryKey: ["auth", "user"],
    queryFn: async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      return data.session?.user ?? null;
    },
  });

  const gameDetailsQuery = useQuery({
    queryKey: ["game", "details", activeGame.gameId],
    enabled: Boolean(activeGame.gameId && authQuery.data),
    refetchInterval: authQuery.data ? 5000 : false,
    queryFn: async (): Promise<{
      game: GameDetailsRecord;
      memberships: GameMembershipRecord[];
      readiness: PlayerReadinessRecord[];
    }> => {
      const [{ data: game, error: gameError }, { data: memberships, error: membershipsError }] = await Promise.all([
        supabase
          .schema("secret_toaster")
          .from("games")
          .select("id, game_code, title, status, round, current_state, created_at")
          .eq("id", activeGame.gameId)
          .single(),
        supabase
          .schema("secret_toaster")
          .from("game_memberships")
          .select("id, user_id, role, is_active, joined_at")
          .eq("game_id", activeGame.gameId)
          .order("joined_at", { ascending: true }),
      ]);

      if (gameError || !game) {
        throw new Error(gameError?.message ?? "Failed to load game metadata");
      }

      if (membershipsError || !memberships) {
        throw new Error(membershipsError?.message ?? "Failed to load game memberships");
      }

      const { data: readiness, error: readinessError } = await supabase
        .schema("secret_toaster")
        .from("player_readiness")
        .select("id, user_id, round, is_ready, updated_at")
        .eq("game_id", activeGame.gameId)
        .eq("round", game.round)
        .order("updated_at", { ascending: false });

      if (readinessError || !readiness) {
        throw new Error(readinessError?.message ?? "Failed to load readiness state");
      }

      return {
        game: game as GameDetailsRecord,
        memberships: memberships as GameMembershipRecord[],
        readiness: readiness as PlayerReadinessRecord[],
      };
    },
  });

  const createInviteMutation = useMutation({
    mutationFn: async (): Promise<CreateInviteResponse> => {
      const { data, error } = await supabase.functions.invoke("secret-toaster-create-invite", {
        body: {
          gameId: activeGame.gameId,
          invitedEmail: inviteEmail.trim() || undefined,
          expiresInHours: 72,
        },
      });

      if (error) throw error;

      const payload = data as CreateInviteResponse | null;
      if (!payload || !payload.ok || !payload.inviteToken) {
        throw new Error("Create invite failed");
      }

      return payload;
    },
    onSuccess: (payload) => {
      setGeneratedInvite(payload);
    },
  });

  const setReadyMutation = useMutation({
    mutationFn: async (isReady: boolean) => {
      const { data, error } = await supabase.functions.invoke("secret-toaster-set-ready", {
        body: {
          gameId: activeGame.gameId,
          isReady,
        },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["game", "details", activeGame.gameId] });
      void queryClient.invalidateQueries({ queryKey: ["game", "events", activeGame.gameId] });
    },
  });

  const applyCommandMutation = useMutation({
    mutationFn: async (): Promise<ApplyCommandResponse> => {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(commandPayloadText) as Record<string, unknown>;
      } catch {
        throw new Error("Command payload must be valid JSON");
      }

      const trimmedCommandType = commandType.trim();
      if (!trimmedCommandType) throw new Error("Command type is required");

      const { data, error } = await supabase.functions.invoke("secret-toaster-apply-command", {
        body: {
          gameId: activeGame.gameId,
          commandType: trimmedCommandType,
          payload,
        },
      });

      if (error) throw error;

      const response = data as ApplyCommandResponse | null;
      if (!response || !response.ok || !response.accepted) {
        throw new Error("Command was not accepted");
      }

      return response;
    },
    onSuccess: (response) => {
      setLastCommandAck(response);
    },
  });

  useEffect(() => {
    setStoredActiveGame({
      gameId,
      gameCode: activeGameCode,
      source: activeGameSource,
    });
  }, [activeGameCode, activeGameSource, gameId]);

  useEffect(() => {
    if (!activeGame.gameId || !authQuery.data) return;

    void (async () => {
      const { data, error } = await supabase
        .schema("secret_toaster")
        .from("games")
        .select("game_code")
        .eq("id", activeGame.gameId)
        .maybeSingle();

      if (!error && data?.game_code) {
        setActiveGameCode((previous) => (previous === data.game_code ? previous : data.game_code));
      }

      const { data: events, error: eventsError } = await supabase
        .schema("secret_toaster")
        .from("game_events")
        .select("id, event_type, payload, created_at")
        .eq("game_id", activeGame.gameId)
        .order("created_at", { ascending: false })
        .limit(20);

      if (!eventsError && events) {
        setGameEvents(events as GameEventRecord[]);
        setGameEventsError(null);
      } else if (eventsError) {
        setGameEventsError(eventsError.message);
      }
    })();

    const eventChannel = supabase
      .channel(`game-events-${activeGame.gameId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "secret_toaster",
          table: "game_events",
          filter: `game_id=eq.${activeGame.gameId}`,
        },
        (payload) => {
          const next = payload.new as GameEventRecord;
          setGameEvents((previous) => [next, ...previous].slice(0, 20));
        },
      )
      .subscribe();

    const lobbyChannel = supabase
      .channel(`game-lobby-${activeGame.gameId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "secret_toaster",
          table: "games",
          filter: `id=eq.${activeGame.gameId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["game", "details", activeGame.gameId] });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "secret_toaster",
          table: "game_memberships",
          filter: `game_id=eq.${activeGame.gameId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["game", "details", activeGame.gameId] });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "secret_toaster",
          table: "player_readiness",
          filter: `game_id=eq.${activeGame.gameId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["game", "details", activeGame.gameId] });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(eventChannel);
      void supabase.removeChannel(lobbyChannel);
    };
  }, [activeGame.gameId, authQuery.data, queryClient]);

  const currentUserReadiness = gameDetailsQuery.data?.readiness.find(
    (entry) => entry.user_id === authQuery.data?.id,
  );
  const readyMemberIds = new Set(
    gameDetailsQuery.data?.readiness.filter((entry) => entry.is_ready).map((entry) => entry.user_id) ?? [],
  );
  const activeMembersCount = gameDetailsQuery.data?.memberships.filter((member) => member.is_active).length ?? 0;
  const readyCount = readyMemberIds.size;
  const allReady = activeMembersCount > 0 && readyCount >= activeMembersCount;

  const inviteLink = generatedInvite
    ? `${window.location.origin}/?inviteToken=${encodeURIComponent(generatedInvite.inviteToken)}`
    : "";

  const commandReplayEntries = getCommandReplayEntries(gameEvents);
  const replayRounds = [...new Set(commandReplayEntries.map((entry) => entry.round))].sort((left, right) => right - left);
  const latestExecutedRound = replayRounds[0] ?? null;
  const latestRoundReplay =
    latestExecutedRound === null
      ? []
      : commandReplayEntries
          .filter((entry) => entry.round === latestExecutedRound)
          .sort((left, right) => left.executionIndex - right.executionIndex);
  const currentState = gameDetailsQuery.data?.game.current_state ?? {};
  const selectedHex = LEGACY_BOARD.hexes[selectedHexId] ?? null;
  const selectedHexSnapshot = selectedHex ? getHexSnapshot(currentState, selectedHex.index) : null;

  const copyInviteLink = async () => {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
  };

  if (!authQuery.data && !authQuery.isLoading) {
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-4 md:p-8">
        <Card>
          <CardHeader>
            <CardTitle>Sign in required</CardTitle>
            <CardDescription>Go back to the homepage and sign in first.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link to="/">Back to Home</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4 md:p-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Game Workspace</h1>
          <p className="text-muted-foreground">Game {activeGame.gameCode ?? shortId(activeGame.gameId)}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" asChild>
            <Link to="/">Back to Home</Link>
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setStoredActiveGame(null);
              void navigate({ to: "/" });
            }}
          >
            Leave Workspace
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Lobby</CardTitle>
          <CardDescription>Metadata, members, and readiness for the active round.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {gameDetailsQuery.isLoading ? <p>Loading game details...</p> : null}
          {gameDetailsQuery.isError ? <p>Lobby load error: {gameDetailsQuery.error.message}</p> : null}
          {gameDetailsQuery.data ? (
            <>
              <p>
                Status: <strong>{gameDetailsQuery.data.game.status}</strong>
              </p>
              <p>
                Round: <strong>{gameDetailsQuery.data.game.round}</strong>
              </p>
              <p>
                Created: {new Date(gameDetailsQuery.data.game.created_at).toLocaleString()}
              </p>
              <p>
                Ready: <strong>{readyCount}</strong> / {activeMembersCount}
                {allReady ? " (all ready)" : ""}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={currentUserReadiness?.is_ready ? "secondary" : "default"}
                  disabled={setReadyMutation.isPending}
                  onClick={() => setReadyMutation.mutate(!(currentUserReadiness?.is_ready ?? false))}
                >
                  {setReadyMutation.isPending
                    ? "Updating..."
                    : currentUserReadiness?.is_ready
                      ? "Set Not Ready"
                      : "Set Ready"}
                </Button>
              </div>
              {setReadyMutation.isError ? <p>Ready error: {setReadyMutation.error.message}</p> : null}
              <ul>
                {gameDetailsQuery.data.memberships.map((member) => (
                  <li key={member.id}>
                    {shortId(member.user_id)}
                    {member.user_id === authQuery.data?.id ? " (you)" : ""} - {member.role}
                    {member.is_active ? "" : " (inactive)"}
                    {readyMemberIds.has(member.user_id) ? " - ready" : " - not ready"}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Game Board</CardTitle>
          <CardDescription>Legacy board layout with keeps, castle, and current-state overlays.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded border border-emerald-500 bg-emerald-100 px-2 py-1">Land</span>
            <span className="rounded border border-sky-600 bg-sky-200 px-2 py-1">Keep</span>
            <span className="rounded border border-amber-600 bg-amber-200 px-2 py-1">Castle</span>
            <span className="rounded border bg-muted px-2 py-1">Blank</span>
          </div>

          <div className="overflow-x-auto rounded-lg border bg-muted/20 p-3">
            <div className="inline-flex flex-col gap-1.5 pb-2 pr-3">
              {LEGACY_BOARD_ROWS.map((row, rowIndex) => (
                <div
                  key={rowIndex}
                  className="flex gap-1.5"
                  style={{ marginLeft: rowIndex % 2 === 0 ? 0 : 28 }}
                >
                  {row.map((hex) => {
                    const snapshot = getHexSnapshot(currentState, hex.index);
                    const isSelected = selectedHexId === hex.index;
                    return (
                      <button
                        key={hex.index}
                        type="button"
                        onClick={() => setSelectedHexId(hex.index)}
                        className={`h-16 w-14 cursor-pointer border text-[10px] leading-tight transition hover:brightness-95 ${getHexToneClasses(hex)} ${isSelected ? "ring-2 ring-primary" : ""}`}
                        style={HEXAGON_SHAPE_STYLE}
                        title={`Hex ${hex.index} (${legacyBoardX(hex.index)}, ${legacyBoardY(hex.index)})`}
                      >
                        <div className="font-semibold">#{hex.index}</div>
                        <div>{hex.type === "CASTLE" ? "C" : hex.type === "KEEP" ? "K" : ""}</div>
                        {snapshot && snapshot.troopCount !== null ? <div>T {snapshot.troopCount}</div> : null}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {selectedHex ? (
            <div className="rounded-md border bg-card p-3 text-sm">
              <p>
                Selected hex <strong>#{selectedHex.index}</strong> ({legacyBoardX(selectedHex.index)},{" "}
                {legacyBoardY(selectedHex.index)}) - {selectedHex.type}
              </p>
              <p>
                Troops: <strong>{selectedHexSnapshot?.troopCount ?? 0}</strong> | Knights:{" "}
                <strong>{selectedHexSnapshot?.knightCount ?? 0}</strong>
              </p>
              <p>
                Owner: <strong>{selectedHexSnapshot?.ownerUserId ? shortId(selectedHexSnapshot.ownerUserId) : "none"}</strong>
              </p>
              <p>
                Neighbors:{" "}
                <strong>
                  {selectedHex.neighbors
                    .filter((neighbor): neighbor is number => neighbor !== null)
                    .join(", ") || "none"}
                </strong>
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invite Link</CardTitle>
          <CardDescription>Create and share tokenized invite links.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              createInviteMutation.mutate();
            }}
          >
            <Label htmlFor="invite-email">Invite email (optional)</Label>
            <Input
              id="invite-email"
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="friend@example.com"
            />
            <Button type="submit" disabled={createInviteMutation.isPending}>
              {createInviteMutation.isPending ? "Creating invite..." : "Create invite token"}
            </Button>
          </form>

          {createInviteMutation.isError ? <p>Invite error: {createInviteMutation.error.message}</p> : null}

          {generatedInvite ? (
            <>
              <p>
                Invite token: <code>{generatedInvite.inviteToken}</code>
              </p>
              <p>Expires: {new Date(generatedInvite.expiresAt).toLocaleString()}</p>
              <p>
                Invite link: <code>{inviteLink}</code>
              </p>
              <Button type="button" variant="secondary" onClick={() => void copyInviteLink()}>
                Copy invite link
              </Button>
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Command Submit</CardTitle>
          <CardDescription>Send command payloads to the authoritative apply-command endpoint.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              applyCommandMutation.mutate();
            }}
          >
            <Label htmlFor="command-type">Command type</Label>
            <Input
              id="command-type"
              type="text"
              value={commandType}
              onChange={(event) => setCommandType(event.target.value)}
              placeholder="order.submit"
            />
            <Label htmlFor="command-payload">Payload (JSON)</Label>
            <Textarea
              id="command-payload"
              value={commandPayloadText}
              onChange={(event) => setCommandPayloadText(event.target.value)}
              rows={4}
            />
            <Button type="submit" disabled={applyCommandMutation.isPending}>
              {applyCommandMutation.isPending ? "Submitting..." : "Submit command"}
            </Button>
          </form>
          {applyCommandMutation.isError ? <p>Command error: {applyCommandMutation.error.message}</p> : null}
          {lastCommandAck ? (
            <p>
              Last command accepted at {new Date(lastCommandAck.createdAt).toLocaleTimeString()} (event #
              {lastCommandAck.eventId})
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Game Events</CardTitle>
          <CardDescription>Live feed of game events for this workspace.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {gameEventsError ? <p>Event load error: {gameEventsError}</p> : null}
          {gameEvents.length === 0 ? (
            <p>No realtime events yet.</p>
          ) : (
            <ul>
              {gameEvents.map((event) => (
                <li key={event.id}>
                  {event.event_type} at {new Date(event.created_at).toLocaleTimeString()}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Round Replay Helper</CardTitle>
          <CardDescription>
            Deterministic command execution order for the most recently executed round.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {latestExecutedRound === null ? <p>No executed rounds yet.</p> : null}
          {latestExecutedRound !== null ? (
            <>
              <p>
                Latest executed round: <strong>{latestExecutedRound}</strong>
              </p>
              <p>
                Recent executed rounds: <strong>{replayRounds.join(", ")}</strong>
              </p>
              {latestRoundReplay.length === 0 ? (
                <p>No command execution entries found for this round.</p>
              ) : (
                <ol>
                  {latestRoundReplay.map((entry) => (
                    <li key={entry.sourceEventId}>
                      #{entry.executionIndex + 1} - {entry.commandType} by {shortId(entry.playerUserId)} at{" "}
                      {new Date(entry.createdAt).toLocaleTimeString()} (source event #{entry.sourceEventId}) - payload:{" "}
                      <code>{formatPayloadInline(entry.commandPayload)}</code>
                    </li>
                  ))}
                </ol>
              )}
            </>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
