-- Migration: add_subscriptions_payment_method
-- Story 9.2b (Task 11, AC12, Ducdo ruling 1) — persist the Polar card-on-file so
-- GET /api/billing.paymentMethod renders the real {brand, last4}. These are Polar's
-- MASKED descriptor (e.g. 'visa' / '4242'), NOT raw card data — SEC-safe, epic:127-130
-- holds (ClassLite never touches PAN/CVV).
--
-- Both nullable: a Free / no-Polar / pre-first-payment center has no card (the FE
-- degrades to "Managed securely by Polar"). Captured in the webhook path
-- (setPlanFromPolarTx → SetSubscriptionPaymentMethod) under the re-established tenant
-- context (SEC-6). No new RLS needed — same subscriptions row, same tenant policies.

ALTER TABLE subscriptions
    ADD COLUMN payment_brand text,
    ADD COLUMN payment_last4 text;
