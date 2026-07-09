"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { createBusiness } from "@/features/auth/actions";
import { regionForCountry, DEFAULT_REGION } from "@/features/onboarding/regions";
import { RegionSelect } from "@/features/onboarding/components/RegionSelect";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Map a Better Auth sign-up error to a user-facing message WITHOUT confirming
 * whether the email already has an account (account-enumeration hardening, M-2).
 *
 * The "user already exists" case (Better Auth codes `USER_ALREADY_EXISTS` /
 * `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`) is collapsed into a neutral message
 * that is indistinguishable from a generic create-account failure. Genuine
 * validation problems (weak password, invalid email) keep their specific,
 * helpful messages so legitimate users can fix their input.
 */
function signUpErrorMessage(error: { code?: string; message?: string }): string {
  const code = error.code ?? "";
  if (code.includes("USER_ALREADY_EXISTS")) {
    return "Couldn't create your account. Double-check your details, or sign in if you already have one.";
  }
  return error.message ?? "Could not create account.";
}

export default function SignUpPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [country, setCountry] = useState<string>(DEFAULT_REGION.country);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const signUp = await authClient.signUp.email({ email, password, name });
      if (signUp.error) {
        setError(signUpErrorMessage(signUp.error));
        return;
      }
      const { currency } = regionForCountry(country);
      const { businessId } = await createBusiness({ name: businessName, country, currency });
      // Route a brand-new merchant to catalog setup (they have no items yet), not
      // the empty register (audit #3). The first-run checklist guides from there.
      router.push(`/${businessId}/products`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl font-black">Create account</CardTitle>
          <CardDescription>Set up your business in a minute.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div>
              <Label htmlFor="name">Your name</Label>
              <Input id="name" value={name} autoComplete="name" required onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="business">Business name</Label>
              <Input
                id="business"
                value={businessName}
                required
                onChange={(e) => setBusinessName(e.target.value)}
              />
            </div>
            <RegionSelect country={country} onChange={setCountry} />
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
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                autoComplete="new-password"
                required
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && (
              <p className="text-sm font-medium text-destructive" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? "Creating…" : "Create account"}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Have an account?{" "}
            <Link href="/sign-in" className="font-semibold text-primary underline">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
