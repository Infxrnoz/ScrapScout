# RustScout Pro licensing

Keys look like `RS1-<payload>.<signature>`. They are signed with `private.pem` (stays on your PC, never commit it; git ignores it). The app only has the public key, so it checks keys offline.

## Give someone a key by hand

```
node licensing/issue.js "their@email.com"
```

## Stripe setup

1. Stripe Dashboard → Product catalogue → add **RustScout Pro** (one-time price).
2. Payment Links → create one for it. Under **After payment**, choose **Don't show confirmation page → Redirect** to
   `https://<your-worker>.workers.dev/success?session_id={CHECKOUT_SESSION_ID}`
3. Deploy `stripe-worker.js` as a Cloudflare Worker (free):
   ```
   npx wrangler deploy licensing/stripe-worker.js --name rustscout-pro --compatibility-date 2026-10-01
   npx wrangler secret put STRIPE_SECRET_KEY --name rustscout-pro
   npx wrangler secret put LICENSE_PRIVATE_KEY --name rustscout-pro
   ```
   For `STRIPE_SECRET_KEY` use a **restricted key** with only *Checkout Sessions: Read*. For `LICENSE_PRIVATE_KEY` paste the whole contents of `private.pem`.
4. Put the Payment Link URL in `BUY_URL` at the top of `public/js/pro.js`, so the app shows a **Get Pro** button.

Test the whole flow with Stripe test mode first (card `4242 4242 4242 4242`).

Back up `private.pem` somewhere safe. If it's lost, existing keys keep working but you can't make new ones. If it leaks, anyone can make keys.
