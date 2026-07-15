-- Story 2-5a — add centers.contact_email (nullable text).
-- Used later (FU-2-5-G) as reply-to for staff/student notification emails;
-- Story 2-5a only persists the value from the Profile tab, does not consume it.
ALTER TABLE centers ADD COLUMN contact_email text;
