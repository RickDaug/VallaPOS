import { createElement as h, type ReactNode } from "react";

/**
 * A tiny, dependency-free Markdown-subset renderer that returns React nodes.
 *
 * We deliberately do NOT pull in a markdown library or MDX: the blog is a small,
 * closed set of posts we author ourselves, and rendering to real React elements
 * (never `dangerouslySetInnerHTML`) keeps the pages clean under our strict CSP
 * and free of an untrusted-HTML surface. Built with `createElement` (no JSX) so
 * it stays a plain `.ts` module that unit-tests directly under Vitest's node env.
 *
 * Supported block syntax (blocks are separated by blank lines):
 *   ## Heading            → <h2>
 *   ### Heading           → <h3>
 *   - item / * item       → <ul>
 *   1. item               → <ol>
 *   > quote               → <blockquote> (used as a pull-quote / callout)
 *   plain text            → <p>
 *
 * Supported inline syntax:
 *   **bold**              → <strong>
 *   `code`                → <code>
 *   [text](https://…)     → <a> (external links get rel/target)
 */

type Block =
  | { kind: "h2" | "h3" | "p"; text: string }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "quote"; text: string };

const HEADING_RE = /^(#{2,3})\s+(.*)$/;
const UL_RE = /^[-*]\s+(.*)$/;
const OL_RE = /^\d+\.\s+(.*)$/;
const QUOTE_RE = /^>\s?(.*)$/;

/** Group the source lines into typed blocks. */
function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  // Consume one bullet/number/quote captor while the current line still matches.
  const consume = (re: RegExp): string[] => {
    const out: string[] = [];
    for (let line = lines[i] ?? ""; i < lines.length && re.test(line); line = lines[i] ?? "") {
      out.push((re.exec(line)?.[1] ?? "").trim());
      i += 1;
    }
    return out;
  };

  while (i < lines.length) {
    const line = lines[i] ?? "";

    // Blank line → block separator.
    if (line.trim() === "") {
      i += 1;
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      blocks.push({
        kind: heading[1]!.length === 2 ? "h2" : "h3",
        text: (heading[2] ?? "").trim(),
      });
      i += 1;
      continue;
    }

    if (UL_RE.test(line)) {
      blocks.push({ kind: "ul", items: consume(UL_RE) });
      continue;
    }

    if (OL_RE.test(line)) {
      blocks.push({ kind: "ol", items: consume(OL_RE) });
      continue;
    }

    if (QUOTE_RE.test(line)) {
      blocks.push({ kind: "quote", text: consume(QUOTE_RE).join(" ") });
      continue;
    }

    // Paragraph: consume consecutive plain lines until a blank or a block start.
    const paraLines: string[] = [];
    for (let l = lines[i] ?? ""; i < lines.length && l.trim() !== ""; l = lines[i] ?? "") {
      if (HEADING_RE.test(l) || UL_RE.test(l) || OL_RE.test(l) || QUOTE_RE.test(l)) break;
      paraLines.push(l.trim());
      i += 1;
    }
    blocks.push({ kind: "p", text: paraLines.join(" ") });
  }

  return blocks;
}

const INLINE_RE = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))/g;

/** Render inline **bold**, `code`, and [links](url) within a string. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let n = 0;
  // Reset because the regex is module-scoped and stateful with the /g flag.
  INLINE_RE.lastIndex = 0;

  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const key = `${keyPrefix}-i${n++}`;
    if (match[2] !== undefined) {
      nodes.push(h("strong", { key }, match[2]));
    } else if (match[4] !== undefined) {
      nodes.push(h("code", { key }, match[4]));
    } else if (match[6] !== undefined) {
      const href = match[7] ?? "";
      const external = /^https?:\/\//.test(href);
      nodes.push(
        h(
          "a",
          { key, href, ...(external ? { target: "_blank", rel: "noopener noreferrer" } : {}) },
          match[6],
        ),
      );
    }
    lastIndex = INLINE_RE.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

/** Render a Markdown-subset string to React nodes. */
export function renderMarkdown(md: string): ReactNode[] {
  return parseBlocks(md).map((block, idx) => {
    const key = `b${idx}`;
    switch (block.kind) {
      case "h2":
        return h("h2", { key }, renderInline(block.text, key));
      case "h3":
        return h("h3", { key }, renderInline(block.text, key));
      case "p":
        return h("p", { key }, renderInline(block.text, key));
      case "quote":
        return h("blockquote", { key }, renderInline(block.text, key));
      case "ul":
        return h(
          "ul",
          { key },
          block.items.map((it, j) => h("li", { key: `${key}-${j}` }, renderInline(it, `${key}-${j}`))),
        );
      case "ol":
        return h(
          "ol",
          { key },
          block.items.map((it, j) => h("li", { key: `${key}-${j}` }, renderInline(it, `${key}-${j}`))),
        );
    }
  });
}

/** Approximate reading time in whole minutes (200 wpm), floor of 1. */
export function readingTimeMinutes(md: string): number {
  const words = md
    .replace(/[#>*`_[\]()!-]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}
