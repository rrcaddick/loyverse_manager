-- Migration: the group's name is its selected alias (3 Nov 2026)
-- Description: every spelling a group has been booked under is an alias with
--   where it came from; one alias is selected and booking_groups.name caches it.
--   Switching the name is picking another alias; a wrong spelling is deleted.

ALTER TABLE booking_group_aliases
    ADD COLUMN is_selected TINYINT(1) NOT NULL DEFAULT 0 AFTER name,
    ADD COLUMN source ENUM('booked','typed','import') NOT NULL DEFAULT 'booked' AFTER is_selected,
    ADD COLUMN booking_id INT UNSIGNED NULL AFTER source,
    ADD KEY idx_booking_group_aliases_selected (group_id, is_selected);

-- Every group's current name becomes its selected alias, credited to the most
-- recent booking that used that spelling.
INSERT IGNORE INTO booking_group_aliases (group_id, name, is_selected, source, booking_id)
SELECT g.id, g.name, 1, 'booked',
       (SELECT b.id FROM bookings b WHERE b.group_id = g.id AND b.group_name = g.name ORDER BY b.visit_date DESC, b.id DESC LIMIT 1)
FROM booking_groups g;

UPDATE booking_group_aliases a JOIN booking_groups g ON g.id = a.group_id AND g.name = a.name
SET a.is_selected = 1;

-- Spellings learned before this migration: credit them to a booking that used them.
UPDATE booking_group_aliases a
SET a.booking_id = (SELECT b.id FROM bookings b WHERE b.group_id = a.group_id AND b.group_name = a.name ORDER BY b.visit_date DESC, b.id DESC LIMIT 1)
WHERE a.booking_id IS NULL;
