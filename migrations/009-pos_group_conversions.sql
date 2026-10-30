-- Group conversions (bridge build 55+, agreed 2026-10-15).
--
-- A car that belongs to a group but arrived without the group ticket pays public price at the
-- gate. Later the same day a manager converts it: the group ticket (scanned, or shown on a phone)
-- names the group, the slip QR or the licence disc names the receipt, and the person entering is
-- captured exactly as at the entrance. The manager then picks the Visitor quantity on Loyverse's
-- own refund screen; those units are the heads that move to the group. The terminal records the
-- conversion HERE before any money moves (this row is what waives the refund window), refunds the
-- public sale, and then closes a group ticket for the heads so Loyverse's own count agrees.
--
-- Stages: recorded (the refund may now run) -> refunded (the refund receipt closed) -> admitted
-- (the group ticket closed on the terminal); refund_failed keeps the row so the manager can tap
-- Refund again without re-scanning; cancelled frees the receipt for a fresh attempt. Updates after
-- the record arrive as "group_conversion" audit events (src/services/pos_conversions.py).

CREATE TABLE pos_group_conversions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    -- made on the terminal, so retries and the audit events can name it
    conversion_id CHAR(36) NOT NULL UNIQUE,
    device_id VARCHAR(64) NOT NULL,
    employee_id INT NULL,
    employee_name VARCHAR(100) NULL,
    recorded_at DATETIME(3) NOT NULL,

    -- the public sale being converted
    receipt_id VARCHAR(40) NOT NULL,
    printed_no VARCHAR(32) NULL,
    plate VARCHAR(32) NULL,
    sale_at DATETIME(3) NULL,
    sold_by VARCHAR(100) NULL,

    -- what moves onto the group
    group_name VARCHAR(120) NOT NULL,
    group_item_id BIGINT NULL,
    heads INT NOT NULL,
    amount_cents INT NOT NULL DEFAULT 0,
    payment_summary VARCHAR(120) NULL,

    -- the person entering, as the entrance captures it
    person VARCHAR(120) NULL,
    surname VARCHAR(80) NULL,
    names VARCHAR(120) NULL,
    id_number VARCHAR(16) NULL,
    id_source VARCHAR(16) NULL,
    id_manual TINYINT(1) NOT NULL DEFAULT 0,

    -- progress
    stage VARCHAR(16) NOT NULL DEFAULT 'recorded',
    refund_receipt_no VARCHAR(32) NULL,
    refunded_at DATETIME(3) NULL,
    group_ticket_sync_id BIGINT NULL,
    group_receipt_no VARCHAR(32) NULL,
    admitted_at DATETIME(3) NULL,
    error VARCHAR(255) NULL,

    detail JSON NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_pos_group_conversions_receipt (receipt_id),
    INDEX idx_pos_group_conversions_plate (plate, recorded_at),
    INDEX idx_pos_group_conversions_group (group_name, recorded_at),
    INDEX idx_pos_group_conversions_stage (stage, recorded_at)
) ENGINE=InnoDB;
