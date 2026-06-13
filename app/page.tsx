import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background p-6 text-center">
      <div>
        <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 text-sm font-semibold text-primary">
          Browser POS · No hardware
        </div>
        <h1 className="text-4xl font-black tracking-tight text-foreground md:text-5xl">VallaPOS</h1>
        <p className="mx-auto mt-3 max-w-md text-muted-foreground">
          No hardware contract. No complicated setup. Open a browser and sell.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link href="/sign-in" className={cn(buttonVariants({ variant: "primary" }))}>
          Sign in
        </Link>
        <Link href="/sign-up" className={cn(buttonVariants({ variant: "outline" }))}>
          Create account
        </Link>
      </div>
    </main>
  );
}
