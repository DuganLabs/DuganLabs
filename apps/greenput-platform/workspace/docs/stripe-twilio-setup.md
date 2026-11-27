# Stripe and Twilio setup

What the API Worker reads, where the value lives, and the Dashboard steps
that code cannot do. This repo does not change production secrets and
does not deploy. Putting a value in Doppler does nothing until the next
production deploy runs the secret-push step.

## Where values come from

Production secret push: `.github/workflows/ci.yml` ("Push Cloudflare
Worker secrets") and the same block in `scripts/deploy/local.sh`.

When `DOPPLER_TOKEN` is set, that step runs `doppler run` against
`greenput/repository` (`doppler.yaml`). A missing token warns and
continues with GitHub only — Twilio and Stripe are then skipped, because
those `put` lines have no GitHub fallback.

| Worker binding | Source | Pushed by |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | Doppler `greenput/repository`. Stripe → Developers → API keys → Secret key (`sk_`). | Production `put` only |
| `STRIPE_PUBLISHABLE_KEY` | Doppler. Same page, Publishable key (`pk_`). The deposit page and `lib/deposits.ts` hand it to the browser. Absent, `POST /api/public/deposits/:token/session` answers 503. | Production `put` only |
| `STRIPE_WEBHOOK_SECRET` | Doppler. Signing secret of the webhook endpoint below (`whsec_`). | Production `put` only |
| `TWILIO_ACCOUNT_SID` | Doppler. Twilio console → Account SID. | Production `put` only |
| `TWILIO_AUTH_TOKEN` | Doppler. Twilio console → Auth token. | Production `put` only |
| `TWILIO_FROM_NUMBER` | Doppler. The Twilio number SMS is sent from, E.164. | Production `put` only |
| `ADMIN_SETUP_TOKEN` | GitHub environment secret, read as `GH_ADMIN_SETUP_TOKEN` when Doppler has none. Production and staging must differ. | Production and staging |
| `CALLS_APP_ID`, `CALLS_APP_SECRET` | Doppler, else the GitHub secret of the same name. | Production |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions secrets. Not Worker bindings. | Deploy jobs |

Staging's secret step pushes **only** `ADMIN_SETUP_TOKEN`. It does not
push Stripe or Twilio, on purpose: a non-production Worker must not text
or charge. Staging and preview also have no lead-fee cron.

`STRIPE_CONNECT_CLIENT_ID` is not a Worker binding. Connect onboarding is
Express account links (`POST /v1/account_links`), not OAuth, and nothing
reads a client id. Do not add it back. If an older deploy stored that
secret on `greenput-api`, delete it by hand in the Cloudflare dashboard
or with `wrangler secret delete STRIPE_CONNECT_CLIENT_ID` — this change
does not.

There is no Twilio Messaging Service SID in this code. SMS uses the
Account SID, auth token, and from-number directly.

## Stripe Dashboard

Do these in the same Stripe account the secret key belongs to (test mode
until the pilot is ready for live charges).

1. **API version.** The sandbox webhook endpoint
   `we_1UTAZ8RrRXN2HLsDqQ6ZIZms` is pinned to `2025-02-24.acacia`. The
   Worker sends `Stripe-Version: 2025-02-24.acacia` on every request
   (`STRIPE_API_VERSION` in `apps/api/src/lib/stripe.ts`). New webhook
   endpoints must use that same version. Do not bump the endpoint without
   bumping the constant: Basil (`2025-03-31.basil`) moved
   `current_period_start` / `current_period_end` onto subscription items
   and removed `invoice.subscription`. The code reads both shapes, but
   the pin is what the running webhook actually sends.

2. **Connect.** Settings → Connect → enable Connect, platform type
   Express. Onboarding from the product is Settings → Billing → Card
   payments, which calls `POST /api/payments/connect/onboard` (account
   link) and, once `charges_enabled` and `payouts_enabled` are both true,
   `POST /api/payments/connect/login`. No OAuth redirect URI and no
   Connect client id.

3. **Customer Portal.** Settings → Billing → Customer portal → activate a
   configuration that lets a customer update their payment method.
   Settings → Billing → "Add a card for lead fees" opens that portal
   (`POST /api/billing/payment-method`), creating the Stripe customer
   first when the workspace has none. The existing "Open Stripe portal"
   button still requires a customer and still returns `NO_CUSTOMER`
   until one exists — it manages the subscription, not the first card.

4. **Webhook.** Developers → Webhooks → the endpoint above (or add
   `https://api.greenput.com/api/payments/webhook`) on API version
   `2025-02-24.acacia`. Subscribe at least:
   `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed`,
   `invoice.marked_uncollectible`, `invoice.voided`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `payment_intent.succeeded`, `payment_intent.payment_failed`,
   `payment_method.attached`, `customer.updated`, `setup_intent.succeeded`.
   The last three retry any outstanding lead fee, and a failed SMS usage
   top-up, when the card changes.
   Copy the signing secret into Doppler as `STRIPE_WEBHOOK_SECRET`.

   Contractor SMS (chat fallback and booking texts) also sets a Twilio
   status callback when `ENVIRONMENT` is production or staging:
   `https://api.greenput.com/api/webhooks/twilio/sms` or
   `https://api.greenput.site/api/webhooks/twilio/sms`. That callback
   adjusts the prepaid balance to Twilio's `Price`. Account-recovery
   codes do not set it. Details: `docs/billing-lead-fees.md`.

5. **Receipt email.** Lead fees are off-session PaymentIntents, not
   invoices. The API does not set `receipt_email` and does not send an
   invoice. Stripe can still email a receipt when a charge succeeds:
   Settings → Emails → successful payments. Turn that off if the pilot
   must not receive Stripe mail. A saved card is required before the
   workspace can accept or auto-book a lead. A decline pauses delivery
   until the card is updated and the outstanding fee is collected —
   automatically on `payment_method.attached` / `customer.updated` /
   `setup_intent.succeeded`, or from Settings → Billing → "Charge saved
   card". Details: `docs/billing-lead-fees.md`.

6. **Pilot rate.** Slug `hi-power` is $1/lead (`GRANDFATHERED_LEAD_FEE_USD`
   and migration 041). "Hi Power Electric" slugs to `hi-power-electric`,
   which pays the placeholder card. Register the workspace under a name
   that allocates `hi-power`, or set `lead_fee_override_usd = 1` on that
   row. Details: `docs/billing-lead-fees.md`.

## Twilio (A2P 10DLC / error 18601)

Twilio rejected the business profile with 18601: the association between
the registered business name and the website could not be verified.

The public operator line is config. `OPERATOR_LEGAL_NAME` defaults to
**Greenput LLC** and `OPERATOR_MAILING_ADDRESS` is empty
(`apps/marketing/src/worker/geo/entity.ts`). The marketing site shows
"Operated by Greenput LLC" and the contact form, with no personal name
and no street. That line is on the footer, `/contact`, `/privacy`, and
`/terms`. Organization JSON-LD `legalName` is the same constant.
`llms.txt` has no address and no personal name. A home street or a
personal legal name must not be written into those constants, the HTML,
or the schema.

SMS copy on those two pages covers the only messages this product sends:
one-time login and verification codes, and lead notifications. Both pages
say frequency varies, message and data rates may apply, STOP opts out,
HELP gets help, consent is not a condition of purchase, and mobile
numbers are not shared for third-party marketing.

Resubmitting the Twilio profile is manual, and only after this marketing
Worker is deployed so https://greenput.com actually serves the new pages.
This change does not deploy and does not send SMS.
