import type { Metadata } from "next";

// The forgot-password page is a client component, so its metadata lives here in a
// co-located server layout. This is a utility flow, so keep it out of the index.
export const metadata: Metadata = {
  title: "Reset password",
  description: "Request a link to reset your VallaPOS account password.",
  alternates: { canonical: "/forgot-password" },
  robots: { index: false },
};

export default function ForgotPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
