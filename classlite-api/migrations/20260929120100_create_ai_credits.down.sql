-- Reverse 20260929120100_create_ai_credits. DROP TABLE cascades its policies. No FK
-- links it to subscriptions; both reference centers only. No prior migration edited (WF-2).
DROP TABLE IF EXISTS ai_credits;
