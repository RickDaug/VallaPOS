import type { BlogPost } from "../types";

const post: BlogPost = {
  slug: "pos-that-doesnt-take-a-cut",
  title: "Why Your POS Shouldn't Take a Cut of Every Sale",
  description:
    "Percentage-of-sales pricing quietly scales your software bill with your success. Here's the math on flat pricing — and why we built VallaPOS to never take a cut.",
  authorId: "rick-d",
  date: "2026-06-30",
  category: "Opinion",
  tags: ["pricing", "fees", "small business", "payments"],
  body: `Most point-of-sale companies make a quiet bet: the more you sell, the more you pay them. It's the default model, it's rarely questioned, and for a small business it's the wrong deal. I want to walk through why, with actual numbers.

## The fee is a tax on doing well

A typical processor takes somewhere around 2.6% to 2.9% plus a fixed fee on each card sale. Call it roughly 3% for round numbers. That percentage doesn't care whether it was a great month or a terrible one. It scales with *you*.

Run the math on a small operation doing $8,000 a month in card sales:

- At ~3%, that's about **$240 a month** — roughly **$2,880 a year** — going to your software and processing stack.
- Have a good year and clear $12,000 a month? The bill climbs to about **$360 a month** with no new features, no extra service. You just sold more.

The uncomfortable part is that the cost is invisible. It's skimmed off each sale before the money ever reaches you, so it never shows up as a bill you consciously approve. It's the most expensive line item you never look at.

## What you're actually paying for

There are two different things bundled inside that percentage:

1. **Moving the money** — the card networks and the processor genuinely have costs, and someone has to cover them.
2. **The software** — the register, the catalog, the reports, the receipts.

The second one has nothing to do with how much you sell. A register that rings up $12,000 costs the company that makes it exactly the same to run as one that rings up $4,000. Charging more because you sold more isn't pricing the software — it's pricing *you*.

## How we priced VallaPOS instead

We split those two things apart on purpose.

- **The software is a flat price.** VallaPOS Cloud is **$19.99 a month**, whatever you sell. If you'd rather not pay monthly at all, the offline desktop edition is a **one-time $99** — you buy it once and it's yours.
- **VallaPOS never takes a percentage of your sales.** Not on cash, not on QR, not on anything you ring up. When card processing arrives, the plan is direct: you connect your own payment account, you're the merchant of record, and the processor's fee is between you and them. We don't sit in the middle taking a slice.

At $8,000 a month in sales, flat pricing is about **$20** where a 3% model is about **$240**. That gap is real money — it's a slow month's rent, a new piece of equipment, or just staying in business.

> A one-person business shouldn't have a software bill that grows every time it has a good day. That's the whole principle.

## The honest counter-argument

Percentage pricing isn't a scam. For a brand-new seller doing $500 a month, 3% is $15 — cheaper than a $20 subscription, and you pay nothing on a dead month. If you're truly just starting and volume is tiny, a pay-per-swipe tool can be the right first step.

The model turns against you the moment you get traction. Somewhere around a few thousand dollars a month, the percentage quietly overtakes a flat fee and never looks back — and it keeps climbing for the rest of the time you use it. Flat pricing is the bet that you're going to grow, and that your software bill shouldn't grow with you.

## What to ask before you sign up

When you're comparing registers, get a straight answer to three questions:

- **Do you take a percentage of my sales?** If yes, model it at the volume you *expect to hit*, not today's.
- **What do I pay on a cash sale?** With a lot of tools, "free" cash handling still rides on a plan you're paying for because of card volume.
- **If I stop paying, do I keep anything?** A one-time license you own behaves very differently from a subscription that switches off.

We built VallaPOS around a simple answer to the first question: no. The rest of the product follows from that.`,
};

export default post;
