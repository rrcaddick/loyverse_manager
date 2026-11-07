-- Migration: Learned list of senders whose mail is never a booking
-- Description: "Not a booking" teaches the system; mail from these addresses or
--              domains is stored only if attached to a booking and never queued.
-- Author: Ray Caddick (feat/booking)
-- Date: 2026-10-09

CREATE TABLE IF NOT EXISTS mail_ignored_senders (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    pattern VARCHAR(255) NOT NULL,
    kind ENUM('address','domain') NOT NULL DEFAULT 'address',
    reason VARCHAR(255) NULL,
    created_by INT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_mail_ignored_senders_pattern (pattern)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
