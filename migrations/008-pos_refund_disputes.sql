-- Refund disputes logged at the gate terminals (bridge build 41+).
--
-- When a cashier cannot refund a sale on the terminal (the refund window has closed, or a card
-- refund failed inside it) the terminal offers "Log a refund dispute": the customer's name,
-- contact details and their own words, with everything about the sale attached by the terminal.
-- The customer leaves with a printed slip carrying the dispute number; the owner investigates
-- from here and replies within two working days. A dispute never refunds anything by itself.
--
-- Rows arrive through the ordinary terminal audit trail (event "refund_disputed" in
-- pos_employee_events, same outbox, same de-duplication on event_uuid) and are mirrored here so
-- that status, the owner's note and the reply have a home.  Resolution happens in
-- src/services/pos_disputes.py; the audit row stays untouched.

CREATE TABLE pos_refund_disputes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    -- printed on the customer's slip, e.g. RD-7K3M9P (made on the terminal, so it exists offline)
    dispute_number VARCHAR(16) NOT NULL UNIQUE,
    event_uuid CHAR(36) NOT NULL UNIQUE,
    device_id VARCHAR(64) NOT NULL,
    employee_id INT NULL,
    employee_name VARCHAR(100) NULL,
    logged_at DATETIME(3) NOT NULL,

    -- why the terminal could not refund: window_expired | refund_failed
    trigger_kind VARCHAR(24) NOT NULL,
    refusal VARCHAR(255) NOT NULL DEFAULT '',

    -- the sale, as the terminal saw it
    receipt_id VARCHAR(40) NULL,
    printed_no VARCHAR(32) NULL,
    order_number VARCHAR(32) NULL,
    plate VARCHAR(32) NULL,
    sale_at DATETIME(3) NULL,
    register VARCHAR(64) NULL,
    sold_by VARCHAR(100) NULL,
    amount_cents INT NULL,
    payment_summary VARCHAR(120) NULL,
    transaction_code VARCHAR(64) NULL,

    -- what the customer gave
    customer_name VARCHAR(100) NOT NULL DEFAULT '',
    customer_email VARCHAR(160) NOT NULL DEFAULT '',
    customer_mobile VARCHAR(32) NOT NULL DEFAULT '',
    reason TEXT NULL,

    -- the owner's side: open | investigating | approved | declined | refunded
    status VARCHAR(16) NOT NULL DEFAULT 'open',
    resolution TEXT NULL,
    resolved_by VARCHAR(100) NULL,
    resolved_at DATETIME NULL,
    reply TEXT NULL,
    replied_at DATETIME NULL,

    -- the full event detail from the terminal (receipt lines, payments, card details)
    detail JSON NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_pos_refund_disputes_status (status, logged_at),
    INDEX idx_pos_refund_disputes_plate (plate, logged_at)
) ENGINE=InnoDB;
