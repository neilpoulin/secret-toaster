import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";

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

function shortId(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
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
          .select("id, game_code, title, status, round, created_at")
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
    </main>
  );
}
