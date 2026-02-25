import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";

export function HomePage() {
  const [email, setEmail] = useState("");
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
    </main>
  );
}
