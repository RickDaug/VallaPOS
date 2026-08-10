import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-xl border border-border bg-card text-card-foreground shadow-sm", className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 p-5", className)} {...props} />;
}

/**
 * `as` lets a card that IS the page's main heading render an `<h1>`.
 *
 * A card title is usually a section heading inside a page, so `h3` is the right
 * default. But the auth and onboarding screens are a single centred card, and
 * there the title is the only heading on the page — which left those pages with
 * NO `<h1>` and a document starting at `h3` (WCAG 1.3.1 heading order; also how
 * screen-reader and browser "jump to heading" navigation orients). Opting in per
 * page keeps every existing usage byte-for-byte unchanged.
 */
export function CardTitle({
  className,
  as: Tag = "h3",
  ...props
}: React.HTMLAttributes<HTMLHeadingElement> & { as?: "h1" | "h2" | "h3" }) {
  return <Tag className={cn("text-lg font-bold leading-tight", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5 pt-0", className)} {...props} />;
}
