-- Structured vehicle fields captured by the Loyverse bridge when a ticket is saved from a
-- licence disc scan (or a hand-typed registration). The full detail stays in receipt_json
-- under "vehicle"; these columns exist so tickets can be found and reported by plate.
ALTER TABLE open_tickets_current
    ADD COLUMN plate VARCHAR(16) NULL AFTER receipt_json,
    ADD COLUMN vehicle_make VARCHAR(64) NULL AFTER plate,
    ADD COLUMN vehicle_model VARCHAR(64) NULL AFTER vehicle_make,
    ADD COLUMN vehicle_colour VARCHAR(32) NULL AFTER vehicle_model,
    ADD COLUMN vehicle_source ENUM('disc', 'manual') NULL AFTER vehicle_colour,
    ADD INDEX idx_open_tickets_plate (plate);
