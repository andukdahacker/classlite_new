-- Down: drop the enrollment_history table. Dropping the table removes its
-- policies, indexes, and the REVOKEs with it (the GRANT posture is restored for a
-- freshly re-created table by the create_app_role default privileges).
DROP TABLE IF EXISTS enrollment_history;
