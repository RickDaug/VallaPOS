import type { BlogPost } from "../types";

const post: BlogPost = {
  slug: "keep-selling-offline-no-wifi",
  title: "Offline Mode, Explained: How to Keep Selling When the Wi-Fi Drops",
  description:
    "A plain-language guide to how an offline-ready POS keeps ringing up sales with no signal — what works, what waits, and how to set it up so a dead connection never stops the line.",
  authorId: "terry-b",
  date: "2026-07-07",
  category: "How-to",
  tags: ["offline", "no wifi", "reliability", "setup"],
  body: `The first time my signal died on me was in the basement level of a food hall, halfway through a Saturday lunch rush. Three bars in the morning, nothing by noon — a hundred phones in a concrete room had strangled the tower. The card-reader stall across from me just stopped. Handwritten IOUs, a line out the door, a very bad afternoon. I was taking cash and kept moving.

Offline mode is the insurance against that afternoon — and it's worth understanding before the tower quits on you, not during.

## Why the signal dies exactly when you're busy

It's almost never random. The connection drops the minute a crowd shows up, because everyone's phone is fighting for the same tower at once. Basements, metal-roofed markets, festival fields, a truck lot tucked behind a building — those are the spots where you'll be busiest *and* least connected. Any register that needs a live connection to ring up a sale will pick that exact moment to freeze.

A stronger signal isn't the fix. A register that doesn't need one for the basic job is.

## What keeps working when you're cut off

VallaPOS runs in your browser and is built to keep going when the connection doesn't. Cut the signal and:

- Your menu, prices, and modifiers are already loaded, so you keep tapping out orders like nothing happened.
- Cash sales don't touch the internet — they're recorded right there on your device.
- Every sale is tucked into a queue on the device instead of vanishing.
- The moment you're back online, that queue empties itself into your reports and totals. Nothing gets re-typed.

So the register keeps doing the one thing a rush actually demands: take the order, take the money, hand over the food, next.

## What waits for the bars to come back

A couple of things genuinely need the outside world, and they'll sit tight until you have it:

- **Emailing a receipt** has to reach a mail server, so it queues and sends once you reconnect.
- **App payments lean on the customer's phone**, not just yours. If the whole room's signal is down, their Venmo or PIX may not go through either. In a true dead zone, cash is the tender you can count on — which is exactly why the float in your apron matters.
- **Syncing across two devices** catches up when both are back online. During an outage, keep ringing on the one device holding the queue.

None of that touches the sale in front of you. Those few online-only jobs just run the instant you reconnect — you don't babysit them.

## Prove it to yourself before it counts

Trust comes from having watched it work when nothing was at stake. Five minutes at the kitchen table:

1. Open VallaPOS on a good connection so the app and your whole catalog load onto the device.
2. If your phone offers to add it to the home screen, do it — it launches faster and behaves like a real app.
3. Flip on airplane mode and ring up a pretend $5 cash sale. Watch it go all the way through.
4. Turn the connection back on and watch that test sale drop into your reports on its own.

Once you've seen a sale survive airplane mode and reappear in your totals, the mid-rush outage stops being scary. You already know precisely what happens, because you've seen it.

## A quick pre-event checklist

Before anything where you expect a weak signal:

- Load the app on-site early, while there's still signal to spare.
- Bring a cash float — it's the one tender that works when nobody's data does.
- Ring on the single device that holds the offline queue; don't split one event across two disconnected phones.
- After the event, confirm the queue drained. You'll see the synced sales land, and VallaPOS pops a note when your offline sales have finished catching up.

The point was never to pretend the internet is reliable. It's that when it quits on you — and in the busy spots, it will — the only thing that changes is a receipt sends a few minutes late. The stall across the food hall learned that the hard way. You don't have to.`,
};

export default post;
