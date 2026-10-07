-- Multi-terminal feed (Loyverse bridge): several devices now send heartbeats and
-- lifecycle events. Track when a ticket was last seen in any heartbeat so one lagging
-- terminal cannot close tickets the others still hold, and record voids/reopens.
ALTER TABLE open_tickets_current
    ADD COLUMN last_seen_at DATETIME NULL AFTER last_modified_at,
    MODIFY COLUMN status ENUM('open', 'closed', 'voided') NOT NULL DEFAULT 'open';

ALTER TABLE open_tickets_history
    MODIFY COLUMN event_type ENUM('created', 'modified', 'closed', 'voided', 'reopened') NOT NULL;
