# CM Innovations – Razorpay + Firebase payment starter

A secure, server-authoritative payment integration scaffold for the CM Innovations website.

## Included

- `public/index.html`: customer checkout; customer-entered amount.
- `public/admin.html`: Firebase Auth admin dashboard, transaction list, CSV export and admin-generated Razorpay Payment Links.
- `functions/index.js`: callable order creation, server-side signature + API verification, admin payment-link creation, admin listing, webhook receiver, PDF receipt generation, email and WhatsApp notification delivery.
- `firestore.rules` and `storage.rules`: deny all direct client access to payment data and receipt objects.

## Important before deployment

This is a deployable starter scaffold, not a substitute for a payment-provider account review or a full security audit. Replace all placeholders, test in a separate Firebase test project, verify webhook payloads against your Razorpay account's current dashboard/docs, configure approved WhatsApp templates, and run end-to-end tests before accepting real money.

The frontend HTML intentionally contains placeholder Firebase web config and commented App Check initialization. Configure App Check for the website and uncomment the initialization in **both** HTML files before enabling `enforceAppCheck` (currently enabled on callable functions). Do not deploy with placeholder config.

## Architecture / payment state

- Browser never receives `RAZORPAY_KEY_SECRET` or `RAZORPAY_WEBHOOK_SECRET`.
- `createRazorpayOrder` creates a server-side Razorpay Order for customer-entered payments.
- `verifyRazorpayPayment` checks the checkout HMAC, fetches payment from Razorpay and only marks captured payments as `PAID`.
- `razorpayWebhook` verifies the HMAC against `req.rawBody`; it processes captured/failed/order/payment-link events and deduplicates webhook event IDs.
- Admin payment requests use Razorpay Payment Links, with `payment_link.paid` webhook handling.
- Firestore payment collections deny all client SDK reads/writes. Admin dashboard reads via a callable function guarded by Firebase custom claim `admin: true`.
- PDF receipts are stored privately in Cloud Storage; backend creates a time-limited signed URL. Email uses Resend; WhatsApp uses Meta WhatsApp Cloud API template messages.

## 1. Create Firebase projects

Prefer two projects:

- `cm-innovations-pay-test` (test Razorpay keys)
- `cm-innovations-pay-live` (live Razorpay keys)

This separation is safer than changing a mode flag in one project. Initialize Firebase CLI in this directory and choose the appropriate project:

```bash
npm install -g firebase-tools
firebase login
firebase use --add
```

Copy `.firebaserc.example` to `.firebaserc` and replace the project ID if you manage aliases manually. Enable **Cloud Firestore**, **Cloud Functions**, **Firebase Authentication (Email/Password)**, **Cloud Storage**, **Firebase Hosting**, **App Check**, and billing/Blaze where required by deployed services.

## 2. Configure web app

In Firebase Console → Project settings → Your apps → Web app, copy the config values into both:

- `public/index.html` (`firebaseConfig`)
- `public/admin.html` (`cfg`)

Register the website in Firebase App Check using reCAPTCHA Enterprise (recommended) or a supported web provider. Put the site key in both HTML files and uncomment `initializeAppCheck(...)`. Configure the correct allowed domains. Keep App Check enforcement enabled only after observing valid traffic in App Check metrics.

## 3. Configure Razorpay secrets

In the Razorpay Dashboard, create **Test Mode** API keys first. Set the webhook URL after deploying the webhook function (see below). Set secrets in the selected Firebase project:

```bash
firebase functions:secrets:set RAZORPAY_KEY_ID
firebase functions:secrets:set RAZORPAY_KEY_SECRET
firebase functions:secrets:set RAZORPAY_WEBHOOK_SECRET
```

Enter the TEST key ID, TEST key secret and a webhook secret you define in Razorpay Dashboard. The webhook secret is independently configured; it is not the API key secret.

## 4. Configure email and WhatsApp delivery

Email is sent through Resend. Verify your sender domain in Resend before using it:

```bash
firebase functions:secrets:set RESEND_API_KEY
```

WhatsApp uses Meta WhatsApp Cloud API. Create/approve a template named `payment_confirmation` (or change the `WHATSAPP_TEMPLATE` parameter). This implementation expects an approved English template with four body variables: customer name, amount, receipt number and the signed receipt URL. The URL is included as text; WhatsApp may automatically make it tappable.

```bash
firebase functions:secrets:set WHATSAPP_TOKEN
firebase functions:secrets:set WHATSAPP_PHONE_NUMBER_ID
```

The customer mobile number must be in international format (for India, +91XXXXXXXXXX). The business must have WhatsApp messaging permission/opt-in and an approved template. Do not send unsolicited messages.

Set non-secret parameters in `functions/.env.<project-id>` (do not commit this file if it contains private data):

```env
PUBLIC_SITE_URL=https://YOUR_DOMAIN
EMAIL_FROM=CM Innovations <payments@YOUR_VERIFIED_DOMAIN>
WHATSAPP_TEMPLATE=payment_confirmation
```

`PUBLIC_SITE_URL` is reserved for future return links; current checkout relies on Razorpay's modal callback.

## 5. Install and deploy

```bash
cd functions
npm install
cd ..
firebase deploy --only firestore:rules,storage,functions,hosting
```

After deployment, copy the HTTPS URL for `razorpayWebhook` from the Firebase/Google Cloud console. In Razorpay Dashboard → Account & Settings → Webhooks, add that URL and subscribe to:

- `payment.captured`
- `payment.failed`
- `order.paid`
- `payment_link.paid`

Use the exact webhook secret entered in `RAZORPAY_WEBHOOK_SECRET`. Ensure the webhook endpoint receives the unmodified request body; Firebase Functions exposes it as `req.rawBody`.

## 6. Create the first administrator

Create an admin user in Firebase Authentication (Email/Password). Obtain the user's Firebase Auth UID. From a trusted workstation with Google Cloud ADC permissions:

```bash
gcloud auth application-default login
cd functions
npm install firebase-admin
cd ..
GCLOUD_PROJECT=cmb-40001 node scripts/set-admin.js FIREBASE_AUTH_UID
```

The admin dashboard checks the `admin: true` custom claim on the callable backend. Ask the administrator to sign out and sign back in to refresh the ID token. Never expose a service-account JSON key in the website.

## 7. Test plan before live

1. Use the test Firebase project and Razorpay TEST keys.
2. Test customer-entered amounts at ₹1, a normal amount, and the configured upper limit; verify invalid values are rejected server-side.
3. Complete a Razorpay test payment; confirm the backend marks it `PAID` only after the Razorpay payment API returns `captured`.
4. Test failed payment, checkout dismissed, duplicate button clicks, browser closed after payment, webhook retry and duplicate webhook delivery.
5. Create an admin payment request; pay the generated Payment Link; verify `payment_link.paid` and receipt delivery.
6. Confirm direct Firestore and Storage access from an unauthenticated browser is denied.
7. Confirm a signed-in non-admin cannot call admin functions.
8. Confirm PDF is correct, Resend email is delivered, WhatsApp template is approved/delivered, and signed receipt URLs expire.
9. Reconcile sample records with Razorpay Dashboard.

## 8. Switch to LIVE safely

Strongly prefer a separate live Firebase project. Deploy the same tested code to it, configure its own Firebase web config, App Check domain, email/WhatsApp settings, and set **LIVE** Razorpay credentials and a new live webhook secret using the same three secret names. Add the live webhook URL in Razorpay Live Mode and repeat a low-value real transaction/refund test before announcing launch.

Never mix TEST and LIVE key IDs/secrets or reuse the test webhook secret in live. Use Razorpay's dashboard capture settings so successful authorised payments are captured; this code only marks an order paid when the payment is `captured`.

## Firestore collections

- `payment_orders`: canonical internal order record; never client-readable.
- `payment_transactions`: verified payment details; never client-readable.
- `webhook_events`: webhook idempotency and processing record; never client-readable.
- `payment_receipts`: receipt metadata; never client-readable.
- `rate_limits`: basic per-IP create-order throttling; never client-readable.

## Operational notes / production hardening

- Configure Cloud Billing budgets and alerts; Functions/Storage/Firestore and external email/WhatsApp providers may incur charges.
- Add Cloud Logging alerting for webhook 5xx, email/WhatsApp delivery failures and unusual order volume.
- Add a scheduled reconciliation job to query Razorpay for pending orders and reconcile missed webhook/callback events. Do not rely on browser callbacks alone.
- Add an authenticated customer receipt lookup flow using an opaque, expiring token or verified account identity before exposing receipt links. Do not expose receipt URLs publicly from Firestore.
- Add a support/admin refund workflow with explicit admin confirmation and a server-side Razorpay refund API call; this starter intentionally does not implement refund execution.
- Review amount ceilings, GST/invoice rules, retention, privacy notice, terms, refund policy and accounting treatment with your finance/legal advisers.
- Add emulator/unit tests and CI before launch. Firestore Admin SDK bypasses Firestore Rules, so enforce authorization in every callable function.
- The current admin dashboard displays the latest 100 records and exports those loaded records; pagination and server-side date/search filters should be added for high transaction volumes.
- The PDF currently uses a generic computer-generated receipt format. Configure your legal entity name, address, GSTIN, invoice/receipt numbering and tax breakup if it is intended to serve as a tax invoice.

## Useful official references

- Razorpay Standard Checkout: https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/
- Razorpay payment verification and best practices: https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/best-practices/
- Razorpay Payment Links API: https://razorpay.com/docs/api/payments/payment-links/
- Firebase App Check: https://firebase.google.com/docs/app-check
- Firebase Functions secrets: https://firebase.google.com/docs/functions/config-env#secret_parameters
- Firestore Rules: https://firebase.google.com/docs/firestore/security/get-started
