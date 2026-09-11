-- ---------------------------------------------------------------------------
-- 003: make "messages are append-only" a property of the database.
--
-- The repository layer already offers no way to change a message - there is no
-- update or delete method on it - but a convention only holds while everyone
-- keeps it. These triggers make an UPDATE or DELETE on `messages` an error.
--
-- REQUIRES THE `TRIGGER` PRIVILEGE. If your MySQL user does not have it this
-- migration fails, and that is the only thing that fails: the schema from 001
-- and the index from 002 are already applied, and the application-level rule
-- still stands. Either grant the privilege:
--
--     GRANT TRIGGER ON negotiation_agent.* TO 'negotiation'@'%';
--
-- or mark this migration as applied without running it:
--
--     INSERT INTO schema_migrations (id) VALUES ('003_messages_append_only.sql');
--
-- Kept in its own file precisely so that choice is available.
-- ---------------------------------------------------------------------------

CREATE TRIGGER messages_block_update BEFORE UPDATE ON messages FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'messages are append-only: updates are not permitted';

CREATE TRIGGER messages_block_delete BEFORE DELETE ON messages FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'messages are append-only: deletes are not permitted';
