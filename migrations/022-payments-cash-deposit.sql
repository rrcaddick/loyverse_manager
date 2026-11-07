-- A cash deposit at the bank is not an EFT: its own payment kind, and the
-- existing bank matches whose description says so move over to it.
ALTER TABLE payments MODIFY kind ENUM('eft','cash','card','cash_deposit','other') NOT NULL;
UPDATE payments p
JOIN bank_transactions t ON t.id = p.bank_transaction_id
SET p.kind = 'cash_deposit'
WHERE p.kind = 'eft' AND (t.description REGEXP 'CASH[[:space:]]*DEP' OR t.end_to_end_id REGEXP 'CASH[[:space:]]*DEP');
