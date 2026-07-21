import type { Metadata } from "next";

// The sign-up page itself is a client component, so its metadata lives here in a
// co-located server layout (a client page cannot export `metadata`).
export const metadata: Metadata = {
  title: "Create your account",
  description:
    "Set up VallaPOS for your business in a minute — fast, offline-ready point of sale for food trucks, barbers, market stalls and small shops.",
  alternates: { canonical: "/sign-up" },
};

export default function SignUpLayout({ children }: { children: React.ReactNode }) {
  return children;
}
