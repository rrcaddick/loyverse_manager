-- The contact who is on site and in charge on the day (one per booking).
ALTER TABLE booking_contacts ADD COLUMN on_site TINYINT(1) NOT NULL DEFAULT 0 AFTER shared;
