-- Migration: Groups (2 Nov 2026)
-- Description: A group is the thing that comes back, a booking is one visit. Each
--   booking links to a group, the group keeps every spelling it has been booked
--   under, and the record's History tab is the group's other bookings.
--   previous_visit_name is the public form's "Have you visited before, under what name?".
-- Note: GROUPS is a reserved word in MySQL 8, hence booking_groups.

CREATE TABLE IF NOT EXISTS booking_groups (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    group_type VARCHAR(32) NULL,
    area VARCHAR(255) NULL,
    notes TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_booking_groups_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS booking_group_aliases (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    group_id INT UNSIGNED NOT NULL,
    name VARCHAR(255) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_booking_group_alias (group_id, name),
    CONSTRAINT fk_booking_group_alias_group FOREIGN KEY (group_id) REFERENCES booking_groups(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE bookings
    ADD COLUMN group_id INT UNSIGNED NULL AFTER group_name,
    ADD COLUMN previous_visit_name VARCHAR(255) NULL AFTER area,
    ADD KEY idx_bookings_group (group_id),
    ADD CONSTRAINT fk_bookings_group FOREIGN KEY (group_id) REFERENCES booking_groups(id) ON DELETE SET NULL;
