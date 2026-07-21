import Link from "next/link";
import { BlogThemeToggle } from "@/features/blog/BlogThemeToggle";

// Shared chrome for every /blog page: a slim header with the wordmark and a
// theme toggle, and a footer. The root layout already supplies <html>/<body>,
// the theme provider, and fonts — this only adds the blog frame.
export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between px-5">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            Valla<span className="text-primary">POS</span>
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <Link
              href="/blog"
              className="rounded-md px-3 py-2 font-medium text-muted-foreground hover:text-foreground"
            >
              Blog
            </Link>
            <Link
              href="/sign-up"
              className="rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground hover:opacity-90"
            >
              Start free
            </Link>
            <BlogThemeToggle />
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-5 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            <span className="font-semibold text-foreground">VallaPOS</span> — a register for
            people who sell on the move.
          </p>
          <nav className="flex gap-4">
            <Link href="/blog" className="hover:text-foreground">
              Blog
            </Link>
            <Link href="/" className="hover:text-foreground">
              Home
            </Link>
            <Link href="/sign-up" className="hover:text-foreground">
              Get started
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
