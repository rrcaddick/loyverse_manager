-- Requests, enquiries, per-booking contacts, the skipped-mail log and proof-of-payment
-- candidates (docs/handoff/migration-and-inbound.md).

ALTER TABLE bookings
    MODIFY status ENUM('requested','enquiry','proforma_sent','confirmed','completed','cancelled','lapsed','no_show','declined') NOT NULL DEFAULT 'enquiry',
    ADD COLUMN accepted_at DATETIME NULL AFTER confirmed_at,
    ADD COLUMN declined_at DATETIME NULL AFTER accepted_at,
    ADD COLUMN enquiry_id INT UNSIGNED NULL AFTER email_thread_id;

CREATE TABLE IF NOT EXISTS booking_contacts (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    booking_id INT UNSIGNED NOT NULL,
    email VARCHAR(255) NOT NULL,
    name VARCHAR(255) NULL,
    mobile VARCHAR(20) NULL,
    role ENUM('primary','cc','learned') NOT NULL DEFAULT 'learned',
    shared TINYINT(1) NOT NULL DEFAULT 0,
    source VARCHAR(40) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_booking_contacts (booking_id, email),
    KEY idx_booking_contacts_email (email),
    CONSTRAINT fk_booking_contacts_booking FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS enquiries (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    gmail_thrid BIGINT UNSIGNED NOT NULL,
    sender_email VARCHAR(255) NOT NULL,
    sender_name VARCHAR(255) NULL,
    subject VARCHAR(500) NULL,
    status ENUM('open','replied','converted','attached','resolved','not_booking') NOT NULL DEFAULT 'open',
    booking_id INT UNSIGNED NULL,
    convert_token VARCHAR(64) NULL,
    convert_sent_at DATETIME NULL,
    first_message_at DATETIME NULL,
    last_inbound_at DATETIME NULL,
    last_outbound_at DATETIME NULL,
    message_count INT NOT NULL DEFAULT 0,
    snippet VARCHAR(255) NULL,
    extracted JSON NULL,
    resolved_at DATETIME NULL,
    resolved_by INT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_enquiries_thread (gmail_thrid),
    UNIQUE KEY uq_enquiries_token (convert_token),
    KEY idx_enquiries_status (status, last_inbound_at),
    KEY idx_enquiries_sender (sender_email),
    KEY idx_enquiries_booking (booking_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mail_skipped (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    gmail_msgid BIGINT UNSIGNED NOT NULL,
    gmail_thrid BIGINT UNSIGNED NULL,
    gmail_uid INT UNSIGNED NULL,
    from_email VARCHAR(255) NULL,
    from_name VARCHAR(255) NULL,
    subject VARCHAR(500) NULL,
    sent_at DATETIME NULL,
    grade ENUM('certain','likely') NOT NULL,
    reason VARCHAR(255) NOT NULL,
    rescued_at DATETIME NULL,
    rescued_by INT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_mail_skipped_msgid (gmail_msgid),
    KEY idx_mail_skipped_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pop_candidates (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    booking_id INT UNSIGNED NULL,
    email_message_id INT UNSIGNED NOT NULL,
    attachment_id INT UNSIGNED NULL,
    document_id INT UNSIGNED NULL,
    status ENUM('pending','allocated','dismissed') NOT NULL DEFAULT 'pending',
    parsed TINYINT(1) NOT NULL DEFAULT 0,
    text_signal TINYINT(1) NOT NULL DEFAULT 0,
    bank_name VARCHAR(60) NULL,
    reference VARCHAR(120) NULL,
    amount DECIMAL(12,2) NULL,
    paid_on DATE NULL,
    bank_transaction_id INT UNSIGNED NULL,
    payment_id INT UNSIGNED NULL,
    resolved_at DATETIME NULL,
    resolved_by INT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_pop_candidates_attachment (email_message_id, attachment_id),
    KEY idx_pop_candidates_booking (booking_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE email_messages
    ADD COLUMN inbound_outcome VARCHAR(30) NULL AFTER is_auto_generated,
    ADD COLUMN processed_at DATETIME NULL AFTER inbound_outcome,
    ADD COLUMN label_applied VARCHAR(60) NULL AFTER processed_at,
    ADD COLUMN candidate_booking_ids JSON NULL AFTER label_applied,
    ADD COLUMN enquiry_id INT UNSIGNED NULL AFTER candidate_booking_ids,
    ADD KEY idx_email_messages_outcome (inbound_outcome, processed_at);

ALTER TABLE documents
    MODIFY kind ENUM('proforma','invoice','final_invoice','pop','attachment') NOT NULL,
    ADD COLUMN title VARCHAR(255) NULL AFTER number,
    ADD COLUMN attachment_id INT UNSIGNED NULL AFTER email_message_id;
