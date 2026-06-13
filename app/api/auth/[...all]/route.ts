import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

// Better Auth catch-all handler (sign-in/up, session, sign-out, etc.).
export const { GET, POST } = toNextJsHandler(auth);
