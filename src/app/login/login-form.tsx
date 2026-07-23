"use client";

import { useState, useTransition } from "react";

import { login } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm({ from }: { from: string | null }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // Client-side convenience check; the server re-validates with the same
    // schema (pinSchema) and is the authority.
    if (pin.length === 0) {
      setError("Please enter your PIN.");
      return;
    }

    startTransition(async () => {
      const result = await login(pin, from);
      // On success `login` redirects and never resolves here.
      if (result && !result.ok) {
        setError(result.error);
      }
    });
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="pin">PIN</Label>
            <Input
              id="pin"
              name="pin"
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              autoFocus
              placeholder="••••••"
              value={pin}
              onChange={(e) => {
                // Numeric-only masked input (Feature A Validation).
                setPin(e.target.value.replace(/\D/g, ""));
              }}
              aria-invalid={error ? true : undefined}
              disabled={pending}
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Checking…" : "Log in"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
