import type { Metadata } from "next";

// The reset-password page is a client component, so its metadata lives here in a
// co-located server layout. This is a token-gated utility page — keep it out of
// the index.
export const metadata: Metadata = {
  title: "Set a new password",
  description: "Choose a new password for your VallaPOS account.",
  alternates: { canonical: "/reset-password" },
  robots: { index: false },
};

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
