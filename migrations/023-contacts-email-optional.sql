-- A booking's primary contact may have a mobile but no email (WhatsApp-only
-- groups); it still needs a contacts row so it can be marked on site.
ALTER TABLE booking_contacts MODIFY email VARCHAR(255) NULL;
