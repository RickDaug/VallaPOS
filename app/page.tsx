import Link from "next/link";

/**
 * Public landing. In Phase 1 this will redirect authenticated users straight
 * to their business register; for now it's a simple entry point.
 */
export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-6 text-center">
      <div>
        <h1 className="text-4xl font-black tracking-tight text-slate-950 md:text-5xl">VallaPOS</h1>
        <p className="mt-3 max-w-md text-slate-600">
          No hardware contract. No complicated setup. Open a browser and sell.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/sign-in"
          className="rounded-2xl bg-slate-950 px-6 py-3 font-bold text-white hover:bg-slate-800"
        >
          Sign in
        </Link>
        <Link
          href="/sign-up"
          className="rounded-2xl border border-slate-300 px-6 py-3 font-bold text-slate-900 hover:bg-white"
        >
          Create account
        </Link>
      </div>
      <p className="text-xs text-slate-400">
        Rebuild in progress — see STATE.md and docs/ for the plan.
      </p>
    </main>
  );
}
