-- Reverse 20260930120800_add_subscriptions_payment_method.up.sql
ALTER TABLE subscriptions
    DROP COLUMN payment_last4,
    DROP COLUMN payment_brand;
