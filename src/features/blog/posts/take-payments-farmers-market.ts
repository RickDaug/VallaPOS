import type { BlogPost } from "../types";

const post: BlogPost = {
  slug: "take-payments-farmers-market",
  title: "How to Take Payments at a Farmers Market (Cash, QR, and No Signal)",
  description:
    "A stall-tested way to accept cash and QR payments at a farmers market — including how to keep ringing up sales when the cell signal drops mid-morning.",
  authorId: "terry-b",
  date: "2026-06-23",
  category: "How-to",
  tags: ["farmers market", "payments", "cash", "qr", "offline"],
  body: `The tent next to me at the Saturday market has a hand-lettered sign: "CASH ONLY — Venmo @greenrow." Every third customer squints at it, digs for bills, comes up short, and walks off. That sign is costing them a sale an hour.

You don't need a fancy setup to fix that. You need three ways to get paid and a plan for when the signal drops. Here's the exact routine I use.

## Start with the three tenders that actually matter

For a market stall, you want to accept money in three forms, in this order of how often you'll use them:

- **Cash.** Still king at most markets. Keep a float of small bills and count it before you open.
- **QR / app payment.** Your existing Venmo, PayPal, Cash App, PIX, or UPI handle, shown as a scannable code. The customer scans, pays, and shows you the confirmation.
- **"Other" — an external card reader.** If you carry a tap reader, you can still log that sale in your register so your totals match at the end of the day.

VallaPOS gives you all three at the tender step: **Cash**, **QR**, and **Other**. You're not signing up for a payment processor or waiting on an approval — QR just shows *your* payment handle as a code, and "Other" records a sale you collected some other way so your books stay straight.

## Set up your QR once, before the season starts

This is the part people skip, and it's a five-minute job:

1. In VallaPOS, open **Settings** and turn on QR payments.
2. Pick your handle — a PIX key, a UPI id, your Venmo or PayPal.me link, or any payment-link URL.
3. Save it. From now on, the tender screen shows a **QR** option, and tapping it displays your code at the order's amount so the customer can scan it.

Now when someone says "can I Venmo you?", you tap **QR**, they scan the code on your screen, they pay, they turn the phone around to show you the "sent" screen, and you confirm. No typing your handle out loud over a noisy crowd. No wondering whether the money landed in the right account.

> One honest note: this kind of QR is *confirm-based*. You're eyeballing the customer's payment confirmation, the same as you would today — VallaPOS isn't holding the money or auto-verifying it. What it adds is speed and a clean record of the sale.

## The move that saves your Saturday: keep selling with no signal

Here's the scenario that ruins mornings. It's 10 a.m., the market's packed, everyone's phone is fighting for the same tower, and your data drops to nothing. A cash-only stall is fine. A stall that depends on a live connection is now taking IOUs.

VallaPOS runs in your browser and keeps working when the connection doesn't. If you lose signal:

- You keep ringing up items and taking **cash** exactly as before.
- Each sale is saved on your device in a queue.
- When your signal comes back, the queued sales **sync automatically** and land in your reports — you don't re-enter anything.

The practical upshot: you never stop the line because of a bad connection. You ring the sale, take the cash, hand over the tomatoes, and the bookkeeping catches up on its own when the bars come back.

## A 60-second open-and-count routine

Do this before your first customer and your day runs clean:

1. **Count your cash float** and open a drawer session in VallaPOS so the app knows your starting cash.
2. **Confirm your QR handle** is the right one for this market (some vendors keep a separate account per market — check it).
3. **Load the browser once while you still have signal** so the app is ready to run offline if the tower gets busy later.

At the end of the day, close the drawer and the app reconciles what you counted against what you rang — cash, QR, and "Other" all in one total. If the numbers are off, you'll know before you drive home, not three weeks later.

## What this costs you

Nothing per sale. VallaPOS doesn't take a percentage of what you ring up — your Venmo, cash, and card reader money is yours. That matters at a market where a "small" 2.9% card fee is the difference between a good Saturday and a break-even one.

Set the three tenders up once, count your float, and let the offline queue handle the dead-signal hour. That's the whole system. The stall next to me is welcome to borrow it.`,
};

export default post;
