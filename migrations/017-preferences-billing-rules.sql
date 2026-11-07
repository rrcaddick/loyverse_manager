-- Migration: User preferences, billing details on bookings, bank ignore rules
-- Description: Per-user appearance preferences (theme, mode, text size), the
--              recipient details SARS needs on a full tax invoice, and
--              description rules that keep recurring non-booking credits out
--              of the reconcile list (docs/research/05 and 07).
-- Author: Ray Caddick (feat/booking)
-- Date: 2026-10-09

ALTER TABLE users
    ADD COLUMN preferences JSON NULL AFTER theme;

ALTER TABLE bookings
    ADD COLUMN billing_address VARCHAR(500) NULL AFTER area,
    ADD COLUMN customer_vat_number VARCHAR(32) NULL AFTER billing_address;

CREATE TABLE IF NOT EXISTS bank_ignore_rules (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    pattern VARCHAR(120) NOT NULL,
    reason ENUM('own_transfer','card_settlement','interest','other') NOT NULL DEFAULT 'other',
    note VARCHAR(255) NULL,
    created_by INT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_bank_ignore_rules_pattern (pattern)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
