-- Migration: which sales-screen categories a role may pick from
-- NULL = every category; otherwise a JSON list of category names (Public is always offered).
ALTER TABLE pos_roles ADD COLUMN sales_categories JSON NULL;
