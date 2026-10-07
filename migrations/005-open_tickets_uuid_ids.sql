-- The Loyverse bridge identifies tickets by their 36-character receipt UUID; the old
-- observer used a 32-character hash. Widen both tables (the unique index is kept).
ALTER TABLE open_tickets_current MODIFY COLUMN ticket_id VARCHAR(64) NOT NULL;
ALTER TABLE open_tickets_history MODIFY COLUMN ticket_id VARCHAR(64) NOT NULL;
