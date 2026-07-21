import type { BlogPost } from "../types";

const post: BlogPost = {
  slug: "cash-card-qr-what-to-accept",
  title: "Cash, Card, or QR: What Should a Small Vendor Actually Accept?",
  description:
    "A practical guide to choosing payment methods for a market stall, food truck, or one-chair shop — the real trade-offs of cash, cards, and QR, and how to decide.",
  authorId: "rick-d",
  date: "2026-07-11",
  category: "Guide",
  tags: ["payments", "cash", "card", "qr", "small business"],
  body: `"What payments should I take?" is one of the first questions every new seller asks, and the usual answer — "all of them!" — isn't actually helpful. Every tender has a cost and a failure mode. Here's how to think about it if you run a stall, a truck, or a one-chair shop.

## Cash: still the backbone

Cash is unglamorous and still the most reliable money you can take.

- **Upside:** No fees. No connection needed. No device between you and the sale. It clears instantly and it never declines.
- **Downside:** You have to make change, keep a float, and count it at the end of the day. It can be lost or miscounted, and some customers genuinely don't carry it anymore.

For most small vendors, cash should stay a first-class tender, not a fallback. It's the only money that still clears when the signal dies or a reader drops its connection. Reconcile it against your register total at close and a miscount surfaces the same day, not at tax time.

## Cards: convenient, and never free

Card acceptance is what most customers *expect*, and it's the tender people reach for without thinking.

- **Upside:** Fast, expected, no change to make, and it nudges average ticket size up a little.
- **Downside:** It skims a percentage off every sale — usually in the 2.6–2.9% range, with a fixed few cents on top of each transaction — and it needs both a live connection and a reader. It's the tender most likely to fail in a dead zone.

The mistake to avoid is treating the card fee as free because it's invisible. At a few thousand dollars a month in card sales, that percentage becomes one of your larger recurring costs. Accept cards — customers want them — but know the number and factor it into your prices.

## QR / app payments: the cheap middle ground

This is the tender most small vendors underuse. You show a code for a payment handle you already have — Venmo, PayPal, Cash App, PIX, UPI, or a payment link — the customer scans it and pays you directly.

- **Upside:** Usually far cheaper than card processing (often free between individuals), no extra hardware, and money lands straight in your account.
- **Downside:** It leans on the customer having the right app and a signal. And unless you've wired up a processor-backed setup, it's *confirm-based*: the code carries your handle, the customer keys in the amount, and you verify the "sent" screen yourself — no automatic settlement.

For a lot of markets and trucks, QR is the sweet spot: card-like convenience without the card-like fee. The trick is making it fast, which is where a register helps.

## How VallaPOS handles all three

The reason to run these through one register instead of juggling a cash box, a card reader, and a phone is that your **totals stay in one place**. In VallaPOS the tender step gives you:

- **Cash** — records the sale and helps you reconcile the drawer at close.
- **QR** — puts *your* payment handle on screen as a scannable code with the order total beside it; the customer scans, keys in that amount, pays, and you confirm the sale.
- **Other** — logs a sale you collected some other way (an external card reader, a check, a transfer) so your day's numbers still add up.

Because it all flows into one set of reports, end-of-day reconciliation is one number to check, not three. And VallaPOS doesn't take a percentage of any of it — cash, QR, and "Other" are all yours.

> One record per sale, whatever the tender. That's the real reason to run payments through a register instead of three separate tools that never agree at closing time.

## So what should *you* accept?

A simple decision guide:

1. **Always take cash.** It's free and it's your no-signal safety net.
2. **Add QR next.** It's cheap, needs no hardware, and covers the "I don't carry cash" customer. Set your handle once and you're done.
3. **Add cards when the volume justifies the fee** — when enough customers ask, or your average ticket is high enough that losing the sale costs more than the ~3%.

You don't have to accept everything on day one. Cash plus QR is free or close to it and already covers most customers; add card processing the month the sales you're losing without it clearly outweigh the ~3% you'll pay to have it. Run whichever tenders you land on through one register, so at close you're checking a single set of numbers instead of reconciling a cash box, a reader, and a phone that never quite agree.`,
};

export default post;
