-- Migration: live staff vs training staff
-- A terminal signed into the live Loyverse account gets the live employees in its roster; any
-- other terminal (the throwaway training account) gets the training ones. Everyone who existed
-- before this migration was a training login.
ALTER TABLE pos_employees ADD COLUMN scope VARCHAR(12) NOT NULL DEFAULT 'live';
UPDATE pos_employees SET scope = 'training';
