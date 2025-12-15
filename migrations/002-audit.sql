-- Migration: Create audit system tables
-- Description: Creates tables for card payment audits, cash bag assignments, and verifications
-- Author: Ray Caddick
-- Date: 2024-12-08

-- Table: card_payment_audits
-- Purpose: Store daily card payment audit comparisons between Paycloud and POS systems
CREATE TABLE IF NOT EXISTS card_payment_audits (
    id INT AUTO_INCREMENT PRIMARY KEY,
    audit_date DATE NOT NULL,
    paycloud_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    loyverse_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    aronium_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    pos_total DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    variance DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_audit_date (audit_date),
    UNIQUE KEY unique_audit_date (audit_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: cash_bag_assignments
-- Purpose: Store cash bag assignments with unique identifiers for blind counting
CREATE TABLE IF NOT EXISTS cash_bag_assignments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    bag_id VARCHAR(20) NOT NULL UNIQUE,
    assignment_date DATE NOT NULL,
    source_system ENUM('loyverse', 'aronium') NOT NULL,
    source_identifier VARCHAR(255) NOT NULL COMMENT 'shift-id, employee-device combo, or daily-total',
    expected_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    employee_id VARCHAR(255) NULL COMMENT 'Loyverse employee_id if applicable',
    pos_device_id VARCHAR(255) NULL COMMENT 'Loyverse pos_device_id if applicable',
    shift_id VARCHAR(255) NULL COMMENT 'Loyverse shift_id if available',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_bag_id (bag_id),
    INDEX idx_assignment_date (assignment_date),
    INDEX idx_source_system (source_system)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: cash_bag_verifications
-- Purpose: Store verification records when bags are counted (blind count)
CREATE TABLE IF NOT EXISTS cash_bag_verifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    bag_id VARCHAR(20) NOT NULL,
    counted_amount DECIMAL(10, 2) NOT NULL,
    counted_by VARCHAR(255) NOT NULL COMMENT 'Name or ID of person who counted',
    variance DECIMAL(10, 2) NOT NULL COMMENT 'counted_amount - expected_amount',
    notes TEXT NULL,
    verified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_bag_id (bag_id),
    INDEX idx_verified_at (verified_at),
    UNIQUE KEY unique_bag_verification (bag_id),
    
    FOREIGN KEY (bag_id) REFERENCES cash_bag_assignments(bag_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add comments to tables
ALTER TABLE card_payment_audits COMMENT = 'Daily card payment audit records comparing Paycloud vs POS systems';
ALTER TABLE cash_bag_assignments COMMENT = 'Cash bag assignments with blind identifiers for verification';
ALTER TABLE cash_bag_verifications COMMENT = 'Verification records when cash bags are counted';