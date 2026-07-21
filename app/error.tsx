"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center text-foreground">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/15 text-destructive">
        <AlertTriangle size={28} />
      </div>
      <div>
        <h1 className="text-xl font-bold">Something went wrong</h1>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          We hit an unexpected error. Try again — your data is safe.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button onClick={reset}>Try again</Button>
        <Link href="/" className={buttonVariants({ variant: "outline" })}>
          Back to home
        </Link>
      </div>
    </main>
  );
}
