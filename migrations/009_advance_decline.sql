-- Advance / decline indicator (2026-10-30). Adds an automatic "Advance Decline Signal" row: advancing minus declining
-- Nifty 50 stocks (each stock's price against its previous close), today vs the previous trading day. It starts at 0
-- until the first calculation.
INSERT INTO nifty_alerts (name, description, signal_value, enabled, display_order, indicator, higher_is_bullish, threshold)
SELECT 'Advance Decline Signal', 'Advancing minus declining Nifty 50 stocks, today vs the previous trading day', 0, TRUE,
       COALESCE((SELECT max(display_order) FROM nifty_alerts), 0) + 1, 'advdec', TRUE, 4
WHERE NOT EXISTS (SELECT 1 FROM nifty_alerts WHERE indicator = 'advdec');
UPDATE app_state SET updated_at = now() WHERE key = 'nifty_alerts';
