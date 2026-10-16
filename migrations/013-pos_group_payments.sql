-- Migration: group payments, tied to the booking by the ticket's barcode
-- One row per paid group_payment event from a terminal (the receipt that closed after the
-- group's ticket was scanned and the amount entered). Never by hand: the barcode is the proof.
CREATE TABLE IF NOT EXISTS pos_group_payments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    event_uuid CHAR(36) NOT NULL,
    account_id VARCHAR(32) NOT NULL DEFAULT '',
    device_id VARCHAR(64) NOT NULL,
    employee_id INT NULL,
    employee_name VARCHAR(100) NULL,
    barcode VARCHAR(64) NOT NULL,
    group_name VARCHAR(255) NOT NULL DEFAULT '',
    receipt_id VARCHAR(40) NULL,
    printed_no VARCHAR(32) NULL,
    amount_cents INT NOT NULL DEFAULT 0,
    payment_summary VARCHAR(120) NULL,
    paid_at DATETIME(3) NOT NULL,
    detail JSON NULL,
    UNIQUE KEY uq_pos_group_payments_event (event_uuid),
    KEY idx_pos_group_payments_barcode (barcode, paid_at),
    KEY idx_pos_group_payments_account (account_id, paid_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
