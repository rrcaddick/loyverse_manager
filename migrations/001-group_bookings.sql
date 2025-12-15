-- Migration: Create group_bookings table
-- Description: Creates a table for storing group bookings and ticket records
-- Author: Ray Caddick
-- Date: 2024-12-08

-- Table: card_payment_audits
-- Purpose: Store daily card payment audit comparisons between Paycloud and POS systems

CREATE TABLE IF NOT EXISTS group_bookings (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    group_name VARCHAR(255) NOT NULL,
    contact_person VARCHAR(255) NOT NULL,
    mobile_number VARCHAR(20) NOT NULL,
    visit_date DATE NOT NULL,
    barcode VARCHAR(64) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_group_bookings_barcode (barcode),
    KEY idx_group_bookings_visit_date (visit_date),
    KEY idx_group_bookings_mobile_number (mobile_number)
) ENGINE=InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;