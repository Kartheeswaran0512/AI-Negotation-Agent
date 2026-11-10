-- ---------------------------------------------------------------------------
-- 005: which PayPal path created the order, and the invoice for a paid deal.
--
-- created_via   'rest' or 'toolkit' (@paypal/agent-toolkit, PAYPAL_USE_TOOLKIT)
-- invoice_id    the PayPal invoice raised once the payment is PAID
-- invoice_status as PayPal reported it on creation (a draft: DRAFT)
-- invoice_via   'rest' or 'toolkit', like created_via
-- ---------------------------------------------------------------------------

ALTER TABLE payments
  ADD COLUMN created_via VARCHAR(16) NOT NULL DEFAULT 'rest' AFTER provider_order_id,
  ADD COLUMN invoice_id VARCHAR(64) NULL AFTER capture_id,
  ADD COLUMN invoice_status VARCHAR(32) NULL AFTER invoice_id,
  ADD COLUMN invoice_via VARCHAR(16) NULL AFTER invoice_status,
  ADD UNIQUE KEY payments_invoice_unique (invoice_id);
