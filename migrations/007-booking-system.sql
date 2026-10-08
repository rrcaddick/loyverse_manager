-- Migration: Booking system (bookings, users, settings, documents, payments, bank, mail, queue)
-- Description: Replaces the Gmail + Google Sheet + Excel workflow. See docs/booking-system.md.
-- Author: Ray Caddick (built on feat/booking)
-- Date: 2026-10-08
-- Note: the splitter in scripts/run_migrations.py splits on ";" and drops "--" lines.
--       Keep semicolons out of string literals.

CREATE TABLE IF NOT EXISTS users (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    email VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role ENUM('admin','manager') NOT NULL DEFAULT 'manager',
    password_hash VARCHAR(255) NOT NULL,
    must_change_password TINYINT(1) NOT NULL DEFAULT 1,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    last_login_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_settings (
    setting_key VARCHAR(64) NOT NULL,
    value JSON NOT NULL,
    updated_by INT UNSIGNED NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS price_tiers (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    code VARCHAR(32) NOT NULL,
    label VARCHAR(120) NOT NULL,
    day_type ENUM('weekday','weekend') NOT NULL,
    price DECIMAL(12,2) NOT NULL,
    min_group_size INT NOT NULL DEFAULT 0,
    notes VARCHAR(255) NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_price_tiers_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS season_days (
    day DATE NOT NULL,
    kind ENUM('closed','peak','open') NOT NULL,
    label VARCHAR(120) NULL,
    PRIMARY KEY (day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bookings (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    reference VARCHAR(16) NOT NULL,
    doc_number INT UNSIGNED NULL,
    status ENUM('enquiry','proforma_sent','confirmed','completed','cancelled','lapsed','no_show') NOT NULL DEFAULT 'enquiry',
    group_name VARCHAR(255) NOT NULL,
    group_type VARCHAR(32) NULL,
    area VARCHAR(255) NULL,
    contact_name VARCHAR(255) NOT NULL,
    contact_email VARCHAR(255) NULL,
    contact_mobile VARCHAR(20) NULL,
    visit_date DATE NOT NULL,
    alternative_date DATE NULL,
    arrival_time VARCHAR(20) NULL,
    adults INT NOT NULL DEFAULT 0,
    children INT NOT NULL DEFAULT 0,
    people_booked INT NOT NULL DEFAULT 0,
    vehicles INT NOT NULL DEFAULT 0,
    gazebos INT NOT NULL DEFAULT 0,
    price_tier_code VARCHAR(32) NULL,
    price_per_person DECIMAL(12,2) NOT NULL DEFAULT 0,
    price_overridden TINYINT(1) NOT NULL DEFAULT 0,
    price_override_reason VARCHAR(255) NULL,
    deposit_due DECIMAL(12,2) NOT NULL DEFAULT 0,
    deposit_overridden TINYINT(1) NOT NULL DEFAULT 0,
    deposit_waived TINYINT(1) NOT NULL DEFAULT 0,
    deposit_override_reason VARCHAR(255) NULL,
    arrived_count INT NULL,
    arrived_source ENUM('loyverse','manual') NULL,
    arrived_at DATETIME NULL,
    barcode VARCHAR(64) NOT NULL,
    source ENUM('form','email','import','manual') NOT NULL DEFAULT 'manual',
    enquiry_date DATE NULL,
    hold_expires_on DATE NULL,
    customer_notes TEXT NULL,
    internal_notes TEXT NULL,
    email_thread_id BIGINT UNSIGNED NULL,
    proforma_sent_at DATETIME NULL,
    invoice_sent_at DATETIME NULL,
    final_invoice_sent_at DATETIME NULL,
    ticket_sent_at DATETIME NULL,
    ticket_emailed_at DATETIME NULL,
    confirmed_at DATETIME NULL,
    completed_at DATETIME NULL,
    cancelled_at DATETIME NULL,
    lapsed_at DATETIME NULL,
    legacy_sheet_row JSON NULL,
    created_by INT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_bookings_reference (reference),
    UNIQUE KEY uq_bookings_doc_number (doc_number),
    UNIQUE KEY uq_bookings_barcode (barcode),
    KEY idx_bookings_visit_date (visit_date),
    KEY idx_bookings_status (status),
    KEY idx_bookings_contact_email (contact_email),
    KEY idx_bookings_contact_mobile (contact_mobile),
    KEY idx_bookings_email_thread (email_thread_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS booking_questions (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    booking_id INT UNSIGNED NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NULL,
    answered_at DATETIME NULL,
    answered_by INT UNSIGNED NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_booking_questions_booking (booking_id),
    CONSTRAINT fk_booking_questions_booking FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS booking_events (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    booking_id INT UNSIGNED NOT NULL,
    kind VARCHAR(40) NOT NULL,
    summary VARCHAR(255) NOT NULL,
    data JSON NULL,
    actor_user_id INT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_booking_events_booking (booking_id, created_at),
    CONSTRAINT fk_booking_events_booking FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS documents (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    booking_id INT UNSIGNED NOT NULL,
    kind ENUM('proforma','invoice','final_invoice') NOT NULL,
    number VARCHAR(20) NOT NULL,
    version INT NOT NULL DEFAULT 1,
    file_path VARCHAR(255) NOT NULL,
    total DECIMAL(12,2) NOT NULL DEFAULT 0,
    paid DECIMAL(12,2) NOT NULL DEFAULT 0,
    due DECIMAL(12,2) NOT NULL DEFAULT 0,
    snapshot JSON NULL,
    issued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    issued_by INT UNSIGNED NULL,
    email_message_id INT UNSIGNED NULL,
    PRIMARY KEY (id),
    KEY idx_documents_booking (booking_id, kind, version),
    CONSTRAINT fk_documents_booking FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bank_transactions (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    fingerprint VARCHAR(64) NOT NULL,
    account_number VARCHAR(32) NOT NULL,
    entry_id VARCHAR(32) NULL,
    booking_date DATE NOT NULL,
    value_date DATE NULL,
    description VARCHAR(255) NULL,
    end_to_end_id VARCHAR(255) NULL,
    amount DECIMAL(12,2) NOT NULL,
    credit_debit ENUM('CREDIT','DEBIT') NOT NULL,
    balance_after DECIMAL(14,2) NULL,
    raw JSON NULL,
    first_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    match_status ENUM('unmatched','suggested','matched','ignored') NOT NULL DEFAULT 'unmatched',
    matched_booking_id INT UNSIGNED NULL,
    matched_at DATETIME NULL,
    matched_by INT UNSIGNED NULL,
    match_method VARCHAR(30) NULL,
    suggestions JSON NULL,
    ignore_reason VARCHAR(255) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_bank_transactions_fingerprint (fingerprint),
    KEY idx_bank_transactions_date (booking_date),
    KEY idx_bank_transactions_status (match_status),
    KEY idx_bank_transactions_booking (matched_booking_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payments (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    booking_id INT UNSIGNED NOT NULL,
    kind ENUM('eft','cash','card','other') NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    paid_on DATE NOT NULL,
    reference VARCHAR(120) NULL,
    bank_transaction_id INT UNSIGNED NULL,
    note VARCHAR(255) NULL,
    recorded_by INT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_payments_bank_transaction (bank_transaction_id),
    KEY idx_payments_booking (booking_id),
    CONSTRAINT fk_payments_booking FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE CASCADE,
    CONSTRAINT fk_payments_bank_transaction FOREIGN KEY (bank_transaction_id) REFERENCES bank_transactions (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bank_poll_log (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    started_at DATETIME NOT NULL,
    finished_at DATETIME NULL,
    window_from DATE NULL,
    window_to DATE NULL,
    entries INT NOT NULL DEFAULT 0,
    new_entries INT NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'running',
    error TEXT NULL,
    PRIMARY KEY (id),
    KEY idx_bank_poll_log_started (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS email_messages (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    gmail_msgid BIGINT UNSIGNED NULL,
    gmail_thrid BIGINT UNSIGNED NULL,
    gmail_uid INT UNSIGNED NULL,
    folder VARCHAR(40) NULL,
    message_id_header VARCHAR(255) NULL,
    in_reply_to VARCHAR(255) NULL,
    references_header TEXT NULL,
    direction ENUM('inbound','outbound') NOT NULL,
    kind VARCHAR(40) NULL,
    from_name VARCHAR(255) NULL,
    from_email VARCHAR(255) NULL,
    to_emails JSON NULL,
    cc_emails JSON NULL,
    subject VARCHAR(500) NULL,
    sent_at DATETIME NULL,
    snippet VARCHAR(255) NULL,
    body_text MEDIUMTEXT NULL,
    body_html MEDIUMTEXT NULL,
    has_attachments TINYINT(1) NOT NULL DEFAULT 0,
    booking_id INT UNSIGNED NULL,
    match_method VARCHAR(30) NULL,
    review_status ENUM('none','pending','resolved','not_booking') NOT NULL DEFAULT 'none',
    resolved_by INT UNSIGNED NULL,
    resolved_at DATETIME NULL,
    is_auto_generated TINYINT(1) NOT NULL DEFAULT 0,
    bounce_back_sent_at DATETIME NULL,
    send_status ENUM('sent','failed') NULL,
    send_error TEXT NULL,
    sent_by INT UNSIGNED NULL,
    attachments_meta JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_email_messages_gmail_msgid (gmail_msgid),
    KEY idx_email_messages_thread (gmail_thrid),
    KEY idx_email_messages_booking (booking_id, sent_at),
    KEY idx_email_messages_review (review_status, sent_at),
    KEY idx_email_messages_from (from_email),
    KEY idx_email_messages_message_id (message_id_header),
    KEY idx_email_messages_sent_at (sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS email_attachments (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    email_message_id INT UNSIGNED NOT NULL,
    filename VARCHAR(255) NOT NULL,
    content_type VARCHAR(120) NULL,
    size_bytes INT UNSIGNED NOT NULL DEFAULT 0,
    file_path VARCHAR(255) NOT NULL,
    PRIMARY KEY (id),
    KEY idx_email_attachments_message (email_message_id),
    CONSTRAINT fk_email_attachments_message FOREIGN KEY (email_message_id) REFERENCES email_messages (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bounce_backs (
    sender_email VARCHAR(255) NOT NULL,
    last_sent_at DATETIME NOT NULL,
    PRIMARY KEY (sender_email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mail_sync_state (
    folder VARCHAR(40) NOT NULL,
    uidvalidity BIGINT UNSIGNED NULL,
    last_uid INT UNSIGNED NOT NULL DEFAULT 0,
    last_synced_at DATETIME NULL,
    last_error TEXT NULL,
    PRIMARY KEY (folder)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS booking_reminders (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    booking_id INT UNSIGNED NOT NULL,
    kind ENUM('still_interested','deposit_reminder','final_details','lapse') NOT NULL,
    due_on DATE NOT NULL,
    status ENUM('due','sent','dismissed') NOT NULL DEFAULT 'due',
    dismissed_by INT UNSIGNED NULL,
    dismissed_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_booking_reminders (booking_id, kind),
    KEY idx_booking_reminders_due (status, due_on),
    CONSTRAINT fk_booking_reminders_booking FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS form_submissions (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    booking_id INT UNSIGNED NULL,
    payload JSON NOT NULL,
    ip VARCHAR(64) NULL,
    user_agent VARCHAR(255) NULL,
    turnstile_ok TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_form_submissions_ip (ip, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS import_runs (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    kind VARCHAR(40) NOT NULL,
    started_at DATETIME NOT NULL,
    finished_at DATETIME NULL,
    summary JSON NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'running',
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed: price tiers 2026/27 (from the price policy tab of the old sheet)
INSERT IGNORE INTO price_tiers (code, label, day_type, price, min_group_size, notes, sort_order) VALUES
('school_weekday', 'Schools and children''s groups', 'weekday', 70.00, 0, 'Including teachers and facilitators', 10),
('school_parents_weekday', 'School parents', 'weekday', 90.00, 0, 'Family joining a school group separately', 20),
('adult_small_weekday', 'Approved adult groups under 40', 'weekday', 95.00, 0, 'Work functions, team building', 30),
('adult_large_weekday', 'Approved adult groups 40 and over', 'weekday', 90.00, 40, 'Work functions, team building', 40),
('pensioners_weekday', 'Pensioner groups', 'weekday', 90.00, 0, NULL, 50),
('church_weekend', 'Church and approved groups 40 and over', 'weekend', 95.00, 40, NULL, 60),
('nonprofit_kids_weekend', 'Non-profit kids and youth 40 and over', 'weekend', 95.00, 40, 'Soccer, youth clubs', 70),
('nonprofit_adults_weekend', 'Non-profit adults and families 40 and over', 'weekend', 100.00, 40, 'Soccer, creche, family groups', 80),
('public_weekend', 'Public rate', 'weekend', 115.00, 0, 'Weekends, public and school holidays, from age 2', 90),
('peak', 'Peak days', 'weekend', 130.00, 0, '25 and 26 December, 1 to 3 January', 100);

-- Seed: season closures and peak days
INSERT IGNORE INTO season_days (day, kind, label) VALUES
('2026-12-24', 'closed', 'Christmas Eve'),
('2026-12-31', 'closed', 'New Year''s Eve'),
('2027-03-26', 'closed', 'Closed'),
('2026-12-25', 'peak', 'Christmas Day'),
('2026-12-26', 'peak', 'Day of Goodwill'),
('2027-01-01', 'peak', 'New Year''s Day'),
('2027-01-02', 'peak', 'Peak day'),
('2027-01-03', 'peak', 'Peak day');

-- Carry the legacy group_bookings rows across so ticket links keep working.
INSERT IGNORE INTO bookings
    (reference, status, group_name, contact_name, contact_mobile, visit_date, people_booked, barcode, source, enquiry_date, created_at)
SELECT CONCAT('LEG', LPAD(gb.id, 4, '0')),
       CASE WHEN gb.visit_date < CURDATE() THEN 'completed' ELSE 'confirmed' END,
       gb.group_name, gb.contact_person, gb.mobile_number, gb.visit_date, 0, gb.barcode, 'import', gb.visit_date, CURRENT_TIMESTAMP
FROM group_bookings gb
WHERE NOT EXISTS (SELECT 1 FROM bookings b WHERE b.barcode = gb.barcode);
