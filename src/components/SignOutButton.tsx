"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await authClient.signOut();
        router.push("/sign-in");
      }}
      className="flex w-full items-center gap-2 rounded-md bg-sidebar-accent px-4 py-3 text-sm font-semibold text-sidebar-foreground hover:bg-sidebar-accent/70"
    >
      <LogOut size={16} /> Sign out
    </button>
  );
}
