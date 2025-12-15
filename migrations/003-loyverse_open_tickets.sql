-- Current open tickets (latest state only)
CREATE TABLE open_tickets_current (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    ticket_id CHAR(32) NOT NULL UNIQUE,
    semantic_hash CHAR(64) NOT NULL,
    status ENUM('open', 'closed') NOT NULL DEFAULT 'open',
    receipt_json JSON NOT NULL,
    opened_at DATETIME NOT NULL,
    last_modified_at DATETIME NOT NULL,
    closed_at DATETIME NULL,

    INDEX idx_status (status),
    INDEX idx_ticket_id (ticket_id)
) ENGINE=InnoDB;

-- Immutable audit history
CREATE TABLE open_tickets_history (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    ticket_id CHAR(32) NOT NULL,
    semantic_hash CHAR(64) NOT NULL,
    event_type ENUM('created', 'modified', 'closed') NOT NULL,
    receipt_json JSON NULL,
    observed_at DATETIME NOT NULL,

    INDEX idx_ticket_id (ticket_id),
    INDEX idx_observed_at (observed_at)
) ENGINE=InnoDB;
