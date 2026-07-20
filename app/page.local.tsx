"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LOCAL_BUSINESS_ID } from "@/lib/edition";

/**
 * Offline-edition entry (`/`). The cloud `/` is the marketing site + a server
 * session check (`headers()`), both banned under `output:'export'`. Here the
 * desktop webview lands on `/` and is sent straight into the app. (Will point at
 * the register once that page is converted; orders for now.)
 */
export default function LocalHome() {
  const router = useRouter();
  useEffect(() => {
    router.replace(`/${LOCAL_BUSINESS_ID}/orders`);
  }, [router]);
  return null;
}
