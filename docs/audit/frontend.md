# Front-End, UX, Visual & Content

**Manager:** Diego, Design Lead
**Severity counts:** S0 0 · S1 2 · S2 2 · S3 8

## Executive summary

The Front-End/UX/Visual/Content domain of VallaPOS is, at the component level, a disciplined and well-built system: a single OKLCH token layer drives light/dark parity, shadcn primitives are fully tokenized, focus-visible outlines are global, a 44px touch floor exists, and the marketing count-up hero (a recon suspicion) was confirmed NOT a bug. The real problems are two S1 defects that ship to production today. (1) The app's dominant CTA style fails WCAG 1.4.3 text contrast: the default Button 'primary' variant computes 3.98:1 and the 'success' variant 3.62:1 in light mode (both below the 4.5:1 AA floor), affecting essentially every form submit and primary action app-wide — I reproduced these ratios with an independent OKLCH→sRGB→luminance script. (2) The live legal surface (Privacy, DMCA, Do-Not-Sell) still carries in-document 'this is a template, not legal advice' disclaimers and unfilled [mailing address]/[DMCA Designated Agent name] placeholders, and the DMCA doc itself states the company has no §512 safe harbor because no agent is registered — a content defect with legal exposure that must be escalated out of the design lane. Below that: two S2 keyboard/touch operability gaps (password show/hide is Tab-unreachable on every auth form; the coarse-pointer rule sets min-height but never min-width, so dense icon rows render 32–40px wide on the touch terminals this product targets). The remaining eight S3 items are polish and pattern-conformance nits — a design-token bypass in two files, self-inconsistent hero receipt totals, a tautological 'VallaPOS is a product of VallaPOS' copyright line, dead footer social links, a missing custom 404, a non-conforming radiogroup, a heading hidden on mobile, and borderline 1.4.11 border contrast.

## Coverage statement

Domain covered: design-system/token consistency, color contrast (WCAG 1.4.3 text and 1.4.11 non-text), keyboard operability (2.1.1), touch-target sizing, ARIA correctness, heading structure, marketing/legal/footer/empty-state copy, and error pages. All findings are static-source-derived — NO live browser, NO axe/Lighthouse run, NO real screen-reader/keyboard pass, and NO rendered-pixel measurement. Contrast ratios were computed from the OKLCH token declarations in app/globals.css via an independent Björn Ottosson OKLCH→linear-sRGB→relative-luminance conversion (verified white→(1,1,1)) with gamut clamping; a browser's actual rendering (sub-pixel antialiasing, font weight, /90 hover opacity) was not measured, though the base ratios are gamut-independent facts. Every finding in this report was re-opened and confirmed against source by me (Diego) — the two S1s and the button/contrast/legal/footer/hero items were read line-by-line and the math re-run. Gaps I am honest about: (a) I could not confirm actual on-device mis-tap rates for the touch-target finding; (b) the ARIA-radiogroup and border-contrast items are conformance/design-call judgments, not observed user failures; (c) the legal-template finding needs qualified counsel, which is outside this squad's competence — I am flagging, not adjudicating, it. Marketing SPA legal docs are in-page hash anchors (not separately crawlable), matching recon.

## Sign-off

I attest that the Front-End, UX, Visual & Content domain was fully covered at the static-source level. All 12 findings below were independently re-verified by me against C:/Users/RickD/AndroidStudioProjects/VallaPOS — no unverified auditor guess survived, contrast ratios were recomputed from source tokens, and one severity was corrected (footer copyright S2→S3). No duplicate findings remained across my three auditors. The one caveat on completeness is the absence of a live-browser / assistive-technology pass and rendered-pixel contrast measurement, and that the legal-template item requires counsel to resolve. — Diego, Design Lead

## Findings (12)

#### S1 — Default 'primary' and 'success' Button variants fail WCAG 1.4.3 text contrast (3.98:1 and 3.62:1 vs 4.5:1) in light mode, app-wide
- **Area:** color-contrast
- **Auditor:** Lena, the Accessibility Advocate · **Confidence:** high
- **Evidence:** `app/globals.css:22-23 --primary oklch(0.58 0.1 195) on --primary-foreground oklch(0.99 0.01 200) = 3.98:1; :35-36 --success oklch(0.6 0.13 155) on --success-foreground oklch(0.99 0.01 160) = 3.62:1 — both recomputed by me via an independent OKLCH→linear-sRGB→relative-luminance script (white verified to (1,1,1)). src/components/ui/button.tsx:24 makes 'primary' the cva default variant; its text sizes (sm 14px, default 16px, lg 18px non-bold) are all 'normal text' under WCAG, so the large-text 3:1 carve-out does not apply. ~123 <Button> usages default to this style incl. sign-up 'Create account' (app/(auth)/sign-up/page.tsx:147); 'success' is used across SubscriptionCard, DrawerManager, EmployeesManager, PaymentsConnect, HardwareReadiness, Register. Dark mode passes (7.38:1 / 7.11:1), so light-mode only.`
- **Impact:** The app's dominant call-to-action style — the default Button, on essentially every form submit ('Create account', 'Save', 'Charge') across the authenticated app and sign-up funnel — renders text below the 4.5:1 AA minimum. Low-vision and older users may struggle to read primary actions, a formal WCAG 1.4.3 AA failure on the most-used control in the product.
- **Fix:** Lower --primary OKLCH L toward ~0.50-0.52 (or lighten --primary-foreground) until the pair clears 4.5:1; apply the same to --success/--success-foreground. Dark mode is unaffected — scope the change to :root.

#### S1 — Live legal pages (Privacy, DMCA, Do-Not-Sell) are self-labeled unfinished templates with unfilled placeholders and no registered DMCA safe harbor
- **Area:** content/legal
- **Auditor:** Owen, the Copy Editor · **Confidence:** high
- **Evidence:** `src/features/marketing/marketing-content.ts:952 renders, in the live Privacy doc, "This Privacy Statement is a template provided for your convenience and is not legal advice..."; :1140 the DMCA doc states "This document is a template, not legal advice... the safe-harbor protections of 17 U.S.C. § 512 are unavailable until a Designated Agent is registered...". Unfilled tokens: [mailing address] (1136, 1162), [request form link] (1133), [DMCA Designated Agent name] (1160). These pages are footer-linked and reachable in prod at #/privacy, #/terms, #/do-not-sell, #/dmca (marketing-content.ts:1224-1228).`
- **Impact:** A customer, regulator, or plaintiff's counsel opening the live Privacy or DMCA policy reads, in the document itself, that it is an un-reviewed template — undermining its legal force. The DMCA doc's own text confirms VallaPOS currently has NO §512 safe harbor (no agent registered) while running a live product that lets businesses upload catalog images/logos, i.e. self-admitted infringement-liability exposure.
- **Fix:** Escalate beyond the design/copy lane: (1) have counsel finalize copy and strip the in-page 'template' disclaimers; (2) fill every bracketed placeholder with the real registered entity, address, and named DMCA agent; (3) register the agent with the U.S. Copyright Office ($6 filing) to actually obtain §512 safe harbor.

#### S2 — Password show/hide toggle is keyboard-unreachable (tabIndex=-1) on every auth form
- **Area:** keyboard-operability
- **Auditor:** Lena, the Accessibility Advocate · **Confidence:** high
- **Evidence:** `app/(auth)/_components/PasswordInput.tsx:28-31 — the eye-icon button is type="button" AND tabIndex={-1} (comment: 'Not a submit; sits inside the form but must never trigger it'), removing it from Tab order. This component is reused by sign-in, sign-up, and reset-password — every password field in the app.`
- **Impact:** Keyboard-only users cannot toggle password visibility anywhere in auth, violating WCAG 2.1.1 (Keyboard). The feature is mouse/touch-only. Core submission still works via Enter.
- **Fix:** Remove tabIndex={-1}. type="button" already prevents implicit form submission on Enter, so the tabIndex was solving a non-issue at the cost of keyboard access.

#### S2 — Coarse-pointer touch rule sets min-height but no min-width; icon-only buttons render 32-40px wide on touch terminals
- **Area:** touch-target-size
- **Auditor:** Lena, the Accessibility Advocate · **Confidence:** high
- **Evidence:** `app/globals.css:167-175 the @media (pointer: coarse) block sets min-height: 44px on button/[role=button]/a/input/select but never min-width (confirmed by me reading the full rule). Icon-only <Button size="icon"> (default h-12 w-12, src/components/ui/button.tsx:21) is shrunk via className to h-8 w-8 / h-9 w-9 / h-10 w-10 in dense rows — e.g. ProductsManager.tsx category/variation/item move/edit/delete controls (h-8 w-8 four-in-a-row at :1138-1187). computed height = max(explicit, min-height) → 44px tall but stays 32/36/40px wide.`
- **Impact:** On the tablet/phone registers this product targets, rows of adjacent icon-only actions (move up/down/edit/delete) present as narrow ~32-40px-wide targets packed side-by-side — real mis-tap risk on a busy shift, in the exact touch-first workflow the CSS comment claims to guarantee. Below AAA SC 2.5.5 (target size is not AA), so a motor-accessibility risk rather than a formal AA failure.
- **Fix:** Add min-width: 44px alongside min-height in the coarse-pointer rule, or stop shrinking size="icon" Buttons below 44px in dense list rows.

#### S3 — Two components bypass the --success/--warning design tokens with raw Tailwind palette colors + manual dark: overrides
- **Area:** design-system consistency
- **Auditor:** Nadia, the Pixel Perfectionist · **Confidence:** high
- **Evidence:** `app/(app)/[businessId]/reports/page.tsx:198,202,223 use bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 and bg-amber-500/10 text-amber-700 dark:text-amber-400 for tender verified/unverified badges; src/features/onboarding/components/FirstRunChecklist.tsx:240-241 uses border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400. The app has dedicated --success/--warning OKLCH tokens (globals.css:35-38) used everywhere else for this exact semantic (Register, DevicesManager, HardwareReadiness, GraceBanner, TableDetail, pay/success). These are the only two files tree-wide using raw amber/emerald classes and the only 4 lines needing a manual dark: override anywhere.`
- **Impact:** The reports 'Payments by tender' badges and the onboarding tax nudge render a slightly different hue than every other success/warning surface and will silently drift if the tokens are retuned — a demonstrable design-system leak in a feature (tender verification) the codebase itself flags as security-relevant.
- **Fix:** Replace with bg-success/10 text-success and bg-warning/10 text-warning-foreground border-warning/40, matching GraceBanner/DevicesManager; this also removes the dark: overrides.

#### S3 — Hero mock shows two mutually inconsistent totals ($17.85 vs $17.86) for the same order
- **Area:** content/marketing-hero
- **Auditor:** Owen, the Copy Editor · **Confidence:** high
- **Evidence:** `marketing-content.ts:591-595 (static 'receipt') items 9.00+3.50+4.00=16.50, Tax 1.35, Total 17.85; :615-620 (adjacent 'reg' register mock, same items) Subtotal $16.50, Tax (8.25%) $1.36, Total $17.86 (id=heroTotal). Both sit in the same hero 'stage' depicting the same Rosa's Tacos order but disagree by a cent. 8.25% of $16.50 = $1.36125 → $1.36, so $17.86 is correct. Note: the .receipt block is aria-hidden="true" (decorative), so this is a visual-only inconsistency.`
- **Impact:** A visitor scanning both mock elements sees two totals for the identical order — undermining the pitch that the register computes tax/totals correctly, on a POS product's own homepage.
- **Fix:** Fix the static receipt prop (marketing-content.ts:594-595) to Tax 1.36 / Total 17.86 to match the register mock and the count-up target.

#### S3 — Footer copyright line is a tautological / unfilled entity stub ('VallaPOS is a product of VallaPOS')
- **Area:** content/footer
- **Auditor:** Owen, the Copy Editor · **Confidence:** high
- **Evidence:** `marketing-content.ts:1232 — '<span>© <span id="year">2026</span> VallaPOS. VallaPOS is a product of VallaPOS. All rights reserved.</span>', confirmed verbatim. Visible on every marketing page load.`
- **Impact:** Reads as an unedited template stub rather than the real legal entity name (e.g. 'VallaPOS, Inc.') referenced elsewhere in the Terms/Privacy docs — a trust ding on a payments product homepage. Cosmetic copy defect, no functional or legal harm (downgraded from the auditor's S2).
- **Fix:** Replace with the real legal entity, e.g. '© 2026 VallaPOS, Inc. All rights reserved.', coordinated with whoever fills the legal-doc [mailing address] placeholders so the entity name is consistent.

#### S3 — Footer social icons 'Storefront' and 'Contact' are dead self-links (href="#/")
- **Area:** content/footer
- **Auditor:** Owen, the Copy Editor · **Confidence:** high
- **Evidence:** `marketing-content.ts:1204-1205 — '<a href="#/" aria-label="Storefront">' and '<a href="#/" aria-label="Contact">' in .footer__social, both pointing at the home hash route. A real contact path exists two columns over (mailto:hello@vallapos.com at :1220).`
- **Impact:** Screen-reader users hear an actionable 'Contact' link that just re-scrolls the current page — a misleading affordance and a redundant/broken duplicate of the working Contact mailto.
- **Fix:** Point the icons at real destinations (mailto/social profile) or remove the two decorative icon links since a working Contact link already exists in the Company column.

#### S3 — No custom 404 (not-found) page for the site
- **Area:** content/error-pages
- **Auditor:** Owen, the Copy Editor · **Confidence:** high
- **Evidence:** `No app/not-found.tsx or nested route-level not-found.tsx exists anywhere in the App Router tree (confirmed — the file does not exist). RECON independently observed /blog returning a bare 404 in prod.`
- **Impact:** Any mistyped URL, stale link, or the not-yet-deployed /blog route falls through to Next.js's default unstyled 404 instead of an on-brand page with navigation back into the app/marketing site — an inconsistent edge on an otherwise polished product.
- **Fix:** Add app/not-found.tsx with on-brand copy and links to / (and /sign-in for authenticated users), reusing the marketing design system.

#### S3 — BusinessTypeSelect radiogroup omits the ARIA radio keyboard pattern (no roving tabindex / arrow keys)
- **Area:** aria-correctness
- **Auditor:** Lena, the Accessibility Advocate · **Confidence:** medium
- **Evidence:** `src/features/onboarding/components/BusinessTypeSelect.tsx:29-53 renders role="radiogroup" wrapping two <button role="radio" aria-checked> elements, but each keeps its own natural Tab stop — no roving tabindex, no onKeyDown arrow-key handler. The ARIA APG radiogroup pattern expects a single Tab stop with arrows cycling options.`
- **Impact:** Screen-reader/keyboard users hear radio semantics but get independent-Tab-stop behavior; both options remain reachable via Tab+Enter/Space, so a pattern-conformance nit rather than a blocker.
- **Fix:** Implement roving tabindex + arrow-key handling per the APG, or drop role=radio/radiogroup for a native fieldset/legend with real radio inputs so AT behavior comes for free.

#### S3 — Register's 'Current sale' cart heading is display:none below the xl breakpoint (mobile/tablet lose it)
- **Area:** heading-structure
- **Auditor:** Lena, the Accessibility Advocate · **Confidence:** medium
- **Evidence:** `src/features/register/components/Register.tsx:1222 — '<h2 className="mb-4 hidden text-lg font-bold xl:block">Current sale</h2>' is display:none below xl and shows only at desktop widths; no aria-label substitutes on the cart container at smaller widths.`
- **Impact:** On phone/tablet — the primary form factor for this mobile POS — a screen-reader user navigating by headings loses the landmark identifying the cart/current-sale region.
- **Fix:** Use an sr-only heading instead of hidden so it stays in the accessibility tree at all breakpoints, or add aria-label="Current sale" to the cart wrapper for narrow viewports.

#### S3 — Low-contrast input/card borders (~1.3:1) against adjacent surfaces in light mode
- **Area:** color-contrast
- **Auditor:** Lena, the Accessibility Advocate · **Confidence:** low
- **Evidence:** `app/globals.css:42-43 --border/--input oklch(0.9 0.008 240) vs --background oklch(0.99 0.004 220) = 1.31:1, and vs --card oklch(1 0 0) = 1.35:1 — recomputed by me with the same OKLCH→sRGB script. WCAG 1.4.11 requires 3:1 for UI-component boundaries that are the only cue to a control's extent (input.tsx border-input box).`
- **Impact:** In light mode, inputs and cards rely on drop shadow more than a visible border; low-vision users relying on the border edge to locate an input's typeable extent may struggle. Borderline under 1.4.11 — the shadow may qualify as a sufficient alternate cue, so this is a deliberate design call to make, not a clear failure.
- **Fix:** Darken --border/--input toward oklch ~0.82-0.85 in light mode to clear 3:1 against background/card, or consciously accept the shadow as the alternate cue.

