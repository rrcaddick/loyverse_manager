-- Display names from the From, To and Cc headers, keyed by address, so a
-- contact learned from a copied address gets a name (30 Oct 2026).
ALTER TABLE email_messages ADD COLUMN participant_names JSON NULL AFTER cc_emails;
