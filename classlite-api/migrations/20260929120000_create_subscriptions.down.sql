-- Reverse 20260929120000_create_subscriptions. DROP TABLE cascades its policies.
-- Dropped BEFORE the ai_credits table only matters if a FK linked them (none does);
-- both reference centers, not each other. No prior migration is edited (WF-2).
DROP TABLE IF EXISTS subscriptions;
