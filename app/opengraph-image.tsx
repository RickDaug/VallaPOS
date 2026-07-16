import { ImageResponse } from "next/og";

// Social share card for the marketing site (og:image + twitter:image). Next
// serves this at /opengraph-image and wires the <meta> tags automatically.
// Rendered with the Satori/next-og flexbox subset — no external assets.
export const runtime = "edge";
export const alt = "VallaPOS — run your register anywhere, even off the grid";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Brand tokens (mirror the app's "Calm Teal" system, resolved to hex/rgb since
// next-og's CSS subset doesn't support oklch()).
const NAVY = "#12151c";
const NAVY_2 = "#1a2230";
const TEAL = "#2bb7bf";
const INK = "#f4f7f9";
const MUTED = "#9fb0bd";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "60px 80px",
          background: `linear-gradient(135deg, ${NAVY} 0%, ${NAVY_2} 100%)`,
          color: INK,
          fontFamily: "sans-serif",
        }}
      >
        {/* brand row */}
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 18,
              background: `linear-gradient(150deg, ${TEAL}, #1a8f96)`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 44,
              fontWeight: 800,
              color: NAVY,
            }}
          >
            V
          </div>
          <div style={{ display: "flex", fontSize: 40, fontWeight: 700, letterSpacing: "-0.02em" }}>
            <span>Valla</span>
            <span style={{ color: TEAL }}>POS</span>
          </div>
        </div>

        {/* headline */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div
            style={{
              fontSize: 32,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: TEAL,
            }}
          >
            Point of sale for local business
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: 76,
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: "-0.03em",
            }}
          >
            <div style={{ display: "flex" }}>
              <span>Run your register&nbsp;</span>
              <span style={{ color: TEAL }}>anywhere.</span>
            </div>
            <span>Even off the grid.</span>
          </div>
          <div style={{ fontSize: 31, color: MUTED, maxWidth: 900 }}>
            Fast, offline-ready POS for food trucks, barbers &amp; small shops.
            Cash &amp; QR — no cut of your sales.
          </div>
        </div>

        {/* footer chips */}
        <div style={{ display: "flex", gap: 16, fontSize: 26, color: MUTED }}>
          <div
            style={{
              display: "flex",
              padding: "10px 22px",
              borderRadius: 999,
              border: `1px solid ${TEAL}55`,
              color: INK,
            }}
          >
            Works fully offline
          </div>
          <div
            style={{
              display: "flex",
              padding: "10px 22px",
              borderRadius: 999,
              border: `1px solid ${TEAL}55`,
              color: INK,
            }}
          >
            Cash &amp; QR
          </div>
          <div
            style={{
              display: "flex",
              padding: "10px 22px",
              borderRadius: 999,
              border: `1px solid ${TEAL}55`,
              color: INK,
            }}
          >
            vallapos.com
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
