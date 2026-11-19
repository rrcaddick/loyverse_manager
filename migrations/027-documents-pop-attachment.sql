-- 2 Nov 2026: proof-of-payment inspection stores a customer's attachment as a
-- document of kind pop (a proof) or attachment (anything else); the enum had
-- lost both kinds, so every inspection failed and no proof ever reached Verify payments.
ALTER TABLE documents MODIFY kind ENUM('proforma','invoice','final_invoice','pop','attachment') NOT NULL;
