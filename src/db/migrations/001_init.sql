-- ---------------------------------------------------------------------------
-- 001_init: the whole schema.
--
-- Money is DECIMAL(12,2) everywhere. Never FLOAT: a rounding error in a price
-- is a number nobody offered.
--
-- Prices are stored in the basis the BUYER stated (per_unit or total) together
-- with that basis, so the record stays faithful to what they said; the domain
-- layer normalises to a per-unit figure when it builds its limits.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  role          ENUM('buyer','seller') NOT NULL,
  name          VARCHAR(191) NOT NULL,
  email         VARCHAR(191) NOT NULL,
  company       VARCHAR(191) NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY users_email_unique (email),
  KEY users_role_idx (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS requirements (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  buyer_id      BIGINT UNSIGNED NOT NULL,
  product       VARCHAR(191) NOT NULL,
  quantity      INT UNSIGNED NOT NULL DEFAULT 0,
  unit          VARCHAR(32) NULL,
  currency      CHAR(3) NOT NULL DEFAULT 'INR',
  target_price  DECIMAL(12,2) NOT NULL,
  max_price     DECIMAL(12,2) NOT NULL,
  price_basis   ENUM('per_unit','total') NOT NULL,
  status        ENUM('draft','active','closed') NOT NULL DEFAULT 'active',
  source_text   TEXT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY requirements_buyer_idx (buyer_id, status),
  CONSTRAINT requirements_buyer_fk FOREIGN KEY (buyer_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT requirements_band_chk CHECK (max_price >= target_price),
  CONSTRAINT requirements_positive_chk CHECK (target_price > 0),
  CONSTRAINT requirements_basis_chk CHECK (price_basis = 'per_unit' OR quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS negotiations (
  id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  requirement_id          BIGINT UNSIGNED NOT NULL,
  seller_id               BIGINT UNSIGNED NOT NULL,
  state                   VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  round                   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  max_rounds              SMALLINT UNSIGNED NOT NULL DEFAULT 6,
  current_seller_price    DECIMAL(12,2) NULL,
  last_inbound_message_id BIGINT UNSIGNED NULL,
  answered_message_id     BIGINT UNSIGNED NULL,
  seller_declined         TINYINT(1) NOT NULL DEFAULT 0,
  outcome                 VARCHAR(32) NULL,
  opened_at               TIMESTAMP NULL,
  closed_at               TIMESTAMP NULL,
  version                 INT UNSIGNED NOT NULL DEFAULT 0,
  created_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY negotiations_pair_unique (requirement_id, seller_id),
  KEY negotiations_state_idx (state),
  CONSTRAINT negotiations_requirement_fk FOREIGN KEY (requirement_id) REFERENCES requirements (id) ON DELETE CASCADE,
  CONSTRAINT negotiations_seller_fk FOREIGN KEY (seller_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Append-only. The repository layer offers no update or delete method, and
-- migration 003 adds triggers that enforce it in the database as well.
CREATE TABLE IF NOT EXISTS messages (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  negotiation_id  BIGINT UNSIGNED NOT NULL,
  author          ENUM('buyer','seller','agent','system') NOT NULL,
  kind            ENUM('text','offer','question','accept','decline','system') NOT NULL DEFAULT 'text',
  body            TEXT NOT NULL,
  price           DECIMAL(12,2) NULL,
  quantity        INT UNSIGNED NULL,
  in_reply_to     BIGINT UNSIGNED NULL,
  generated_by    ENUM('template','llm') NULL,
  created_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY messages_thread_idx (negotiation_id, id),
  CONSTRAINT messages_negotiation_fk FOREIGN KEY (negotiation_id) REFERENCES negotiations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS offers (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  negotiation_id    BIGINT UNSIGNED NOT NULL,
  actor             ENUM('buyer','seller') NOT NULL,
  unit_price        DECIMAL(12,2) NOT NULL,
  quantity          INT UNSIGNED NULL,
  currency          CHAR(3) NOT NULL DEFAULT 'INR',
  terms             JSON NULL,
  source_message_id BIGINT UNSIGNED NULL,
  created_at        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY offers_negotiation_idx (negotiation_id, id),
  CONSTRAINT offers_negotiation_fk FOREIGN KEY (negotiation_id) REFERENCES negotiations (id) ON DELETE CASCADE,
  CONSTRAINT offers_price_chk CHECK (unit_price > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per decision the agent made, whether or not it sent anything.
-- This is the table that answers "why did it do that?" three weeks later.
CREATE TABLE IF NOT EXISTS agent_runs (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  negotiation_id  BIGINT UNSIGNED NOT NULL,
  trigger_source  VARCHAR(32) NOT NULL DEFAULT 'worker',
  action          VARCHAR(32) NOT NULL,
  reason          VARCHAR(64) NOT NULL,
  state_before    VARCHAR(32) NOT NULL,
  state_after     VARCHAR(32) NOT NULL,
  counter_price   DECIMAL(12,2) NULL,
  llm_provider    VARCHAR(32) NULL,
  llm_model       VARCHAR(64) NULL,
  input_tokens    INT UNSIGNED NULL,
  output_tokens   INT UNSIGNED NULL,
  latency_ms      INT UNSIGNED NULL,
  grounded        TINYINT(1) NULL,
  fell_back       TINYINT(1) NOT NULL DEFAULT 0,
  correlation_id  VARCHAR(64) NULL,
  detail          JSON NULL,
  created_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY agent_runs_negotiation_idx (negotiation_id, id),
  CONSTRAINT agent_runs_negotiation_fk FOREIGN KEY (negotiation_id) REFERENCES negotiations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recommendations (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  requirement_id  BIGINT UNSIGNED NOT NULL,
  negotiation_id  BIGINT UNSIGNED NULL,
  decision        ENUM('accept','reject','continue') NOT NULL,
  rationale       VARCHAR(64) NOT NULL,
  price           DECIMAL(12,2) NULL,
  summary         TEXT NULL,
  created_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY recommendations_requirement_idx (requirement_id, id),
  CONSTRAINT recommendations_requirement_fk FOREIGN KEY (requirement_id) REFERENCES requirements (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The duplicate-send prevention, at the only level that actually holds when two
-- workers decide at the same instant: a UNIQUE index.
CREATE TABLE IF NOT EXISTS outbox (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  negotiation_id   BIGINT UNSIGNED NOT NULL,
  idempotency_key  VARCHAR(120) NOT NULL,
  payload          JSON NOT NULL,
  status           ENUM('pending','sent','failed') NOT NULL DEFAULT 'pending',
  attempts         INT UNSIGNED NOT NULL DEFAULT 0,
  message_id       BIGINT UNSIGNED NULL,
  last_error       VARCHAR(255) NULL,
  created_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  sent_at          TIMESTAMP(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY outbox_idempotency_key_unique (idempotency_key),
  KEY outbox_status_idx (status, id),
  CONSTRAINT outbox_negotiation_fk FOREIGN KEY (negotiation_id) REFERENCES negotiations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
