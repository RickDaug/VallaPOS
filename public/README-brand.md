# Brand assets

| File | Use |
| --- | --- |
| `logo.svg` / `logo.png` | Wordmark on **light** backgrounds. The default. |
| `logo-on-dark.svg` / `logo-on-dark.png` | Wordmark on **dark** backgrounds. |
| `icon-512.png`, `icon-192.png`, `icon-maskable-512.png`, `apple-touch-icon.png` | Square app/PWA icons. |

PNGs are 1200×300 with a transparent background, rendered from the SVGs.
**Edit the SVG, not the PNG** — regenerate with:

```bash
node -e "require('sharp')('public/logo.svg').png().toFile('public/logo.png')"
node -e "require('sharp')('public/logo-on-dark.svg').png().toFile('public/logo-on-dark.png')"
```

(`sharp` is already a transitive dependency via `next`.)

## Colors

| Token | Hex | Notes |
| --- | --- | --- |
| Brand teal | `#1f8a8a` | The icon background and the PWA `theme_color`. Use this for third-party branding forms (Stripe, app stores). |
| Brand teal (dark surfaces) | `#2cb3b3` | `--primary` in dark mode. The darker teal muddies against dark backgrounds. |
| Accent gold | `#f0be67` | `--accent`, i.e. `oklch(0.83 0.12 80)`. |
| Wordmark ink | `#14343a` | The "Valla" text on light backgrounds. |

**Known inconsistency:** `--primary` in light mode is `oklch(0.5 0.1 195)` = `#007475`, which is *not* the `#1f8a8a` used by the icon and manifest. The assets here follow the icon, because that is what users and third-party branding forms see side by side. Worth reconciling in `app/globals.css` at some point.

**Accent contrast:** `#f0be67` on white is fine as a fill or highlight but fails WCAG AA as text or link color — use the ink or a teal there instead.
