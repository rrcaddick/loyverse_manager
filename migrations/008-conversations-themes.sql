-- Migration: Conversations, quote splitting, work views and user themes
-- Description: Thread-level state for the redesigned Mail and Work screens
--              (docs/research/01 and 03), plus a per-user theme preference.
-- Author: Ray Caddick (feat/booking)
-- Date: 2026-10-09

ALTER TABLE email_messages
    ADD COLUMN body_new_html MEDIUMTEXT NULL AFTER body_html,
    ADD COLUMN body_new_text MEDIUMTEXT NULL AFTER body_new_html,
    ADD COLUMN body_quoted_html MEDIUMTEXT NULL AFTER body_new_text,
    ADD COLUMN signature_text TEXT NULL AFTER body_quoted_html,
    ADD COLUMN split_version TINYINT NOT NULL DEFAULT 0 AFTER signature_text;

CREATE TABLE IF NOT EXISTS email_threads (
    gmail_thrid BIGINT UNSIGNED NOT NULL,
    booking_id INT UNSIGNED NULL,
    status ENUM('open','done') NOT NULL DEFAULT 'open',
    done_at DATETIME NULL,
    done_by INT UNSIGNED NULL,
    not_booking TINYINT(1) NOT NULL DEFAULT 0,
    subject VARCHAR(500) NULL,
    counterpart_name VARCHAR(255) NULL,
    counterpart_email VARCHAR(255) NULL,
    message_count INT NOT NULL DEFAULT 0,
    last_message_at DATETIME NULL,
    last_inbound_at DATETIME NULL,
    last_outbound_at DATETIME NULL,
    last_direction ENUM('inbound','outbound') NULL,
    last_snippet VARCHAR(255) NULL,
    has_automated_only TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (gmail_thrid),
    KEY idx_email_threads_booking (booking_id),
    KEY idx_email_threads_status_last (status, last_message_at),
    KEY idx_email_threads_counterpart (counterpart_email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS email_thread_notes (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    gmail_thrid BIGINT UNSIGNED NOT NULL,
    body TEXT NOT NULL,
    author_user_id INT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_email_thread_notes_thread (gmail_thrid, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE users
    ADD COLUMN theme VARCHAR(32) NULL AFTER role;

ALTER TABLE booking_reminders
    ADD COLUMN stale TINYINT(1) NOT NULL DEFAULT 0 AFTER status;
