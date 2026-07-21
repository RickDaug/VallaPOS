import type { BlogPost } from "../types";

const post: BlogPost = {
  slug: "barbershop-end-of-day-cash-count",
  title: "The 5-Minute End-of-Day Cash Count for a Barbershop",
  description:
    "A simple closing routine for a barbershop or one-chair salon: count the drawer, reconcile against your register, and catch mistakes the same day instead of at tax time.",
  authorId: "terry-b",
  date: "2026-07-15",
  category: "How-to",
  tags: ["barbershop", "cash drawer", "reconciliation", "closing"],
  body: `A barber I know found out in March that he'd been $20-to-$40 short most nights the previous fall. He only noticed because his accountant flagged it. By then the trail was cold — no way to tell a miscount from a mistake from something worse.

A five-minute count at close would have caught it the same night. Here's the routine.

## Why you count every night, not every quarter

The point of a nightly count isn't to be fussy. It's that a discrepancy is *solvable* on the day it happens and basically unsolvable a month later.

If tonight's drawer is $15 short, you can usually reconstruct why: a walk-in you rang up wrong, change handed back from the wrong slot, a tip that went in the drawer instead of the jar. If you find that same $15 gap averaged across sixty nights on a spreadsheet in spring, all you can do is shrug and eat it. Same-day is the difference between a fixable mistake and a mystery.

## The routine, step by step

At close, before you cash out and lock up:

1. **Stop taking sales.** Ring the last customer, then close the register for the day.
2. **Count the physical cash** in the drawer. Bills and coins, actual money in hand.
3. **Subtract your starting float** — the cash you put in this morning to make change. What's left is the cash you *took* today.
4. **Compare it to what the register says you took in cash.** Those two numbers should match.
5. **Note any difference and its likely cause** while the day is still fresh in your memory.

That's it. The whole thing is a couple of minutes once it's a habit.

## Let the register do the subtraction

Doing steps 3 and 4 in your head is where errors creep in. This is exactly what a cash-drawer session is for.

In VallaPOS you **open a drawer** at the start of the day with your float, and **close it** at the end by entering what you counted. The app already knows how much cash it rang up, so it does the reconciliation for you: it shows your **counted cash**, your **expected cash**, and the **difference** — over, short, or exactly right.

- **Exactly right:** great, lock up.
- **Short:** you'll see it tonight and can usually place it before you leave.
- **Over:** just as worth knowing — it often means a sale got rung wrong, which matters for your tax numbers too.

Because card, QR, and "Other" sales are tracked separately from cash, you're only ever reconciling the physical money against the cash the register expected — not chasing a total that mixes in tender you never held in your hand.

> A drawer that's off by a dollar or two most nights is normal. A drawer that's off by the same amount in the same direction, night after night, is a pattern — and patterns are the ones worth chasing down.

## Reading the week, not just the night

Once you're counting nightly, the end-of-day report becomes a quiet management tool:

- **Sales by cashier.** If you've got a second chair, you can see each person's rung sales — useful when a shortage always lands on the same shift.
- **Tender breakdown.** How much came in as cash versus QR versus an outside card reader, so you know what's actually funding the shop.
- **The daily total**, captured cleanly each night instead of reconstructed from a shoebox of receipts at tax time.

## Make it a habit, not a chore

Two things keep this from slipping:

- **Same time, every close.** Tie it to locking the front door. Count, close the drawer, then flip the sign.
- **Write down the "why" on any gap**, even a small one. A one-line note tonight beats a guess in April.

Five minutes a night buys you a shop where the money always ties out and surprises get caught while you can still do something about them. My friend counts every night now. He hasn't had a mystery shortage since.`,
};

export default post;
