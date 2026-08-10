"use client";

/**
 * Public marketing site (home / about / legal), rendered at `/` for signed-out
 * visitors. Ported from the published design artifact (see marketing-content.ts).
 *
 * Why this shape:
 * - The artifact is a self-contained HTML/CSS/JS page. Its markup + CSS are
 *   injected verbatim (the enforced CSP allows inline <style>, and the HTML has
 *   no scripts). Its ORIGINAL inline <script> would be blocked by our strict
 *   `script-src` (nonce + strict-dynamic, no 'unsafe-inline'), so every bit of
 *   its behaviour is re-implemented here as bundled client code that runs in a
 *   useEffect — that ships from 'self' and is CSP-clean.
 * - The artifact shipped its own [data-theme] dark system; the generator rewrote
 *   those selectors to `.dark` so the site shares next-themes with the rest of
 *   the app. The theme toggle below drives next-themes.
 */

import { useEffect, useRef } from "react";
import { MARKETING_CSS, MARKETING_HTML } from "./marketing-content";
import { htmlForView, type MarketingView } from "./view";

// Imperative theme toggle that matches the app's next-themes config
// (attribute="class", storageKey="theme"): flip the .light/.dark class on
// <html>, mirror color-scheme, and persist so next-themes' no-flash script
// restores it on the next load. Done imperatively — NOT via useTheme() — so
// MarketingSite never re-renders after mount and React never re-applies the
// injected HTML (a re-render would wipe the effect's DOM mutations below).
function toggleTheme() {
  const el = document.documentElement;
  const next = el.classList.contains("dark") ? "light" : "dark";
  el.classList.remove("light", "dark");
  el.classList.add(next);
  el.style.colorScheme = next;
  try {
    localStorage.setItem("theme", next);
  } catch {
    /* storage blocked — toggle still applies for this session */
  }
}

// Optional Stripe Payment Link URLs. When a real link is set (env or here), the
// When a static Stripe Payment Link env is set, the matching "Subscribe"/"Buy"
// button opens it in a new tab. Otherwise: cloud → the free sign-up flow, and
// offline → `/desktop/buy` (a server-created one-time Checkout Session; that
// route redirects back to pricing when Stripe is unset, so it's never broken).
const BUY_LINKS: Record<string, string> = {
  cloud: process.env.NEXT_PUBLIC_STRIPE_LINK_CLOUD ?? "",
  offline: process.env.NEXT_PUBLIC_STRIPE_LINK_OFFLINE ?? "",
};

/**
 * The legal documents, each of which is a real route under `app/`. Used only to
 * recognise the artifact's legacy `#/privacy`-style hash links and forward them
 * to the route that owns that content now.
 */
const LEGAL_ROUTES = new Set(["privacy", "terms", "disputes", "do-not-sell", "dmca"]);

export default function MarketingSite({ view = "home" }: { view?: MarketingView } = {}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cleanups: Array<() => void> = [];
    const on = (
      el: EventTarget | null,
      type: string,
      handler: EventListenerOrEventListenerObject,
      opts?: AddEventListenerOptions,
    ) => {
      if (!el) return;
      el.addEventListener(type, handler, opts);
      cleanups.push(() => el.removeEventListener(type, handler, opts));
    };
    const $ = <T extends Element = HTMLElement>(sel: string) =>
      root.querySelector<T>(sel);
    const $$ = <T extends Element = HTMLElement>(sel: string) =>
      Array.from(root.querySelectorAll<T>(sel));

    const closeMenu = () => {
      const menuBtn = document.getElementById("menuToggle");
      const navMobile = document.getElementById("navMobile");
      if (navMobile) navMobile.hidden = true;
      if (menuBtn) menuBtn.setAttribute("aria-expanded", "false");
    };

    /* ---- delegated click handling on the stable root ----
       We attach ONE listener to the ref'd container (which React never swaps)
       rather than to the injected controls directly: the innerHTML subtree can
       be re-processed, and a listener bound to a now-detached button silently
       dies. Delegation always dispatches from the live target. */
    on(root, "click", (e) => {
      const t = e.target as Element;
      // theme toggle → flip the shared .dark class (see toggleTheme)
      if (t.closest("#themeToggle")) {
        toggleTheme();
        return;
      }
      // mobile menu open/close
      if (t.closest("#menuToggle")) {
        const menuBtn = document.getElementById("menuToggle");
        const navMobile = document.getElementById("navMobile");
        if (menuBtn && navMobile) {
          const willOpen = navMobile.hidden;
          navMobile.hidden = !willOpen;
          menuBtn.setAttribute("aria-expanded", String(willOpen));
        }
        return;
      }
      // tapping a link inside the mobile menu closes it
      if (t.closest("#navMobile a")) closeMenu();
    });

    /* ---- footer year ---- */
    const year = document.getElementById("year");
    if (year) year.textContent = String(new Date().getFullYear());

    /* ---- purchase / CTA wiring ----
       The default destinations (`/sign-up`, `/desktop/buy`) are now baked into
       the markup by scripts/marketing/generate.mjs, so every Buy/Subscribe
       button works from the server HTML — before hydration and with JS off.
       This effect ONLY overrides them when a static Stripe Payment Link is
       configured, which is an env-time opt-in the server markup can't know. */
    $$("[data-buy]").forEach((el) => {
      const url = BUY_LINKS[el.getAttribute("data-buy") ?? ""];
      if (!url) return;
      el.setAttribute("href", url);
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener");
    });

    /* ---- reveal-on-scroll ---- */
    let io: IntersectionObserver | null = null;
    const setupReveal = () => {
      const els = $$(".view:not([hidden]) .reveal:not(.in)");
      if (reduce || !("IntersectionObserver" in window)) {
        els.forEach((e) => e.classList.add("in"));
        return;
      }
      if (!io) {
        io = new IntersectionObserver(
          (entries) => {
            entries.forEach((en) => {
              if (en.isIntersecting) {
                en.target.classList.add("in");
                io?.unobserve(en.target);
              }
            });
          },
          { rootMargin: "0px 0px -8% 0px", threshold: 0.06 },
        );
      }
      els.forEach((e, i) => {
        (e as HTMLElement).style.transitionDelay = Math.min(i * 40, 200) + "ms";
        io!.observe(e);
      });
    };

    /* ---- in-page anchors + legacy hash-route redirects ----
       About and the legal documents are REAL routes now, and htmlForView drops
       the views this page isn't rendering (they were 61% of the document, resent
       uncached on every hit). All that's left for the router to do is scroll to
       an in-page anchor — and forward the artifact's old `#/about` / `#/privacy`
       links, which may exist in someone's bookmarks or an inbound link, to the
       route that now owns that content. `replace` rather than `assign` so the
       dead hash URL doesn't sit in the back button. */
    const route = () => {
      closeMenu();
      const raw = location.hash || "#/";
      const afterSlash = raw.replace(/^#\//, "");

      if (afterSlash === "about" || LEGAL_ROUTES.has(afterSlash)) {
        location.replace(`/${afterSlash}`);
        return;
      }

      // `#/#pricing` (and a bare `#pricing`) → scroll to that section.
      const scrollId = afterSlash.charAt(0) === "#" ? afterSlash.slice(1) : null;
      if (scrollId) {
        const el = document.getElementById(scrollId);
        if (el) {
          el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
          return;
        }
      }
      window.scrollTo({ top: 0, behavior: "auto" });
      setupReveal();
    };
    on(window, "hashchange", route);

    // Mark the nav's About link current on /about (the server markup can't know
    // which route rendered it, and it's the only nav item with an active state).
    if (view === "about") {
      $$('.nav__link[data-nav="about"]').forEach((a) => a.classList.add("is-active"));
    }

    /* ---- hero total count-up ---- */
    const countUp = () => {
      const el = $("#heroTotal");
      if (!el || reduce) return;
      const target = 17.86;
      const dur = 900;
      let start: number | null = null;
      const tick = (ts: number) => {
        if (start === null) start = ts;
        const p = Math.min((ts - start) / dur, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = "$" + (target * eased).toFixed(2);
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };

    route();
    countUp();

    return () => {
      cleanups.forEach((c) => c());
      io?.disconnect();
    };
  }, [view]);

  return (
    <div ref={rootRef}>
      {/* CSP: style-src allows 'unsafe-inline'; script-src does not (hence the
          effect above instead of the artifact's inline <script>). */}
      <style dangerouslySetInnerHTML={{ __html: MARKETING_CSS }} />
      <div dangerouslySetInnerHTML={{ __html: htmlForView(MARKETING_HTML, view) }} />
    </div>
  );
}
