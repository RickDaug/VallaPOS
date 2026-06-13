/**
 * Sign-up (scaffold). Phase 1: create user via Better Auth, then create the
 * owner's Business + OWNER Membership in the same flow, and redirect to the
 * new business register.
 */
export default function SignUpPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-black">Create account</h1>
        <p className="mt-1 text-sm text-slate-500">Scaffold — auth flow lands in Phase 1.</p>
        <form className="mt-6 space-y-3">
          <input
            type="text"
            placeholder="Business name"
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950"
          />
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
            Create account
          </button>
        </form>
      </div>
    </main>
  );
}
