import type { Author } from "./types";

/**
 * Post authors. Two voices, deliberately distinct:
 * - Terry writes the hands-on, from-the-stall how-tos.
 * - Rick writes the product + principles pieces.
 */
export const AUTHORS: Record<string, Author> = {
  "terry-b": {
    id: "terry-b",
    name: "Terry B.",
    role: "Field notes, VallaPOS",
    bio: "Terry spent a decade behind market stalls and a coffee cart before joining VallaPOS. He writes the practical guides — the stuff you actually do at 6 a.m. before the first customer shows up.",
    initials: "TB",
  },
  "rick-d": {
    id: "rick-d",
    name: "Rick D.",
    role: "Founder, VallaPOS",
    bio: "Rick builds VallaPOS. He writes about why the product works the way it does — and why a register for a one-person business should never take a cut of the sale.",
    initials: "RD",
  },
};

export function getAuthor(id: string): Author {
  const author = AUTHORS[id];
  if (!author) throw new Error(`Unknown blog author: ${id}`);
  return author;
}
