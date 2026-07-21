import type { Metadata } from "next";

// The sign-in page itself is a client component, so its metadata lives here in a
// co-located server layout (a client page cannot export `metadata`).
export const metadata: Metadata = {
  title: "Sign in",
  description:
    "Sign in to your VallaPOS register to ring up sales, manage your catalog, and view reports.",
  alternates: { canonical: "/sign-in" },
};

export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return children;
}
