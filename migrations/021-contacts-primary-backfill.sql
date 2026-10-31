-- Mirror each booking's primary contact into booking_contacts (role primary),
-- so the record's Contacts tab lists one set and "on site" can land on it.
UPDATE booking_contacts c
JOIN bookings b ON b.id = c.booking_id AND b.contact_email IS NOT NULL AND LOWER(b.contact_email) = c.email
SET c.role = 'primary', c.name = COALESCE(c.name, b.contact_name), c.mobile = COALESCE(c.mobile, b.contact_mobile);
INSERT IGNORE INTO booking_contacts (booking_id, email, name, mobile, role, source)
SELECT b.id, LOWER(b.contact_email), b.contact_name, b.contact_mobile, 'primary', 'booking'
FROM bookings b
WHERE b.contact_email IS NOT NULL AND b.contact_email <> '';
