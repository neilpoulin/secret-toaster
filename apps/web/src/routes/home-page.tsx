import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type ActiveGame, getStoredActiveGame, setStoredActiveGame } from "@/lib/active-game";
import { supabase } from "@/lib/supabase";

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

function getInitialInviteToken(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("inviteToken") ?? "";
}

export function HomePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [email, setEmail] = useState("");
  const [gameTitle, setGameTitle] = useState("");
  const [gamePassword, setGamePassword] = useState("");
  const [joinGameCode, setJoinGameCode] = useState("");
  const [joinPassword, setJoinPassword] = useState("");
  const [inviteToken, setInviteToken] = useState(getInitialInviteToken());
  const [activeGame, setActiveGame] = useState<ActiveGame | null>(() => getStoredActiveGame());

  const authQuery = useQuery({
    queryKey: ["auth", "user"],
    queryFn: async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      return data.session?.user ?? null;
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
      const nextActiveGame: ActiveGame = {
        gameId: payload.gameId,
        gameCode: payload.gameCode,
        source: "created",
      };
      setActiveGame(nextActiveGame);
      setStoredActiveGame(nextActiveGame);
      setGamePassword("");
      void navigate({ to: "/games/$gameId", params: { gameId: payload.gameId } });
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
      const nextActiveGame: ActiveGame = {
        gameId: payload.gameId,
        gameCode: payload.gameCode ?? joinGameCode.trim().toUpperCase(),
        source: "joined",
      };
      setActiveGame(nextActiveGame);
      setStoredActiveGame(nextActiveGame);
      void navigate({ to: "/games/$gameId", params: { gameId: payload.gameId } });
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
      const nextActiveGame: ActiveGame = {
        gameId: payload.gameId,
        gameCode: payload.gameCode ?? undefined,
        source: "joined",
      };
      setActiveGame(nextActiveGame);
      setStoredActiveGame(nextActiveGame);
      void navigate({ to: "/games/$gameId", params: { gameId: payload.gameId } });
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

  const handleSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email) return;
    await signInMutation.mutateAsync(email);
    setEmail("");
  };

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4 md:p-8">
      <header className="space-y-2">
        <h1 className="text-4xl font-semibold tracking-tight">Secret Toaster</h1>
        <p className="text-muted-foreground">Sign in, create or join, then continue in a dedicated game workspace.</p>
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
            <CardTitle>Game Entry</CardTitle>
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

            {createGameMutation.isError ? <p>Create error: {createGameMutation.error.message}</p> : null}
            {joinByCodeMutation.isError ? <p>Join (code) error: {joinByCodeMutation.error.message}</p> : null}
            {joinByInviteMutation.isError ? <p>Join (invite) error: {joinByInviteMutation.error.message}</p> : null}

            {activeGame ? (
              <div className="space-y-2">
                <p>
                  Last active game: <strong>{activeGame.gameCode ?? activeGame.gameId}</strong>
                </p>
                <Button asChild>
                  <Link to="/games/$gameId" params={{ gameId: activeGame.gameId }}>
                    Open Game Workspace
                  </Link>
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </main>
  );
}
