/**
 * Peripherals — ESC/POS → structured PREVIEW renderer (pure, deterministic).
 *
 * Walks a `Uint8Array` of ESC/POS commands (the exact stream `escpos.ts`
 * `formatReceipt()` produces, or anything the `VirtualTransport` captured) and
 * reconstructs a structured, on-screen-renderable receipt: an ordered list of
 * rendered lines `{ text, align, bold, size }` plus inline markers for QR blocks,
 * paper cuts, and drawer kicks. A UI later paints this as a faithful preview; a
 * test asserts on it without any printer.
 *
 * Design goals:
 *  - PURE: no DOM, no network, no hardware, no deps. Same bytes → same output.
 *  - TOLERANT: unknown commands are skipped along with their operand bytes so a
 *    stray/vendor command never corrupts the rest of the render.
 *
 * It understands the commands `escpos.ts` emits: ESC @ (init), ESC a (align),
 * ESC E (bold), GS ! (size), text runs + LF, GS V (cut), the GS ( k QR block, and
 * ESC p / DLE DC4 (drawer kick). Other ESC/GS commands are length-skipped by a
 * small operand table; truly unknown control bytes are dropped harmlessly.
 */

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;
const CR = 0x0d;
const DLE = 0x10;
const DC4 = 0x14;

export type PreviewAlign = "left" | "center" | "right";
export type PreviewSize = "normal" | "double-height" | "double-width" | "double";

/** A single rendered line of text with its active formatting. */
export interface PreviewLine {
  kind: "line";
  text: string;
  align: PreviewAlign;
  bold: boolean;
  size: PreviewSize;
}

/** A non-text marker emitted inline at its position in the receipt. */
export interface PreviewMarker {
  kind: "qr" | "cut" | "drawer-kick";
  /** The QR payload, for `kind: "qr"`; undefined otherwise. */
  data?: string;
}

export type PreviewNode = PreviewLine | PreviewMarker;

export interface Preview {
  nodes: PreviewNode[];
  /** Convenience: just the text lines, in order. */
  lines: PreviewLine[];
}

/**
 * Map a GS ! n character-size byte onto the structured enum. ESC/POS encodes the
 * height multiplier in the low nibble (bits 0-2) and the width multiplier in the
 * high nibble (bits 4-6). The escpos.ts builder uses 0x00 normal, 0x01
 * double-height, 0x11 double (height + width).
 */
function sizeFrom(byte: number): PreviewSize {
  const h = (byte & 0x0f) !== 0; // any height multiplier nibble set
  const w = (byte & 0xf0) !== 0; // any width multiplier nibble set
  if (h && w) return "double";
  if (w) return "double-width";
  if (h) return "double-height";
  return "normal";
}

/**
 * Operand byte counts for the ESC/GS commands we want to skip cleanly without
 * interpreting. Keyed by the command byte that follows ESC or GS. Commands not
 * listed here and not handled explicitly fall back to skipping nothing (the
 * command byte itself is consumed, operands — if any — render as harmless text,
 * which for the streams we target does not happen).
 */
const ESC_OPERANDS: Record<number, number> = {
  0x40: 0, // ESC @  init (no operand) — handled explicitly too
  0x61: 1, // ESC a  align n
  0x45: 1, // ESC E  bold n
  0x70: 3, // ESC p  drawer kick: m t1 t2 — handled explicitly
  0x74: 1, // ESC t  code page n
  0x21: 1, // ESC !  print mode n
  0x32: 0, // ESC 2  default line spacing
  0x33: 1, // ESC 3  line spacing n
  0x4d: 1, // ESC M  font n
  0x64: 1, // ESC d  feed n lines
  0x4a: 1, // ESC J  feed n dots
};

const GS_OPERANDS: Record<number, number> = {
  0x21: 1, // GS !  character size n
  0x56: 2, // GS V  cut m (n) — escpos emits GS V 66 0 (2 operands) — handled explicitly
  0x42: 1, // GS B  reverse n
  0x4c: 2, // GS L  left margin nL nH
  0x57: 2, // GS W  print width nL nH
};

/**
 * Render an ESC/POS byte stream into a structured preview.
 */
export function preview(bytes: Uint8Array): Preview {
  const nodes: PreviewNode[] = [];

  let align: PreviewAlign = "left";
  let bold = false;
  let size: PreviewSize = "normal";

  // Accumulator for the current text line.
  let buf = "";
  let dirty = false; // any printable char (even spaces) seen on this line?

  const flush = (force = false): void => {
    if (!dirty && !force) {
      buf = "";
      return;
    }
    nodes.push({ kind: "line", text: buf, align, bold, size });
    buf = "";
    dirty = false;
  };

  let i = 0;
  const n = bytes.length;
  while (i < n) {
    const byte = bytes[i] as number;

    if (byte === LF) {
      flush();
      i += 1;
      continue;
    }
    if (byte === CR) {
      i += 1; // ignore carriage returns (paired with LF)
      continue;
    }

    if (byte === ESC) {
      const cmd = bytes[i + 1];
      if (cmd === undefined) {
        i = n;
        break;
      }
      if (cmd === 0x40) {
        // ESC @ — init: reset formatting. Flush any pending text first.
        flush();
        align = "left";
        bold = false;
        size = "normal";
        i += 2;
        continue;
      }
      if (cmd === 0x61) {
        // ESC a n — align. A formatting change starts a new line.
        const v = bytes[i + 2] ?? 0;
        if (dirty) flush();
        align = v === 1 ? "center" : v === 2 ? "right" : "left";
        i += 3;
        continue;
      }
      if (cmd === 0x45) {
        // ESC E n — bold.
        bold = (bytes[i + 2] ?? 0) !== 0;
        i += 3;
        continue;
      }
      if (cmd === 0x70) {
        // ESC p m t1 t2 — cash-drawer kick.
        flush();
        nodes.push({ kind: "drawer-kick" });
        i += 5;
        continue;
      }
      // Unknown/uninterpreted ESC command — skip its operands cleanly.
      const operands = ESC_OPERANDS[cmd] ?? 0;
      i += 2 + operands;
      continue;
    }

    if (byte === GS) {
      const cmd = bytes[i + 1];
      if (cmd === undefined) {
        i = n;
        break;
      }
      if (cmd === 0x21) {
        // GS ! n — character size.
        size = sizeFrom(bytes[i + 2] ?? 0);
        i += 3;
        continue;
      }
      if (cmd === 0x56) {
        // GS V m (n) — paper cut.
        flush();
        nodes.push({ kind: "cut" });
        // escpos.ts emits GS V 66 0 → 2 operand bytes.
        i += 2 + (GS_OPERANDS[0x56] ?? 0);
        continue;
      }
      if (cmd === 0x28) {
        // GS ( fn pL pH ... — a parameterised block. The QR family is GS ( k.
        const sub = bytes[i + 2]; // 'k' = 0x6b for QR
        const pL = bytes[i + 3] ?? 0;
        const pH = bytes[i + 4] ?? 0;
        const blockLen = pL + (pH << 8);
        const dataStart = i + 5;
        const dataEnd = dataStart + blockLen;
        if (sub === 0x6b) {
          // QR fn: GS ( k pL pH cn fn [params...]. The "store data" function is
          // fn=80 (0x50) where the payload follows the 3 prefix bytes cn fn m.
          const cn = bytes[dataStart]; // 0x31 (model "1")
          const fn = bytes[dataStart + 1];
          if (cn === 0x31 && fn === 0x50) {
            // Stored data: bytes after [cn fn m] up to dataEnd.
            const payload = bytes.slice(dataStart + 3, dataEnd);
            const data = asciiDecode(payload);
            flush();
            nodes.push({ kind: "qr", data });
          }
          // Other QR sub-functions (select model / size / EC / print) carry no
          // user data — skip them by their declared block length.
        }
        i = dataEnd;
        continue;
      }
      // Unknown/uninterpreted GS command — skip its operands cleanly.
      const operands = GS_OPERANDS[cmd] ?? 0;
      i += 2 + operands;
      continue;
    }

    if (byte === DLE) {
      // DLE DC4 ... — real-time request (escpos uses it as an alternate drawer kick).
      if (bytes[i + 1] === DC4) {
        flush();
        nodes.push({ kind: "drawer-kick" });
        i += 5; // DLE DC4 n m t (the form escpos.ts builds)
        continue;
      }
      i += 1;
      continue;
    }

    // Other control bytes (< 0x20, not handled above) are skipped harmlessly.
    if (byte < 0x20) {
      i += 1;
      continue;
    }

    // Printable byte — append to the current line.
    buf += String.fromCharCode(byte);
    dirty = true;
    i += 1;
  }

  // Flush any trailing text without a final LF.
  flush();

  const lines = nodes.filter((node): node is PreviewLine => node.kind === "line");
  return { nodes, lines };
}

/** Decode a printable-ASCII byte slice to a string. */
function asciiDecode(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += String.fromCharCode(b);
  return out;
}

/** Render a preview to plain multi-line text (handy for snapshotting / debugging). */
export function previewToText(p: Preview): string {
  return p.nodes
    .map((node) => {
      switch (node.kind) {
        case "line":
          return node.text;
        case "qr":
          return `[QR: ${node.data ?? ""}]`;
        case "cut":
          return "[✂ cut]";
        case "drawer-kick":
          return "[drawer kick]";
      }
    })
    .join("\n");
}
