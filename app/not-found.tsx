import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center text-foreground">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">404</p>
      <div>
        <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Page not found</h1>
        <p className="mx-auto mt-3 max-w-sm text-sm text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist or may have moved. Let&apos;s get you back on
          track.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link href="/" className={buttonVariants()}>
          Back to home
        </Link>
        <Link href="/sign-in" className={buttonVariants({ variant: "outline" })}>
          Sign in
        </Link>
      </div>
    </main>
  );
}
