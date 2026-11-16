-- Google Drive copies of store payment receipts (lib/drive/, kind 'payment_receipt').
--
-- Adds 'payment_receipt' to the allowed drive_uploads.kind values. The record_id
-- for this kind is payment_receipts.id. A receipt has at most one row (one
-- receipt per invoice, upserted on commission_period_id), so a re-upload
-- replaces the same Drive file. Unique (kind, record_id) is unchanged.
--
-- Additive: only the CHECK constraint on kind is widened. Existing rows are
-- untouched. Apply in the Supabase SQL editor after the operator has approved it.

ALTER TABLE public.drive_uploads DROP CONSTRAINT IF EXISTS drive_uploads_kind_check;

ALTER TABLE public.drive_uploads
  ADD CONSTRAINT drive_uploads_kind_check
  CHECK (kind IN ('delivery_order', 'invoice', 'payment_receipt'));
