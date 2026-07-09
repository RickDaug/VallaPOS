"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBusiness } from "@/features/auth/actions";
import { regionForCountry, DEFAULT_REGION } from "@/features/onboarding/regions";
import { RegionSelect } from "@/features/onboarding/components/RegionSelect";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SignOutButton } from "@/components/SignOutButton";

/**
 * Recovery / create-business surface for a signed-in user who has no business
 * (audit #13). This is the ONLY place besides sign-up that calls createBusiness,
 * so a partial sign-up — auth account created but createBusiness failed — is no
 * longer a dead-end: on next sign-in the user is routed here to try again.
 */
export function CreateBusinessForm() {
  const router = useRouter();
  const [businessName, setBusinessName] = useState("");
  const [country, setCountry] = useState<string>(DEFAULT_REGION.country);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const { currency } = regionForCountry(country);
      const { businessId } = await createBusiness({ name: businessName, country, currency });
      router.push(`/${businessId}/products`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create your business.");
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl font-black">Create your business</CardTitle>
          <CardDescription>
            You&apos;re signed in but don&apos;t have a business yet. Set one up to start selling.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
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
            {error && (
              <p className="text-sm font-medium text-destructive" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? "Creating…" : "Create business"}
            </Button>
          </form>
          <div className="mt-4 text-center">
            <SignOutButton />
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
