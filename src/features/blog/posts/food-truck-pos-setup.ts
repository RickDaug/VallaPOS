import type { BlogPost } from "../types";

const post: BlogPost = {
  slug: "food-truck-pos-setup-15-minutes",
  title: "Set Up a Food-Truck Register in 15 Minutes",
  description:
    "A step-by-step guide to standing up a working point of sale for a food truck — menu, modifiers, staff PINs, and payments — in about fifteen minutes, on the phone you already own.",
  authorId: "rick-d",
  date: "2026-07-18",
  category: "How-to",
  tags: ["food truck", "setup", "menu", "getting started"],
  body: `When we watch someone set up VallaPOS for a food truck for the first time, the whole thing takes about fifteen minutes — and most of that is deciding on menu prices, not fighting the software. Here's the exact path, start to first sale.

You don't need to buy hardware to begin. It runs in the browser on the phone or tablet you already have. Add a printer later if you want one; you can take orders and money today.

## Minute 0–2: Get in and name the truck

Sign up, create your business, and set the basics — your truck's name and your currency. That's the account. There's nothing to install to get to a working register, though you can add VallaPOS to your home screen so it launches like an app and loads fast on-site.

Set your business type to a menu/food layout so the register is laid out for a kitchen rather than a retail shelf.

## Minute 2–8: Build the menu

This is the part that actually takes time, because it's *your* menu. Add your items with prices — the burgers, the tacos, the drinks, whatever you sell. A few tips that save real time:

- **Group items into categories** (Mains, Sides, Drinks) so the register screen stays fast to tap during a rush.
- **Use modifiers for the choices you repeat all day** — "no onions," "add cheese +$1," size options. Set an add-on's upcharge once and it applies every time.
- **Bulk-add if you're moving a menu over.** You can paste a whole list straight from a spreadsheet or notes and fix it up in a grid, instead of typing items one at a time.

Don't try to make it perfect. Get the ten or fifteen things you sell most into the register; you can refine the rest between customers this weekend.

## Minute 8–11: Set up how you get paid

Decide your tenders before the window opens, not during it. For a truck you almost always want:

- **Cash** — on by default. Keep a float to make change.
- **QR** — turn it on in Settings and point it at your existing payment handle (Venmo, PayPal, Cash App, PIX, UPI, or a payment link). The register will show it as a scannable code at the order's amount, the customer scans and pays, and you confirm.
- **"Other"** — for when you run a card on an external reader; it logs the sale so your totals still tie out.

VallaPOS doesn't take a cut of any of these, so what you ring is what you keep. (Built-in card processing is on the roadmap; for now an external reader logged as "Other" covers cards cleanly.)

## Minute 11–14: Add your crew

If someone else works the window, set them up with a **PIN**. Each person taps in their code to ring sales, so the day's totals show who sold what — handy when you're reconciling the drawer later. You control what each person can do: a window cashier can ring sales without being able to change prices or see the day's full report.

The device stays signed in; your staff just tap their PIN to become the active seller. When a shift changes, the next person taps in. No shared password, no logging the whole truck in and out.

## Minute 14–15: Ring a test sale and open the drawer

Before your first real customer:

1. **Open a cash-drawer session** with your starting float so the app knows your beginning cash.
2. **Ring up one item and complete a $0-stakes test sale** as cash, so you've seen the full flow once.
3. **Load the app on-site while you still have a good signal** — if the lot's connection gets crowded later, VallaPOS keeps ringing sales offline and syncs them when the signal returns.

That's the whole setup. Menu in, payments on, crew's PINs set, drawer open. At the end of the night you close the drawer and the app reconciles your counted cash against what you rang — so night one ends with numbers that tie out instead of a shoebox of receipts.

> Fifteen minutes to a working register, on a phone you already own, with no per-sale cut taken out of your window. Add a receipt printer and fancier reports when you're ready — none of it is in the way of selling lunch today.`,
};

export default post;
