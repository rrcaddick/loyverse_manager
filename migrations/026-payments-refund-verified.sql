-- 2 Nov 2026: a refund is money out on the booking (negative amount, kind refund,
-- optionally linked to the bank debit); a deposit recorded from the old booking
-- sheet can be marked checked when no bank credit will ever match it.
ALTER TABLE payments MODIFY kind ENUM('eft','cash','card','cash_deposit','refund','other') NOT NULL;
ALTER TABLE payments ADD COLUMN verified_at DATETIME NULL AFTER note;
ALTER TABLE payments ADD COLUMN verified_by INT UNSIGNED NULL AFTER verified_at;
