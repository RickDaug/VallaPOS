"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "../_components/PasswordInput";

/**
 * Set a new password (audit R4 #2). The user arrives here from the reset email:
 * Better Auth's GET /api/auth/reset-password/:token validates the token, then
 * redirects the browser to `/reset-password?token=VALID_TOKEN` (or
 * `?error=INVALID_TOKEN` when the token is bad/expired). We read that token and
 * POST the new password via authClient.resetPassword.
 */
function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");
  const tokenError = params.get("error");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Bad or missing token: nothing to do here but start over.
  if (!token || tokenError) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl font-black">Link expired</CardTitle>
          <CardDescription>This reset link is invalid or has expired.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/forgot-password"
            className="block text-center text-sm font-semibold text-primary underline"
          >
            Request a new link
          </Link>
        </CardContent>
      </Card>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("The passwords don't match.");
      return;
    }
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    setPending(true);
    try {
      const result = await authClient.resetPassword({ newPassword: password, token: token! });
      if (result.error) {
        setError(result.error.message ?? "Couldn't reset your password. Request a new link.");
        return;
      }
      // Password changed — send them to sign in with the new one.
      router.push("/sign-in");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-2xl font-black">Set a new password</CardTitle>
        <CardDescription>Choose a password you&apos;ll remember.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div>
            <Label htmlFor="password">New password</Label>
            <PasswordInput
              id="password"
              value={password}
              autoComplete="new-password"
              minLength={8}
              required
              aria-describedby="password-hint"
              onChange={(e) => setPassword(e.target.value)}
            />
            <p id="password-hint" className="mt-1 text-xs text-muted-foreground">
              Use at least 8 characters.
            </p>
          </div>
          <div>
            <Label htmlFor="confirm">Confirm new password</Label>
            <PasswordInput
              id="confirm"
              value={confirm}
              autoComplete="new-password"
              minLength={8}
              required
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          {error && (
            <p className="text-sm font-medium text-destructive" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Saving…" : "Save new password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Suspense
        fallback={<p className="text-sm text-muted-foreground">Loading…</p>}
      >
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}
