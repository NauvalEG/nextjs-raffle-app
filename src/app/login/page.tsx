import type { Metadata } from "next";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Log in — Raffle App",
};

// Outside the (admin) group on purpose: the login page renders no admin
// chrome. Middleware redirects already-authenticated visitors to /raffles.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Raffle App</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Enter your PIN to continue.
          </p>
        </div>
        <LoginForm from={from ?? null} />
      </div>
    </main>
  );
}
