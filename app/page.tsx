import Link from "next/link";
import {
  Boxes,
  CreditCard,
  ReceiptText,
  Smartphone,
  Store,
  UtensilsCrossed,
  Users,
  WifiOff,
  Check,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STEPS = [
  {
    title: "Create your account",
    body: "Pick Store or Restaurant, tell us where you sell, and you're in — no card, no contract.",
  },
  {
    title: "Add what you sell",
    body: "Build your menu or catalog in minutes. We even drop in a sample item so you can try it right away.",
  },
  {
    title: "Ring up your first sale",
    body: "Tap items, take cash, card, or a QR payment, and hand over a receipt. That's it — you're live.",
  },
];

const FEATURES = [
  { Icon: Boxes, title: "Your whole catalog", body: "Items, variations, and modifiers — priced your way, ready to tap." },
  { Icon: CreditCard, title: "Take any payment", body: "Cash, card, or a scan-to-pay QR (PIX, Venmo, UPI, a payment link)." },
  { Icon: UtensilsCrossed, title: "Made for restaurants too", body: "Floor plan, open tabs, and split checks when you run a kitchen." },
  { Icon: Users, title: "Your team, controlled", body: "Add staff with PINs and give each person exactly the access they need." },
  { Icon: ReceiptText, title: "Sales you can see", body: "Orders, receipts, and reports so you always know how the day went." },
  { Icon: Smartphone, title: "Any device you own", body: "Phone, tablet, or laptop. If it has a browser, it's a register." },
];

const TRUST = [
  "No hardware to buy",
  "No monthly contract",
  "Works on the phone in your pocket",
  "Set up in a single sitting",
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Hero */}
      <section className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-6 pb-14 pt-16 text-center md:pt-24">
        <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 text-sm font-semibold text-primary">
          <WifiOff size={15} /> Browser POS · No hardware
        </span>
        <h1 className="text-4xl font-black tracking-tight md:text-6xl">
          Sell from any device,
          <br className="hidden sm:block" /> starting today.
        </h1>
        <p className="max-w-xl text-lg text-muted-foreground">
          VallaPOS turns the phone, tablet, or laptop you already own into a full point of
          sale. No hardware contract. No complicated setup. Open a browser and sell.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link href="/sign-up" className={cn(buttonVariants({ variant: "primary", size: "lg" }))}>
            Start selling — it&apos;s free
          </Link>
          <Link href="/sign-in" className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>
            Sign in
          </Link>
        </div>
        <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 pt-2 text-sm text-muted-foreground">
          {TRUST.map((t) => (
            <li key={t} className="inline-flex items-center gap-1.5">
              <Check size={15} className="text-primary" /> {t}
            </li>
          ))}
        </ul>
      </section>

      {/* How it works */}
      <section className="border-t border-border bg-card/40 px-6 py-14">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-center text-2xl font-black md:text-3xl">Up and running in 3 steps</h2>
          <p className="mx-auto mt-2 max-w-md text-center text-muted-foreground">
            Most merchants take their first sale the same day they sign up.
          </p>
          <ol className="mt-10 grid gap-6 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="rounded-xl border border-border bg-card p-6">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-lg font-black text-primary-foreground">
                  {i + 1}
                </span>
                <h3 className="mt-4 font-bold">{step.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Features */}
      <section className="px-6 py-14">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-2xl font-black md:text-3xl">Everything the counter needs</h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ Icon, title, body }) => (
              <div key={title} className="rounded-xl border border-border bg-card p-6">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon size={20} />
                </span>
                <h3 className="mt-4 font-bold">{title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Free / no-hardware framing */}
      <section className="border-t border-border bg-card/40 px-6 py-14">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 text-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 text-sm font-semibold text-primary">
            <Store size={15} /> Built for small, mobile businesses
          </span>
          <h2 className="text-2xl font-black md:text-3xl">Free to start. Nothing to plug in.</h2>
          <p className="max-w-xl text-muted-foreground">
            Skip the pricey terminal and the wait for a card reader in the mail. VallaPOS runs
            in the browser you already have, so a market stall, a food truck, or a shop counter
            can be selling in minutes — not weeks.
          </p>
          <Link
            href="/sign-up"
            className={cn(buttonVariants({ variant: "primary", size: "lg" }), "mt-2")}
          >
            Create your free account
          </Link>
          <p className="text-sm text-muted-foreground">
            Already selling with us?{" "}
            <Link href="/sign-in" className="font-semibold text-primary underline">
              Sign in
            </Link>
          </p>
        </div>
      </section>

      <footer className="px-6 py-8 text-center text-sm text-muted-foreground">
        <span className="font-black tracking-tight text-foreground">VallaPOS</span> · The
        point of sale that fits in your pocket.
      </footer>
    </main>
  );
}
