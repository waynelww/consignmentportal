-- Monthly report settings (lib/monthly-report/settings.ts).
-- Seed rows only: no schema change. Additive and idempotent (ON CONFLICT DO
-- NOTHING), so re-running it never overwrites a value an operator has changed.
--
-- NOT APPLIED YET. Paste into the Supabase SQL editor for project
-- mhdyurnrmpjxsjbhbxrp after the operator has approved it.

INSERT INTO public.settings (key, value, description) VALUES
  ('monthly_report_email', 'waynelww2000@gmail.com',
     'Recipient of the monthly report (PDF + Excel), emailed on the 1st at 09:30 MYT'),
  ('monthly_report_band_high', '250',
     'Sales band: stores at or above this (RM) are green, "RM250 and above"'),
  ('monthly_report_band_mid', '100',
     'Sales band: stores at or above this (RM) and below the high edge are amber; below it is red')
ON CONFLICT (key) DO NOTHING;
