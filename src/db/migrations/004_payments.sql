-- ---------------------------------------------------------------------------
-- 004: payments for accepted deals.
--
-- One row per negotiation (UNIQUE), so a retried accept resumes the existing
-- PayPal order instead of opening a second one, and one row per PayPal order.
--
-- Two amounts on purpose: `deal_amount` is the total the buyer agreed, in the
-- requirement's currency; `amount` is what PayPal was asked to charge (USD).
--
-- status: CREATED  order created, buyer has not paid yet
--         PAID     captured and completed
--         PENDING  captured, but PayPal is holding the funds (e.g. review)
--         FAILED   capture declined; needs a person
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS payments (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  negotiation_id     BIGINT UNSIGNED NOT NULL,
  provider           VARCHAR(16) NOT NULL DEFAULT 'paypal',
  provider_order_id  VARCHAR(64) NOT NULL,
  status             ENUM('CREATED','PAID','PENDING','FAILED') NOT NULL DEFAULT 'CREATED',
  amount             DECIMAL(12,2) NOT NULL,
  currency           CHAR(3) NOT NULL,
  deal_amount        DECIMAL(12,2) NOT NULL,
  deal_currency      CHAR(3) NOT NULL,
  approve_url        VARCHAR(512) NULL,
  capture_id         VARCHAR(64) NULL,
  created_at         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  paid_at            TIMESTAMP(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY payments_negotiation_unique (negotiation_id),
  UNIQUE KEY payments_order_unique (provider_order_id),
  CONSTRAINT payments_negotiation_fk FOREIGN KEY (negotiation_id) REFERENCES negotiations (id) ON DELETE CASCADE,
  CONSTRAINT payments_amount_chk CHECK (amount > 0 AND deal_amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
