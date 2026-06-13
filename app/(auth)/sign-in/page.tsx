/**
 * Sign-in (scaffold). Phase 1 wires this to Better Auth (`authClient.signIn`)
 * with real validation, error states, and redirect to the user's business.
 */
export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-black">Sign in</h1>
        <p className="mt-1 text-sm text-slate-500">Scaffold — auth flow lands in Phase 1.</p>
        <form className="mt-6 space-y-3">
          <input
            type="email"
            placeholder="Email"
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950"
          />
          <input
            type="password"
            placeholder="Password"
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950"
          />
          <button
            type="submit"
            disabled
            className="w-full rounded-2xl bg-slate-950 px-5 py-3 font-bold text-white disabled:bg-slate-300"
          >
            Continue
          </button>
        </form>
      </div>
    </main>
  );
}
