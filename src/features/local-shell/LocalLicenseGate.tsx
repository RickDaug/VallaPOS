"use client";

import { type ReactNode, useEffect, useState } from "react";
import { type LicenseState, resolveLicenseState } from "@/lib/license/gate";
import { type LicenseKv, createLicenseStore } from "@/lib/license/store";
import { webcryptoEd25519Verifier } from "@/lib/license/webcrypto";
import { LICENSE_PUBLIC_KEY } from "@/lib/license/public-key";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Offline-edition license gate (docs/EDITIONS.md §6). On boot it verifies the
 * stored license (Ed25519, our public key) and either renders the app or a
 * license-entry screen. This is the WEBVIEW/UX gate — the Rust `verify_license`
 * (`src-tauri/src/license.rs`) is the authoritative one that refuses to open the
 * store without a valid signature.
 *
 * The `@tauri-apps/plugin-store` KV is imported DYNAMICALLY and only here (rendered
 * only by the local layout), so the cloud bundle never includes it. Runtime needs
 * the Tauri `store` plugin registered in `src-tauri`.
 */
const verify = webcryptoEd25519Verifier(LICENSE_PUBLIC_KEY);

async function loadKv(): Promise<LicenseKv> {
  const { load } = await import("@tauri-apps/plugin-store");
  const store = await load("vallapos-license.json");
  return {
    get: (key) => store.get<string>(key),
    set: async (key, value) => {
      await store.set(key, value);
      await store.save();
    },
    delete: async (key) => {
      await store.delete(key);
      await store.save();
    },
  };
}

function reasonMessage(reason: string): string {
  switch (reason) {
    case "expired":
      return "This license has expired.";
    case "revoked":
      return "This license has been revoked. Contact support.";
    case "unsupported_version":
      return "This license needs a newer version of the app.";
    default:
      return "That license key isn't valid. Check the key from your purchase email.";
  }
}

export function LocalLicenseGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LicenseState | "checking">("checking");
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const store = createLicenseStore(await loadKv());
        const s = await resolveLicenseState({
          loadBlob: () => store.load(),
          verify,
          now: Date.now(),
        });
        if (!cancelled) setState(s);
      } catch (e) {
        console.error("License check failed:", e);
        if (!cancelled) setState({ status: "unlicensed" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function activate() {
    const blob = keyInput.trim();
    if (!blob) return;
    setBusy(true);
    setErr(null);
    try {
      const s = await resolveLicenseState({ loadBlob: () => blob, verify, now: Date.now() });
      if (s.status === "licensed") {
        await createLicenseStore(await loadKv()).save(blob);
        setState(s);
      } else {
        setErr(s.status === "invalid" ? reasonMessage(s.reason) : "That license key isn't valid.");
      }
    } catch {
      setErr("Couldn't read that key.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "checking") {
    return (
      <Centered>
        <p className="text-muted-foreground text-sm">Checking license&hellip;</p>
      </Centered>
    );
  }

  if (state.status === "licensed") return <>{children}</>;

  return (
    <Centered>
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col gap-4 p-6">
          <div>
            <h1 className="text-xl font-black tracking-tight">Activate VallaPOS Desktop</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Paste the license key from your purchase email to unlock the app.
            </p>
          </div>
          <textarea
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            rows={4}
            spellCheck={false}
            placeholder="VLK1…"
            className="border-border bg-background w-full rounded-lg border p-3 font-mono text-xs break-all"
          />
          {state.status === "invalid" ? (
            <p className="text-destructive text-sm">{reasonMessage(state.reason)}</p>
          ) : null}
          {err ? <p className="text-destructive text-sm">{err}</p> : null}
          <Button onClick={activate} disabled={busy || !keyInput.trim()}>
            {busy ? "Activating…" : "Activate"}
          </Button>
        </CardContent>
      </Card>
    </Centered>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="bg-background text-foreground flex min-h-screen items-center justify-center p-6">
      {children}
    </div>
  );
}
