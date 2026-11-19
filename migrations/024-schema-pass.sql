-- Schema pass of 30 Oct 2026 (docs/handoff/ui-round2.md): the fields the park
-- does not capture go, the sheet row moves to its own table, Loyverse is the
-- only arrivals source, and pricing becomes three rates with a discount.

CREATE TABLE IF NOT EXISTS booking_legacy_rows (
    booking_id INT UNSIGNED NOT NULL PRIMARY KEY,
    sheet_row JSON NOT NULL,
    imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_booking_legacy_rows_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO booking_legacy_rows (booking_id, sheet_row, imported_at)
SELECT id, legacy_sheet_row, created_at FROM bookings WHERE legacy_sheet_row IS NOT NULL
ON DUPLICATE KEY UPDATE sheet_row = VALUES(sheet_row);

ALTER TABLE bookings
    DROP COLUMN legacy_sheet_row,
    DROP COLUMN arrival_time,
    DROP COLUMN vehicles,
    DROP COLUMN gazebos,
    DROP COLUMN arrived_at,
    DROP COLUMN price_overridden,
    DROP COLUMN price_override_reason,
    MODIFY COLUMN arrived_source ENUM('loyverse') NULL,
    ADD COLUMN tier_price DECIMAL(12,2) NULL AFTER price_tier_code,
    ADD COLUMN discount_per_person DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER price_per_person,
    ADD COLUMN discount_reason VARCHAR(255) NULL AFTER discount_per_person,
    ADD COLUMN minimum_waived_by INT UNSIGNED NULL AFTER discount_reason;

-- Three rates plus the public and peak prices. Old tier codes map onto them.
INSERT INTO price_tiers (code, label, day_type, price, min_group_size, notes, sort_order, is_active) VALUES
    ('children_weekday', "Children's groups, term-time weekdays", 'weekday', 70.00, 0, 'Schools, creches, aftercare and youth clubs on a weekday in term time', 10, 1),
    ('group_weekday', 'Groups, term-time weekdays', 'weekday', 95.00, 0, 'Any other group on a weekday in term time, parents joining a school group included', 20, 1),
    ('group_weekend', 'Groups, weekends and school holidays', 'weekend', 95.00, 0, 'The group rate on a weekend or a school-holiday weekday', 30, 1)
ON DUPLICATE KEY UPDATE label = VALUES(label), day_type = VALUES(day_type), price = VALUES(price),
    min_group_size = VALUES(min_group_size), notes = VALUES(notes), sort_order = VALUES(sort_order), is_active = 1;
UPDATE price_tiers SET label = 'Public rate', notes = 'Gate and online price: public holidays, and any group under the minimum', min_group_size = 0, sort_order = 40, is_active = 1 WHERE code = 'public_weekend';
UPDATE price_tiers SET label = 'Peak days', notes = 'The public rate on 25 and 26 December and 1 to 3 January', min_group_size = 0, sort_order = 50, is_active = 1 WHERE code = 'peak';

UPDATE bookings SET price_tier_code = CASE price_tier_code
    WHEN 'school_weekday' THEN 'children_weekday'
    WHEN 'school_parents_weekday' THEN 'group_weekday'
    WHEN 'adult_small_weekday' THEN 'group_weekday'
    WHEN 'adult_large_weekday' THEN 'group_weekday'
    WHEN 'pensioners_weekday' THEN 'group_weekday'
    WHEN 'church_weekend' THEN 'group_weekend'
    WHEN 'nonprofit_kids_weekend' THEN 'group_weekend'
    WHEN 'nonprofit_adults_weekend' THEN 'group_weekend'
    ELSE price_tier_code END;

DELETE FROM price_tiers WHERE code IN ('school_weekday', 'school_parents_weekday', 'adult_small_weekday', 'adult_large_weekday', 'pensioners_weekday', 'church_weekend', 'nonprofit_kids_weekend', 'nonprofit_adults_weekend');

-- Where the agreed price is at or under the mapped tier the discount is the gap.
-- Anything above its tier is left for scripts/reprice_bookings.py, which applies
-- the day and minimum rules and reports what it changed.
UPDATE bookings b JOIN price_tiers t ON t.code = b.price_tier_code
SET b.tier_price = t.price,
    b.discount_per_person = t.price - b.price_per_person,
    b.discount_reason = CASE WHEN t.price > b.price_per_person THEN 'Imported from the booking sheet' ELSE NULL END
WHERE t.price >= b.price_per_person;

-- Settings: the two prices live in price_tiers now, and the no-discount window
-- is replaced by the school-holiday ranges (season.school_holidays).
UPDATE app_settings SET value = JSON_REMOVE(value, '$.public_weekend_price', '$.peak_price') WHERE setting_key = 'pricing';
UPDATE app_settings SET value = JSON_REMOVE(value, '$.no_discount_start', '$.no_discount_end') WHERE setting_key = 'season';
UPDATE app_settings SET value = JSON_REMOVE(value, '$.arrival_slots') WHERE setting_key = 'form';
