-- Migration: a conversation can belong to several bookings (3 Nov 2026)
-- Description: Potters House books nine congregations on one day through one
--   contact; her thread carries all their proformas. The link table puts one
--   conversation on every booking it concerns. email_threads.booking_id and
--   email_messages.booking_id stay as the conversation's home booking.

CREATE TABLE IF NOT EXISTS email_thread_bookings (
    gmail_thrid BIGINT UNSIGNED NOT NULL,
    booking_id INT UNSIGNED NOT NULL,
    method VARCHAR(30) NULL,
    linked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (gmail_thrid, booking_id),
    KEY idx_email_thread_bookings_booking (booking_id),
    CONSTRAINT fk_email_thread_bookings_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO email_thread_bookings (gmail_thrid, booking_id, method)
SELECT gmail_thrid, booking_id, 'home' FROM email_threads WHERE booking_id IS NOT NULL;

INSERT IGNORE INTO email_thread_bookings (gmail_thrid, booking_id, method)
SELECT DISTINCT m.gmail_thrid, m.booking_id, 'message' FROM email_messages m
JOIN bookings b ON b.id = m.booking_id
WHERE m.booking_id IS NOT NULL AND m.gmail_thrid IS NOT NULL;
