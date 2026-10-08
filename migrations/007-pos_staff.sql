-- Self-managed POS staff: employees, roles, PINs and enrolled terminals for the Loyverse
-- bridge. Loyverse itself keeps only the owner account; the patched POS verifies every PIN
-- against this roster and enforces these permissions on the device.
--
-- Security notes
--   * PINs are never stored. pos_employees.pin_hash is PBKDF2-HMAC-SHA256(pin, site salt)
--     with the parameters in pos_auth_params; the unique index makes two employees sharing a
--     PIN impossible (a PIN alone identifies the employee at the Loyverse PIN pad).
--   * A terminal never receives pin_hash. The roster endpoint sends per-device verifiers,
--     HMAC-SHA256(device secret, pin_hash), so a leaked bridge token or a stolen roster from
--     one terminal is useless on any other device, and a device can be revoked here.
--   * pos_employee_events is append-only: every login, failed PIN, lockout, manager approval,
--     denied action, sale, refund and ticket rewrite the terminals report lands here with the
--     employee that did it.

CREATE TABLE pos_auth_params (
    id TINYINT NOT NULL PRIMARY KEY,
    algorithm VARCHAR(32) NOT NULL DEFAULT 'pbkdf2-sha256',
    salt_hex CHAR(32) NOT NULL,
    iterations INT NOT NULL,
    key_length TINYINT NOT NULL DEFAULT 32,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_pos_auth_params_singleton CHECK (id = 1)
) ENGINE=InnoDB;

CREATE TABLE pos_roles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(64) NOT NULL UNIQUE,
    description VARCHAR(255) NOT NULL DEFAULT '',
    -- JSON array of permission names; see src/services/pos_staff.py PERMISSIONS
    permissions JSON NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE pos_employees (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    role_id INT NOT NULL,
    -- hex PBKDF2 output; NULL until a PIN is set (the employee cannot log in until then)
    pin_hash CHAR(64) NULL,
    pin_set_at DATETIME NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    -- the Loyverse employee this person was before self-managed staff, for old reports
    loyverse_merchant_id BIGINT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_pos_employees_pin_hash (pin_hash),
    INDEX idx_pos_employees_active (active),
    CONSTRAINT fk_pos_employees_role FOREIGN KEY (role_id) REFERENCES pos_roles (id)
) ENGINE=InnoDB;

CREATE TABLE pos_devices (
    id INT AUTO_INCREMENT PRIMARY KEY,
    -- matches feed.deviceName in the terminal's bridge config
    device_id VARCHAR(64) NOT NULL UNIQUE,
    -- 32 random bytes, hex; copied once into the terminal's config (employees.deviceSecret)
    secret_hex CHAR(64) NOT NULL,
    note VARCHAR(255) NOT NULL DEFAULT '',
    active TINYINT(1) NOT NULL DEFAULT 1,
    enrolled_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME NULL,
    roster_version CHAR(64) NULL
) ENGINE=InnoDB;

CREATE TABLE pos_employee_events (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    -- the terminal's own id for the event, so outbox retries never double-record
    event_uuid CHAR(36) NOT NULL UNIQUE,
    device_id VARCHAR(64) NOT NULL,
    employee_id INT NULL,
    employee_name VARCHAR(100) NULL,
    event VARCHAR(32) NOT NULL,
    detail JSON NULL,
    occurred_at DATETIME(3) NOT NULL,
    received_at DATETIME(3) NOT NULL,

    INDEX idx_pos_employee_events_employee (employee_id, occurred_at),
    INDEX idx_pos_employee_events_occurred (occurred_at),
    INDEX idx_pos_employee_events_device (device_id, occurred_at),
    INDEX idx_pos_employee_events_event (event, occurred_at)
) ENGINE=InnoDB;
