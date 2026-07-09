"use client";

import { useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Request a password reset (audit R4 #2). Sends the email to Better Auth's
 * requestPasswordReset, which mints a token and (via auth.ts → auth-emails.ts)
 * emails a link back to /reset-password.
 *
 * Account-enumeration hardening (mirrors sign-up M-2): we show the SAME neutral
 * "check your inbox" confirmation whether or not the address has an account, so a
 * stranger can't probe which emails are registered.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const redirectTo =
        typeof window !== "undefined"
          ? `${window.location.origin}/reset-password`
          : "/reset-password";
      // Better Auth returns success without confirming existence; we surface the
      // same confirmation on any non-throwing outcome.
      await authClient.requestPasswordReset({ email, redirectTo });
      setSent(true);
    } catch {
      // Even a transient failure gets the neutral confirmation so we never leak
      // whether the address exists. (A real outage still logs server-side.)
      setSent(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl font-black">Reset password</CardTitle>
          <CardDescription>
            {sent
              ? "Check your inbox."
              : "Enter your email and we'll send you a reset link."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                If an account exists for <span className="font-medium text-foreground">{email}</span>,
                you&apos;ll get an email with a link to set a new password. The link expires in about
                an hour.
              </p>
              <Link href="/sign-in" className="block text-center text-sm font-semibold text-primary underline">
                Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <form className="space-y-4" onSubmit={onSubmit}>
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    autoComplete="email"
                    required
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                {error && (
                  <p className="text-sm font-medium text-destructive" role="alert">
                    {error}
                  </p>
                )}
                <Button type="submit" disabled={pending} className="w-full">
                  {pending ? "Sending…" : "Send reset link"}
                </Button>
              </form>
              <p className="mt-4 text-center text-sm text-muted-foreground">
                Remembered it?{" "}
                <Link href="/sign-in" className="font-semibold text-primary underline">
                  Sign in
                </Link>
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
