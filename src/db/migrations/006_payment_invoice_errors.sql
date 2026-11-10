-- ---------------------------------------------------------------------------
-- 006: why a paid deal has no invoice yet.
--
-- invoice_error         the last reason PayPal refused (cleared once an invoice exists)
-- invoice_attempted_at  when the last attempt, failed or not, was made
-- ---------------------------------------------------------------------------

ALTER TABLE payments
  ADD COLUMN invoice_error VARCHAR(500) NULL AFTER invoice_via,
  ADD COLUMN invoice_attempted_at TIMESTAMP(3) NULL AFTER invoice_error;
