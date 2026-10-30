-- Supertrend indicator (2026-10-30). Adds an automatic "Supertrend Signal" row: Supertrend (10, 3) on Nifty 50 daily
-- candles, compared as the Nifty close minus the Supertrend line (above 0 in an uptrend, below 0 in a downtrend).
-- It starts at 0 until the first calculation. Advance / decline is listed in the admin as "coming soon" only.
INSERT INTO nifty_alerts (name, description, signal_value, enabled, display_order, indicator, higher_is_bullish, threshold)
SELECT 'Supertrend Signal', 'Nifty 50 close minus the Supertrend (10, 3) line, today vs the previous close', 0, TRUE,
       COALESCE((SELECT max(display_order) FROM nifty_alerts), 0) + 1, 'supertrend', TRUE, 10
WHERE NOT EXISTS (SELECT 1 FROM nifty_alerts WHERE indicator = 'supertrend');
UPDATE app_state SET updated_at = now() WHERE key = 'nifty_alerts';
