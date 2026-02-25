import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "../lib/supabase";

interface CreateGameResponse {
  ok: boolean;
  gameId: string;
  gameCode: string;
  title: string | null;
}

interface JoinGameResponse {
  ok: boolean;
  gameId: string;
  gameCode?: string | null;
}

interface CreateInviteResponse {
  ok: boolean;
  gameId: string;
  inviteToken: string;
  expiresAt: string;
}

interface ActiveGame {
  gameId: string;
  gameCode?: string;
  source: "created" | "joined";
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

const ACTIVE_GAME_STORAGE_KEY = "secret-toaster.active-game";

function getInitialInviteToken(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("inviteToken") ?? "";
}

function getInitialActiveGame(): ActiveGame | null {
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

function shortId(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function HomePage() {
  const initialInviteToken = getInitialInviteToken();
  const [email, setEmail] = useState("");
  const [gameTitle, setGameTitle] = useState("");
  const [gamePassword, setGamePassword] = useState("");
  const [joinGameCode, setJoinGameCode] = useState("");
  const [joinPassword, setJoinPassword] = useState("");
  const [inviteToken, setInviteToken] = useState(initialInviteToken);
  const [inviteEmail, setInviteEmail] = useState("");
  const [generatedInvite, setGeneratedInvite] = useState<CreateInviteResponse | null>(null);
  const [activeGame, setActiveGame] = useState<ActiveGame | null>(() => getInitialActiveGame());
  const [gameEvents, setGameEvents] = useState<GameEventRecord[]>([]);
  const [gameEventsError, setGameEventsError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const authQuery = useQuery({
    queryKey: ["auth", "user"],
    queryFn: async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      return data.session?.user ?? null;
    },
  });

  const gameDetailsQuery = useQuery({
    queryKey: ["game", "details", activeGame?.gameId],
    enabled: Boolean(activeGame?.gameId && authQuery.data),
    queryFn: async (): Promise<{
      game: GameDetailsRecord;
      memberships: GameMembershipRecord[];
      readiness: PlayerReadinessRecord[];
    }> => {
      const gameId = activeGame?.gameId;
      if (!gameId) throw new Error("No active game selected");

      const [{ data: game, error: gameError }, { data: memberships, error: membershipsError }] = await Promise.all([
        supabase
          .schema("secret_toaster")
          .from("games")
          .select("id, game_code, title, status, round, created_at")
          .eq("id", gameId)
          .single(),
        supabase
          .schema("secret_toaster")
          .from("game_memberships")
          .select("id, user_id, role, is_active, joined_at")
          .eq("game_id", gameId)
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
        .eq("game_id", gameId)
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

  const setReadyMutation = useMutation({
    mutationFn: async (isReady: boolean) => {
      if (!activeGame?.gameId) throw new Error("No active game selected");

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
      void queryClient.invalidateQueries({ queryKey: ["game", "details", activeGame?.gameId] });
      void queryClient.invalidateQueries({ queryKey: ["game", "events", activeGame?.gameId] });
    },
  });

  const signInMutation = useMutation({
    mutationFn: async (value: string) => {
      const { error } = await supabase.auth.signInWithOtp({
        email: value,
        options: {
          emailRedirectTo: window.location.origin,
        },
      });

      if (error) throw error;
    },
  });

  const signOutMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["auth", "user"] });
    },
  });

  const createGameMutation = useMutation({
    mutationFn: async (): Promise<CreateGameResponse> => {
      const { data, error } = await supabase.functions.invoke("secret-toaster-create-game", {
        body: {
          title: gameTitle.trim() || undefined,
          password: gamePassword.trim() || undefined,
        },
      });

      if (error) throw error;

      const payload = data as CreateGameResponse | null;
      if (!payload || !payload.ok) throw new Error("Create game failed");
      return payload;
    },
    onSuccess: (payload) => {
      setActiveGame({
        gameId: payload.gameId,
        gameCode: payload.gameCode,
        source: "created",
      });
      setGameEvents([]);
      setGameEventsError(null);
      setGamePassword("");
    },
  });

  const joinByCodeMutation = useMutation({
    mutationFn: async (): Promise<JoinGameResponse> => {
      const normalizedGameCode = joinGameCode.trim().toUpperCase();
      const normalizedPassword = joinPassword.trim();

      if (!normalizedGameCode || !normalizedPassword) {
        throw new Error("Game code and password are required");
      }

      const { data, error } = await supabase.functions.invoke("secret-toaster-join-game", {
        body: {
          gameCode: normalizedGameCode,
          password: normalizedPassword,
        },
      });

      if (error) throw error;

      const payload = data as JoinGameResponse | null;
      if (!payload || !payload.ok || !payload.gameId) {
        throw new Error("Join game failed");
      }

      return payload;
    },
    onSuccess: (payload) => {
      setActiveGame({
        gameId: payload.gameId,
        gameCode: payload.gameCode ?? joinGameCode.trim().toUpperCase(),
        source: "joined",
      });
      setGameEvents([]);
      setGameEventsError(null);
    },
  });

  const joinByInviteMutation = useMutation({
    mutationFn: async (): Promise<JoinGameResponse> => {
      const normalizedInviteToken = inviteToken.trim();
      if (!normalizedInviteToken) {
        throw new Error("Invite token is required");
      }

      const { data, error } = await supabase.functions.invoke("secret-toaster-join-game", {
        body: {
          inviteToken: normalizedInviteToken,
        },
      });

      if (error) throw error;

      const payload = data as JoinGameResponse | null;
      if (!payload || !payload.ok || !payload.gameId) {
        throw new Error("Join game failed");
      }

      return payload;
    },
    onSuccess: (payload) => {
      setActiveGame({
        gameId: payload.gameId,
        gameCode: payload.gameCode ?? undefined,
        source: "joined",
      });
      setGameEvents([]);
      setGameEventsError(null);
    },
  });

  const createInviteMutation = useMutation({
    mutationFn: async (): Promise<CreateInviteResponse> => {
      if (!activeGame?.gameId) {
        throw new Error("Create or join a game first");
      }

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
      setInviteToken(payload.inviteToken);
    },
  });

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void queryClient.invalidateQueries({ queryKey: ["auth", "user"] });
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [queryClient]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (!activeGame) {
      window.localStorage.removeItem(ACTIVE_GAME_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(ACTIVE_GAME_STORAGE_KEY, JSON.stringify(activeGame));
  }, [activeGame]);

  useEffect(() => {
    if (!activeGame?.gameId) return;

    void (async () => {
      const { data, error } = await supabase
        .schema("secret_toaster")
        .from("games")
        .select("game_code")
        .eq("id", activeGame.gameId)
        .maybeSingle();

      if (!error && data?.game_code) {
        setActiveGame((previous) => {
          if (!previous || previous.gameId !== activeGame.gameId) return previous;
          if (previous.gameCode === data.game_code) return previous;
          return {
            ...previous,
            gameCode: data.game_code,
          };
        });
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

    const channel = supabase
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

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [activeGame?.gameId]);

  useEffect(() => {
    if (!activeGame?.gameId) return;

    const channel = supabase
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
      void supabase.removeChannel(channel);
    };
  }, [activeGame?.gameId, queryClient]);

  const handleSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email) return;
    await signInMutation.mutateAsync(email);
    setEmail("");
  };

  const inviteLink = generatedInvite
    ? `${window.location.origin}/?inviteToken=${encodeURIComponent(generatedInvite.inviteToken)}`
    : "";

  const copyInviteLink = async () => {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
  };

  const currentUserReadiness = gameDetailsQuery.data?.readiness.find(
    (entry) => entry.user_id === authQuery.data?.id,
  );
  const readyMemberIds = new Set(
    gameDetailsQuery.data?.readiness.filter((entry) => entry.is_ready).map((entry) => entry.user_id) ?? [],
  );
  const activeMembersCount = gameDetailsQuery.data?.memberships.filter((member) => member.is_active).length ?? 0;
  const readyCount = readyMemberIds.size;
  const allReady = activeMembersCount > 0 && readyCount >= activeMembersCount;

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4 md:p-8">
      <header className="space-y-2">
        <h1 className="text-4xl font-semibold tracking-tight">Secret Toaster</h1>
        <p className="text-muted-foreground">Modern TypeScript remake in progress.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Connection</CardTitle>
          <CardDescription>Supabase URL: {import.meta.env.VITE_SUPABASE_URL}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
          Auth status:{" "}
          {authQuery.isLoading
            ? "checking"
            : authQuery.data
              ? `signed in as ${authQuery.data.email ?? authQuery.data.id}`
              : "not signed in"}
          </p>
          {authQuery.isError ? <p>Auth error: {authQuery.error.message}</p> : null}

          {authQuery.data ? (
            <Button variant="secondary" onClick={() => signOutMutation.mutate()} disabled={signOutMutation.isPending}>
            {signOutMutation.isPending ? "Signing out..." : "Sign out"}
            </Button>
          ) : (
            <form onSubmit={handleSignIn} className="space-y-2">
              <Label htmlFor="email">Magic link email</Label>
              <Input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
              />
              <Button type="submit" disabled={signInMutation.isPending}>
              {signInMutation.isPending ? "Sending..." : "Send magic link"}
              </Button>
            </form>
          )}

          {signInMutation.isSuccess ? <p>Magic link sent. Check your inbox.</p> : null}
          {signInMutation.isError ? <p>Sign-in error: {signInMutation.error.message}</p> : null}
          {signOutMutation.isError ? <p>Sign-out error: {signOutMutation.error.message}</p> : null}
        </CardContent>
      </Card>

      {authQuery.data ? (
        <Card>
          <CardHeader>
            <CardTitle>Game Setup</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
          <div className="space-y-2">
          <h2 className="text-xl font-semibold">Create Game</h2>
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              createGameMutation.mutate();
            }}
          >
            <Label htmlFor="game-title">Title</Label>
            <Input
              id="game-title"
              type="text"
              value={gameTitle}
              onChange={(event) => setGameTitle(event.target.value)}
              placeholder="Friday Match"
            />
            <Label htmlFor="game-password">Join password (optional)</Label>
            <Input
              id="game-password"
              type="password"
              value={gamePassword}
              onChange={(event) => setGamePassword(event.target.value)}
              placeholder="toasty"
            />
            <Button type="submit" disabled={createGameMutation.isPending}>
              {createGameMutation.isPending ? "Creating..." : "Create game"}
            </Button>
          </form>
          </div>

          {createGameMutation.isError ? <p>Create error: {createGameMutation.error.message}</p> : null}

          <div className="space-y-2">
          <h2 className="text-xl font-semibold">Join Game</h2>
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              joinByCodeMutation.mutate();
            }}
          >
            <Label htmlFor="join-code">Game code</Label>
            <Input
              id="join-code"
              type="text"
              value={joinGameCode}
              onChange={(event) => setJoinGameCode(event.target.value)}
              placeholder="ABC123"
            />
            <Label htmlFor="join-password">Join password</Label>
            <Input
              id="join-password"
              type="password"
              value={joinPassword}
              onChange={(event) => setJoinPassword(event.target.value)}
              placeholder="toasty"
            />
            <Button type="submit" disabled={joinByCodeMutation.isPending}>
              {joinByCodeMutation.isPending ? "Joining..." : "Join with code"}
            </Button>
          </form>

          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              joinByInviteMutation.mutate();
            }}
          >
            <Label htmlFor="invite-token">Invite token</Label>
            <Input
              id="invite-token"
              type="text"
              value={inviteToken}
              onChange={(event) => setInviteToken(event.target.value)}
              placeholder="paste invite token"
            />
            <Button type="submit" disabled={joinByInviteMutation.isPending}>
              {joinByInviteMutation.isPending ? "Joining..." : "Join with invite"}
            </Button>
          </form>
          </div>

          {joinByCodeMutation.isError ? <p>Join (code) error: {joinByCodeMutation.error.message}</p> : null}
          {joinByInviteMutation.isError ? <p>Join (invite) error: {joinByInviteMutation.error.message}</p> : null}

          {activeGame ? (
            <div className="space-y-2">
              <h2 className="text-xl font-semibold">Invite Link</h2>
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

              {createInviteMutation.isError ? (
                <p>Invite error: {createInviteMutation.error.message}</p>
              ) : null}

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
            </div>
          ) : null}

          {activeGame ? (
            <div className="space-y-2">
              <p>
                Active game: <strong>{activeGame.gameCode ?? "(invite join)"}</strong>
              </p>
              <p>Game ID: {activeGame.gameId}</p>
              <p>Source: {activeGame.source}</p>

              <h3>Lobby</h3>
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
                    Members: <strong>{gameDetailsQuery.data.memberships.length}</strong>
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

              <h3>Game Events</h3>
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
            </div>
          ) : null}
          </CardContent>
        </Card>
      ) : null}
    </main>
  );
}
