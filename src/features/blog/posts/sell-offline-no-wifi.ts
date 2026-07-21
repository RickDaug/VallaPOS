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
  body: `The worst time to learn how your register handles a dropped connection is in the middle of a rush. So let's cover it now, calmly, with no line out the door.

Here's the short version: with VallaPOS, a dead connection doesn't stop you selling. The longer version — what keeps working, what quietly waits, and how to set it up so you trust it — is worth ten minutes.

## Why connections drop right when you're busy

It's almost never random. The signal dies exactly when a crowd shows up, because everyone's phone is hitting the same tower at once. Basement venues, metal-roofed markets, festival fields, a food-truck lot behind a building — these are the places you'll be busiest *and* least connected. Any register that needs a live connection to ring up a sale will pick that moment to freeze.

The fix isn't a stronger signal. It's a register that doesn't need one to do the basic job.

## What "offline mode" actually means here

VallaPOS runs in your browser, and it's built to keep working when the connection doesn't. When you go offline:

- **You keep ringing up items.** Your catalog, prices, and modifiers are already loaded, so the menu still works.
- **You keep taking cash.** A cash sale doesn't need the internet — VallaPOS records it right there on your device.
- **Each sale is saved to a queue** on your device instead of being lost.
- **When the connection comes back, the queue syncs by itself.** Those sales flow into your reports and totals. You don't re-type anything.

So the register keeps doing the thing you actually need in a rush: take the order, take the money, hand over the goods, move to the next person.

## What waits for the connection to return

Being honest about the edges matters, because it's how you learn to trust the tool:

- **Anything that needs the outside world waits.** Emailing a receipt, for example, needs a connection to send — that one queues until you're back online.
- **App-based / QR payments depend on the customer's phone reaching *their* payment app.** If the whole area's signal is down, their Venmo or PIX may not go through either. In a total dead zone, cash is the reliable tender — which is exactly why you keep a float.
- **Syncing across two devices** catches up when both are back online. During an outage, keep taking orders on the one device that has the queue.

None of that stops the sale in front of you. It just means a few "reach the internet" tasks politely wait their turn.

## Set it up so you trust it (do this once)

Confidence comes from having tried it before it mattered. Five minutes at home:

1. **Open VallaPOS while you have a good connection** so the app and your catalog are fully loaded on the device.
2. **Install it to your home screen** if your phone or tablet offers to. It launches faster and behaves like an app.
3. **Turn on airplane mode and ring up a test sale.** Watch it go through. Take a pretend $5 cash sale and complete it.
4. **Turn the connection back on** and watch the test sale sync into your reports.

Once you've seen a sale survive airplane mode and reappear in your totals, the mid-rush outage stops being scary. You already know exactly what happens.

## A short field checklist

Before an event where you expect a weak signal:

- Load the app on-site early, while there's still signal to spare.
- Carry a **cash float** — it's your guaranteed tender when nobody's data works.
- Keep selling on the **one device** holding the offline queue; don't split the same event across two disconnected devices.
- After the event, confirm the queue drained — you'll see the synced sales land in your totals, and VallaPOS flags when offline sales have finished syncing.

> The goal isn't to pretend the internet never fails. It's to make sure that when it does, the only thing that changes is a receipt sends a few minutes late.

Set it up once, test it in airplane mode, and a dropped connection turns from a disaster into a non-event. That's the whole point of offline mode — you stop thinking about the signal and get back to selling.`,
};

export default post;
