"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/15 text-destructive">
        <AlertTriangle size={28} />
      </div>
      <div>
        <h2 className="text-xl font-bold">Something went wrong</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          We hit an error loading this screen. Try again — your data is safe.
        </p>
      </div>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
