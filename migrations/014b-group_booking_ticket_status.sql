-- Migration: ticket delivery on group bookings (19 Nov 2026)
-- Description: the WhatsApp ticket's Chatwoot message and conversation, when it
--   was sent, and the last delivery status Meta reported (sent, delivered, read,
--   failed) with the reason, refreshed when the page loads.
-- Note: named 014b so it sorts between the shop feed (014) and the booking
--   system (015) and the same file applies on every copy of the code.

ALTER TABLE group_bookings
    ADD COLUMN ticket_sent_at DATETIME NULL AFTER barcode,
    ADD COLUMN ticket_conversation_id BIGINT UNSIGNED NULL AFTER ticket_sent_at,
    ADD COLUMN ticket_message_id BIGINT UNSIGNED NULL AFTER ticket_conversation_id,
    ADD COLUMN ticket_status VARCHAR(16) NULL AFTER ticket_message_id,
    ADD COLUMN ticket_status_at DATETIME NULL AFTER ticket_status,
    ADD COLUMN ticket_error VARCHAR(255) NULL AFTER ticket_status_at;
