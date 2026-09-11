-- ---------------------------------------------------------------------------
-- 002: support the agent's daily send limit.
--
-- The limit counts agent-authored messages in a rolling window; without this
-- index that count is a full scan of the thread table on every tick.
-- ---------------------------------------------------------------------------

CREATE INDEX messages_author_time_idx ON messages (author, created_at);
