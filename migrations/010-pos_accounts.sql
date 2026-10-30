-- Migration: which Loyverse account each terminal row came from
-- A terminal signed into the throwaway training account and one signed into the live
-- account may report to the same back office; every row they write is tagged with the
-- account's Loyverse owner id (the terminal sends it as X-Loyverse-Account) so the two
-- never mix in a query and either can be purged on its own.

CREATE TABLE IF NOT EXISTS pos_accounts (
    account_id VARCHAR(32) NOT NULL,
    business_name VARCHAR(255) NOT NULL DEFAULT '',
    email VARCHAR(160) NOT NULL DEFAULT '',
    live TINYINT(1) NOT NULL DEFAULT 0,
    first_seen_at DATETIME NOT NULL,
    last_seen_at DATETIME NOT NULL,
    PRIMARY KEY (account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE pos_devices ADD COLUMN account_id VARCHAR(32) NOT NULL DEFAULT '';

ALTER TABLE open_tickets_current
    ADD COLUMN account_id VARCHAR(32) NOT NULL DEFAULT '',
    ADD INDEX idx_open_tickets_current_account (account_id, status);

ALTER TABLE open_tickets_history
    ADD COLUMN account_id VARCHAR(32) NOT NULL DEFAULT '',
    ADD INDEX idx_open_tickets_history_account (account_id, observed_at);

ALTER TABLE pos_employee_events
    ADD COLUMN account_id VARCHAR(32) NOT NULL DEFAULT '',
    ADD INDEX idx_pos_employee_events_account (account_id, occurred_at);

ALTER TABLE pos_refund_disputes
    ADD COLUMN account_id VARCHAR(32) NOT NULL DEFAULT '',
    ADD INDEX idx_pos_refund_disputes_account (account_id, logged_at);

ALTER TABLE pos_group_conversions
    ADD COLUMN account_id VARCHAR(32) NOT NULL DEFAULT '',
    ADD INDEX idx_pos_group_conversions_account (account_id, recorded_at);
