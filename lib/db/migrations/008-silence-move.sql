-- Silence (limit) + account migration columns for the actors table.
-- Run with: npx wrangler d1 execute cf-ap --remote --file=lib/db/migrations/008-silence-move.sql

ALTER TABLE actors ADD COLUMN silenced INTEGER NOT NULL DEFAULT 0;
ALTER TABLE actors ADD COLUMN also_known_as TEXT;
ALTER TABLE actors ADD COLUMN moved_to TEXT;