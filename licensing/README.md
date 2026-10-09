# RustScout Pro licensing

Keys look like `RS1-<payload>.<signature>`. They are signed with `private.pem` (stays on your PC, never commit it; git ignores it). The app only has the public key.

Each key works on **one PC at a time**. The first time someone clicks **Activate**, the app sends the key and an anonymous PC ID to the worker. The worker remembers which PC owns the key and sends back a signed activation (`RA1-…`) for that PC, so the app works offline after that. Another PC is refused until **Remove key** is clicked on the first one. A key can move PCs 3 times per 30 days.

## Give someone a key by hand

```
node licensing/issue.js "their@email.com"
```

The email or name is readable inside the key, so only put in what the buyer is fine with.

## Activate your own PC without the worker

```
node licensing/activate-here.js
```

Signs an activation for this PC with your private key and writes it to your RustScout config. Restart RustScout afterwards.

## Cloudflare Worker setup (Stripe + activation)

1. Make a free Cloudflare account, then log in from this folder:
   ```
   npx wrangler login
   ```
2. Create the storage that remembers which PC owns each key:
   ```
   npx wrangler kv namespace create LICENSES
   ```
   It prints an `id`. Put it in a file `licensing/wrangler.toml`:
   ```toml
   name = "rustscout-pro"
   main = "stripe-worker.js"
   compatibility_date = "2026-10-01"
   kv_namespaces = [{ binding = "LICENSES", id = "PASTE_ID_HERE" }]
   ```
3. Deploy and add the secrets:
   ```
   cd licensing
   npx wrangler deploy
   npx wrangler secret put LICENSE_PRIVATE_KEY
   npx wrangler secret put STRIPE_SECRET_KEY
   ```
   For `LICENSE_PRIVATE_KEY` paste the whole contents of `private.pem`. For `STRIPE_SECRET_KEY` use a **restricted key** with only *Checkout Sessions: Read*.
4. The deploy prints the worker address, like `https://rustscout-pro.<you>.workers.dev`. If it isn't `https://rustscout-pro.infxrnoz.workers.dev`, change `LICENSE_SERVER` in `server.js`.

## Stripe

1. Stripe Dashboard → Product catalogue → add **RustScout Pro** (one-time price).
2. Payment Links → create one for it. Under **After payment**, choose **Redirect** to
   `https://<your-worker>/success?session_id={CHECKOUT_SESSION_ID}`
3. Put the Payment Link URL in `BUY_URL` at the top of `public/js/pro.js` and on the website.
4. Only give keys for this product: copy the Payment Link's id (`plink_…`) and run
   ```
   npx wrangler secret put PAYMENT_LINK_ID
   ```
5. Turn off keys automatically on refunds and chargebacks: Developers → Webhooks → Add endpoint
   `https://<your-worker>/stripe-webhook` with the events `charge.refunded` and `charge.dispute.created`. Copy its signing secret (`whsec_…`) and run
   ```
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   ```
   Only full refunds turn a key off. The app checks in at start and every 12 hours, so Pro switches off on that PC soon after.

## Team keys (duo, trio, quad)

One key that works on several PCs at once. Make a Payment Link per team size in Stripe (same redirect as above), then tell the worker which link is which size:

```
npx wrangler secret put TEAM_LINKS
```

and paste something like `{"plink_duoID":2,"plink_trioID":3,"plink_quadID":4}`. Keys bought through those links work on that many PCs; the success page tells the buyer to share it with their team. By hand: `node licensing/issue.js "their@email.com" 4`.

## Turn a key off by hand

```
node licensing/revoke.js RS1-...
node licensing/revoke.js RS1-... --undo
```

Test with Stripe test mode first (card `4242 4242 4242 4242`).

Back up `private.pem` somewhere safe. If it's lost, existing keys keep working but you can't make new ones. If it leaks, anyone can make keys.
