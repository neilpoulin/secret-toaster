import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";

interface CreateGameResponse {
  ok: boolean;
  gameId: string;
  gameCode: string;
  title: string | null;
}

interface GameEventRecord {
  id: number;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export function HomePage() {
  const [email, setEmail] = useState("");
  const [gameTitle, setGameTitle] = useState("");
  const [gamePassword, setGamePassword] = useState("");
  const [createdGame, setCreatedGame] = useState<CreateGameResponse | null>(null);
  const [gameEvents, setGameEvents] = useState<GameEventRecord[]>([]);
  const queryClient = useQueryClient();

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
      setCreatedGame(payload);
      setGameEvents([]);
      setGamePassword("");
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
    if (!createdGame?.gameId) return;

    const channel = supabase
      .channel(`game-events-${createdGame.gameId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "secret_toaster",
          table: "game_events",
          filter: `game_id=eq.${createdGame.gameId}`,
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
  }, [createdGame?.gameId]);

  const handleSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email) return;
    await signInMutation.mutateAsync(email);
    setEmail("");
  };

  return (
    <main>
      <h1>Secret Toaster</h1>
      <p>Modern TypeScript remake in progress.</p>
      <section>
        <h2>Connection</h2>
        <p>Supabase URL: {import.meta.env.VITE_SUPABASE_URL}</p>
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
          <button onClick={() => signOutMutation.mutate()} disabled={signOutMutation.isPending}>
            {signOutMutation.isPending ? "Signing out..." : "Sign out"}
          </button>
        ) : (
          <form onSubmit={handleSignIn}>
            <label htmlFor="email">Magic link email</label>
            <br />
            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
            />
            <button type="submit" disabled={signInMutation.isPending}>
              {signInMutation.isPending ? "Sending..." : "Send magic link"}
            </button>
          </form>
        )}

        {signInMutation.isSuccess ? <p>Magic link sent. Check your inbox.</p> : null}
        {signInMutation.isError ? <p>Sign-in error: {signInMutation.error.message}</p> : null}
        {signOutMutation.isError ? <p>Sign-out error: {signOutMutation.error.message}</p> : null}
      </section>

      {authQuery.data ? (
        <section>
          <h2>Create Game</h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              createGameMutation.mutate();
            }}
          >
            <label htmlFor="game-title">Title</label>
            <br />
            <input
              id="game-title"
              type="text"
              value={gameTitle}
              onChange={(event) => setGameTitle(event.target.value)}
              placeholder="Friday Match"
            />
            <br />
            <label htmlFor="game-password">Join password (optional)</label>
            <br />
            <input
              id="game-password"
              type="password"
              value={gamePassword}
              onChange={(event) => setGamePassword(event.target.value)}
              placeholder="toasty"
            />
            <br />
            <button type="submit" disabled={createGameMutation.isPending}>
              {createGameMutation.isPending ? "Creating..." : "Create game"}
            </button>
          </form>

          {createGameMutation.isError ? <p>Create error: {createGameMutation.error.message}</p> : null}

          {createdGame ? (
            <>
              <p>
                Created game code: <strong>{createdGame.gameCode}</strong>
              </p>
              <p>Game ID: {createdGame.gameId}</p>

              <h3>Game Events</h3>
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
            </>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
