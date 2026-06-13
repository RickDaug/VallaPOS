"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await authClient.signOut();
        router.push("/sign-in");
      }}
      className="w-full rounded-2xl bg-white/10 px-4 py-3 text-left text-sm font-semibold text-slate-200 hover:bg-white/20"
    >
      Sign out
    </button>
  );
}
