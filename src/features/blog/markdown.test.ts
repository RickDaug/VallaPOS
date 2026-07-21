import { describe, it, expect } from "vitest";
import type { ReactElement } from "react";
import { renderMarkdown, readingTimeMinutes } from "./markdown";

// The renderer returns React elements (plain objects: { type, props }). We
// inspect them structurally — no DOM, no JSX — which keeps this a .test.ts that
// runs under Vitest's node environment.

type El = ReactElement<{ children?: unknown; href?: string; target?: string; rel?: string }>;

function isElement(node: unknown): node is El {
  return typeof node === "object" && node !== null && "type" in node && "props" in node;
}

/** Depth-first collect every element whose tag matches `type`. */
function findAll(nodes: unknown, type: string): El[] {
  const out: El[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (isElement(node)) {
      if (node.type === type) out.push(node);
      walk(node.props.children);
    }
  };
  walk(nodes);
  return out;
}

/** Flatten an element tree to its visible text. */
function textOf(nodes: unknown): string {
  let s = "";
  const walk = (node: unknown) => {
    if (node == null || typeof node === "boolean") return;
    if (typeof node === "string" || typeof node === "number") {
      s += String(node);
      return;
    }
    if (Array.isArray(node)) return node.forEach(walk);
    if (isElement(node)) walk(node.props.children);
  };
  walk(nodes);
  return s;
}

describe("renderMarkdown", () => {
  it("renders ## and ### as h2/h3", () => {
    const out = renderMarkdown("## Big\n\n### Small");
    expect(findAll(out, "h2")).toHaveLength(1);
    expect(findAll(out, "h3")).toHaveLength(1);
    expect(textOf(findAll(out, "h2")[0])).toBe("Big");
  });

  it("groups plain lines into a single paragraph", () => {
    const out = renderMarkdown("one\ntwo\n\nthree");
    const paras = findAll(out, "p");
    expect(paras).toHaveLength(2);
    expect(textOf(paras[0])).toBe("one two");
  });

  it("renders unordered lists with one <li> per bullet", () => {
    const out = renderMarkdown("- a\n- b\n- c");
    expect(findAll(out, "ul")).toHaveLength(1);
    expect(findAll(out, "li")).toHaveLength(3);
  });

  it("renders ordered lists", () => {
    const out = renderMarkdown("1. first\n2. second");
    expect(findAll(out, "ol")).toHaveLength(1);
    expect(findAll(out, "li")).toHaveLength(2);
  });

  it("renders blockquotes, merging consecutive > lines", () => {
    const out = renderMarkdown("> line one\n> line two");
    const quotes = findAll(out, "blockquote");
    expect(quotes).toHaveLength(1);
    expect(textOf(quotes[0])).toBe("line one line two");
  });

  it("renders **bold** as <strong>", () => {
    const out = renderMarkdown("plain **bold** end");
    const strong = findAll(out, "strong");
    expect(strong).toHaveLength(1);
    expect(textOf(strong[0])).toBe("bold");
    // Surrounding text is preserved.
    expect(textOf(out)).toBe("plain bold end");
  });

  it("renders `code` as <code>", () => {
    const out = renderMarkdown("use `npm run lint` please");
    const code = findAll(out, "code");
    expect(code).toHaveLength(1);
    expect(textOf(code[0])).toBe("npm run lint");
  });

  it("renders external [links](url) with target and rel", () => {
    const out = renderMarkdown("see [our site](https://vallapos.com) now");
    const links = findAll(out, "a");
    expect(links).toHaveLength(1);
    const link = links[0]!;
    expect(link.props.href).toBe("https://vallapos.com");
    expect(link.props.target).toBe("_blank");
    expect(link.props.rel).toBe("noopener noreferrer");
    expect(textOf(link)).toBe("our site");
  });

  it("renders internal links without target/rel", () => {
    const out = renderMarkdown("go to [sign up](/sign-up)");
    const link = findAll(out, "a")[0]!;
    expect(link.props.href).toBe("/sign-up");
    expect(link.props.target).toBeUndefined();
  });

  it("ignores blank lines without emitting empty paragraphs", () => {
    const out = renderMarkdown("\n\nhi\n\n\n");
    expect(findAll(out, "p")).toHaveLength(1);
  });
});

describe("readingTimeMinutes", () => {
  it("is at least 1 minute for short text", () => {
    expect(readingTimeMinutes("just a few words")).toBe(1);
  });

  it("scales roughly with word count (~200 wpm)", () => {
    const words = Array.from({ length: 600 }, () => "word").join(" ");
    expect(readingTimeMinutes(words)).toBe(3);
  });
});
