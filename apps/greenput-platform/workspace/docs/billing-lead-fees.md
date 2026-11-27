# Lead-fee billing

Booking a lead is the billing event (WS-1). Schedule-aware delivery —
the booking commit — inserts one `pending` `lead_meter_events` row
(`recordLeadMeter`, unique per (lead, workspace)) and, when that insert
is new, charges it immediately. A staff accept click
(`POST /api/leads/:id/accept`) and a pool accept are state transitions
and bill nothing. Nothing is billed before a booking.

There is no weekly cron and no Stripe invoice. One PaymentIntent per
lead, off-session, on the workspace's platform Customer. GreenPut does
not carry a contractor's lead fee: a saved card is required before a
workspace can receive a lead, and a failed charge pauses further
delivery until that fee is collected.

## Card required, and a pause

`assertCanReceiveLeads` (`apps/api/src/lib/lead-billing-gate.ts`) runs
before the accept update, before `bookInFreeLane` on delivery, and
before the pool offer is marked accepted.

- `STRIPE_SECRET_KEY` set, and the workspace has no Stripe customer, no
  default payment method, and no saved card — or Stripe cannot be asked:
  `409 CARD_REQUIRED`. Nothing is accepted and nothing is booked.
- Any `lead_meter_events` row with `status = pending` and
  `payment_status` of `failed` or `processing`: `409 DELIVERY_PAUSED`,
  whether or not Stripe is configured. `unconfigured`,
  `no_payment_method`, and `below_minimum` are not outstanding.
- No `STRIPE_SECRET_KEY`: the card is not checked. A development booking
  still commits and the fee stays `pending` / `unconfigured`.

The lookup is live (`invoice_settings.default_payment_method`, else the
first saved card). There is no stored payment-method column.

A decline after the gate does not roll the booking back. That fee stays
`pending` / `failed`, and the next accept, delivery, or pool accept is
paused. Withdrawal never waives that still-pending fee (WS-1): it stands,
stays collectible, and the pause stays until it is collected — or it is
reversed by `refundLeadFee`, the only reversal path (fraud or platform
fault, FR-1.4). A captured fee is `invoiced` and is not refunded.

`GET /api/leads/:id/fee` includes `receive` (`{ ok: true }` or the block)
so the Accept dialog can disable Confirm. `GET /api/billing/meter`
includes `receive` (`billingConfigured`, `cardOnFile`, `deliveryPaused`,
`message`) and does not charge.

Settings → Billing and the onboarding done step say a card is required
and that a decline pauses delivery. "Add a card for lead fees" opens the
Customer Portal (`POST /api/billing/payment-method`). "Charge saved card"
(`POST /api/billing/lead-fees/collect`) is the manual retry.

`payment_method.attached`, `customer.updated`, and
`setup_intent.succeeded` call `retryLeadFeesForStripeCustomer`, which
runs that same collect for the workspace owning the Stripe customer. A
declined create is still confirmed (`lead-fee-confirm-${id}-${paymentMethodId}`),
not created a second time.

## What one booking does

`chargeBookedLeadFee` (`apps/api/src/lib/lead-fee-billing.ts`):

1. Re-read the meter row. If it is no longer `pending` (already charged,
   or already waived), stop. No Stripe call.
2. No `STRIPE_SECRET_KEY`: leave `status = pending`, set
   `payment_status = unconfigured`, call nothing. The booking still commits.
3. Amount under 50 cents (Stripe's card minimum, which includes a $0
   override): `payment_status = below_minimum`, no Stripe call. A $1
   pilot fee is 100 cents. `price_usd` is REAL — a priority booking's
   halved price can carry cents ($35 → $17.50).
4. Create a Stripe Customer when `workspaces.stripe_customer_id` is empty.
   Idempotency key `lead-fee-customer-${workspaceId}`.
   `metadata.workspace_id` is the workspace id. A blank email is omitted.
5. Re-read again. A row that stopped being `pending` while the customer
   was being resolved (refunded, or settled from a deposit forfeit) does
   not get a PaymentIntent.
6. Payment method: the customer's
   `invoice_settings.default_payment_method`, otherwise the first saved
   card. No card: `payment_status = no_payment_method`, no PaymentIntent,
   `status` stays `pending`. Delivery does not reach this step while
   Stripe is configured — the gate refuses first.
   Collect can still record it if someone charges with no card.
7. Create a PaymentIntent:
   `amount` in cents, `currency=usd`, `off_session=true`, `confirm=true`,
   `customer`, `payment_method`. Metadata: `workspace_id`, `lead_id`,
   `meter_event_id`, `kind=lead_fee`. Idempotency key
   `lead-fee-${meterEventId}` — one charge per meter row, because
   `UNIQUE(lead_id, workspace_id)` means one row per lead per shop.
   `receipt_email` is not set.
   This is not a Connect destination charge and it never calls
   `/invoices` or `/invoices/:id/send`.
8. `succeeded` → `status = invoiced`, `payment_status = paid`,
   `stripe_payment_intent_id`, `invoiced_at`, and only while the row is
   still `pending`.
9. `processing` → stay `pending`, `payment_status = processing`.
10. A decline or `authentication_required` (HTTP 402, the PaymentIntent id
    on the error) → stay `pending`, `payment_status = failed`, store the
    PaymentIntent id.

The charge is awaited on the booking. A Stripe failure after the gate
does not roll that booking back. It leaves the fee pending and pauses
the next one. The debt is the booking that was allowed to happen.

## A declined card

The fee was owed and Stripe did not collect it. The booking stands, the
row stays `pending`, `payment_status = failed`, and further
lead delivery to that workspace is paused until the card is updated and
this fee is collected (the webhook above, or "Charge saved card").

Stripe replays an idempotency key for 24 hours, including the decline,
so a retry does not create a second PaymentIntent with `lead-fee-${id}`.
It confirms the existing one
(`lead-fee-confirm-${id}-${paymentMethodId}`). A canceled intent may be
replaced with `lead-fee-${id}-${paymentMethodId}`. The delivery request
itself does not retry.

## Refunds

Exactly two cases (FR-1.4): proven **fraud** and **platform fault**.
`refundLeadFee` (`apps/api/src/lib/lead-fee-billing.ts`) is the only
refund path for a lead fee — it validates the reason first and throws
`LeadFeeRefundError` for anything else, refunds a collected fee through
Stripe against its PaymentIntent (a still-`pending` fee is simply
marked, having never been collected), and records the reason on the
row (`refund_reason` + `notes`, status `refunded`). Declines, cancels,
no-shows and delivery undos leave the fee standing. There is no route
exposing it yet; WS-8 executes these paths.

## Withdrawal

`withdrawLead` never waives a meter row (WS-1). Before booking nothing
was billed. After booking the fee stands at any distance (Canonical
Model v14): a `pending` row stays `pending` and collectible, an
`invoiced` row is left alone, and a collected charge is not refunded.
The only reversal of a lead fee is `refundLeadFee` (fraud or platform
fault, FR-1.4 — see Refunds above).

That interacts with an immediate charge like this:

- The charge has not succeeded (decline, processing, Stripe unset,
  under the minimum, or collect called with no card). The row is still
  `pending`. Withdrawal leaves it `pending`. Nothing was captured, so
  there is nothing to refund, and the fee stays collectible via
  `chargePendingLeadFees`. A `failed` or `processing` row remains
  outstanding, so the pause does not lift.
- The charge succeeded. The row is `invoiced`. Withdrawal leaves it
  alone. The PRD's "never refunds" is this case.
- **Overlap.** A withdrawal landing in the same moment Stripe captures
  changes nothing about the row: withdrawal never flips it. If the
  capture succeeds the row becomes `invoiced` / `paid` and stands, and a
  later `payment_intent.succeeded` for that intent does the same; if the
  capture fails the row stays `pending` / `failed` and collectible. No
  refund follows from a withdrawal.

## Webhooks

`POST /api/payments/webhook` calls `reconcileLeadFeeCharge` for
`payment_intent.succeeded` and `payment_intent.payment_failed`. It
no-ops unless `metadata.kind` is `lead_fee`, so a job payment or a
deposit intent is not a lead fee.

- `succeeded` marks a **pending** row `invoiced` / `paid`. A waived row
  stays waived.
- `payment_failed` sets `payment_status = failed` only while the row is
  pending.

`payment_method.attached`, `customer.updated`, and
`setup_intent.succeeded` retry pending lead fees for that customer.
Subscribe those on the webhook endpoint.

`invoice.payment_failed` still sets `subscriptions.status` to `past_due`
when the invoice carries a subscription id (`invoice.subscription` on
API `2025-02-24.acacia`, or
`invoice.parent.subscription_details.subscription`). `invoice.paid` with
no subscription id changes nothing. Lead fees are not invoices.

A succeeded charge can still produce a Stripe receipt if the Dashboard
"email customers for successful payments" setting is on. That is a
Dashboard switch. This Worker does not set `receipt_email` and does not
send mail.

## Price

`quoteLeadFee` is the only price `recordLeadMeter` and
`GET /api/leads/:id/fee` use. Order:

1. `workspaces.lead_fee_override_usd` when it is a finite number ≥ 0
   (whole dollars, rounded).
2. Else `GRANDFATHERED_LEAD_FEE_USD` in `lead-rate-card.ts`. The only
   entry is slug `hi-power` → $1.
3. Else the PLACEHOLDER `PER_SERVICE_LEAD_USD` price when the service is one
   of the four electrical quote services (panel_service $90, circuits $40,
   troubleshooting $25, surge_protection $20; still the `electrical`
   vertical).
4. Else the placeholder `PER_LEAD_USD` card.

`POST /api/auth/register` writes the override when the allocated slug is
in that map. Migration `041-lead-fee-billing.sql` sets it on an existing
`hi-power` row whose override is still null.

A company name of "Hi Power Electric" allocates slug `hi-power-electric`,
which is **not** grandfathered. The pilot workspace has to be slug
`hi-power` (the name "Hi Power" allocates that), or
`lead_fee_override_usd` has to be set to `1` on the row. Changing the
column does not require a deploy; changing the slug map does.

## SMS balance

Outbound SMS the contractor starts — chat fallback (`sendSmsFallback`) and
the booking text (`sendConsumerSms`) — is paid from
`workspaces.usage_balance_micro_usd`. The unit is micro-USD
(1 USD = 1_000_000) because Twilio's published US long-code price is
$0.0083 per segment (`TWILIO_US_SMS_SEGMENT_MICRO_USD` in
`libs/shared/notifications`). Cents cannot represent that price.

At send time the balance is debited that list price (`sms_estimate`, one
row per MessageSid). `POST /api/webhooks/twilio/sms` (signed with the
auth token against the canonical URL, production
`https://api.greenput.com/api/webhooks/twilio/sms` or staging
`https://api.greenput.site/api/webhooks/twilio/sms`) adjusts the reserve
to Twilio's `Price` once (`sms_reconcile`). A second callback does
nothing. If the send itself fails, an `sms_reversal` credits the reserve
back. The ledger is append-only.

When the balance is below `usage_topup_threshold_cents` (default 200, $2)
or cannot cover the message, one off-session PaymentIntent charges
`usage_topup_cents` (default 1000, $10) to the saved card. Idempotency
key `usage-topup-${ledgerId}`. A declined create is retried by confirming
that PaymentIntent (`usage-topup-${ledgerId}-${paymentMethodId}`), the
same way a lead fee is. One pending top-up row per workspace, so two
sends cannot start two charges. Succeeded credits the balance once,
whether the request or `payment_intent.succeeded` lands first.

A top-up whose `payment_status` is `failed` or `processing` blocks further
contractor SMS (`409 USAGE_EXHAUSTED` on chat) and pauses lead delivery
(`409 DELIVERY_PAUSED`), including when `STRIPE_SECRET_KEY` is unset.
`payment_method.attached`, `customer.updated`, and `setup_intent.succeeded`
retry that failed top-up along with pending lead fees. With no Stripe key,
nothing is debited or blocked.

Account-recovery OTP (`apps/api/src/routes/otp.ts`) has its own sender. It
is not debited, not gated, and does not set a status callback.

Workspace notifications (a new lead, a job update, a payment, a review
request) go through `dispatchNotification`. The shared library does not
import the API. The API injects the billing hook from
`dispatchWorkspaceNotification` (`apps/api/src/lib/workspace-notifications.ts`),
which calls `sendContractorSms`, so that SMS reserves the same balance.
`USAGE_EXHAUSTED` or a failed send is logged on the SMS row and the same
notice is emailed when email was not already going out, including when
SMS was the only selected channel. Push has no transport, so email is
the delivery that keeps the notice from being dropped. A caller that
does not pass the hook stays on the shared sender: the marketing contact
form, which notifies GreenPut, sends that way and does not debit.

Cloudflare request volume is not billed. Twilio Voice is not billed.
Stripe's processing fee is taken by Stripe from each card charge, not as
a separate line.

Settings → Billing reads `GET /api/billing/usage` and saves the two
amounts with `PATCH /api/billing/usage` (top-up 50–100000 cents, threshold
strictly less). Neither call charges the card. A card on file is still
required before the workspace can receive a lead.
