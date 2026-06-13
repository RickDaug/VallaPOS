/** Tiny class-name joiner (avoids pulling in a dependency for the scaffold). */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
