-- Telegram removed: writes go straight to Intervals and reports move to the web Reports view.
-- One-way cleanup; take a pg_dump first. Migrations 003 and 004 are retained as history.
DROP TABLE IF EXISTS notification_parts;      -- FK to work_items: drop first
DELETE FROM work_items WHERE kind IN ('telegram', 'notification');
DROP TABLE IF EXISTS telegram_link;
