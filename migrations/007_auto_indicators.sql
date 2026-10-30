-- Automatic indicators (2026-10-30). An indicator row can be calculated from Angel One SmartAPI market data instead
-- of entered by hand. The rule is the same for every indicator: compare today's value with the previous close;
-- a change within `threshold` scores 0, otherwise +1 or -1 depending on whether the indicator moved in the bullish
-- direction. The score is written to signal_value, so the sentiment calculation itself is unchanged.
ALTER TABLE nifty_alerts
  ADD COLUMN indicator         VARCHAR(30)    CHECK (indicator IS NULL OR length(indicator) > 0), -- NULL = entered by hand
  ADD COLUMN higher_is_bullish BOOLEAN        NOT NULL DEFAULT TRUE,
  ADD COLUMN threshold         NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (threshold >= 0),
  ADD COLUMN prev_value        NUMERIC(16, 4),
  ADD COLUMN prev_day          DATE,
  ADD COLUMN current_value     NUMERIC(16, 4),
  ADD COLUMN current_day       DATE,
  ADD COLUMN auto_updated_at   TIMESTAMPTZ,
  ADD COLUMN auto_error        VARCHAR(300);

-- Daily values of series the API only gives for "now" (the Nifty put-call ratio), so today can be compared
-- with the previous trading day.
CREATE TABLE market_series_daily (
  series     VARCHAR(30)    NOT NULL,
  day        DATE           NOT NULL,
  value      NUMERIC(16, 4) NOT NULL,
  updated_at TIMESTAMPTZ    NOT NULL DEFAULT now(),
  PRIMARY KEY (series, day)
);

-- Switch the starter indicators to automatic (only rows still using their original names and entered by hand).
-- Volume, Support and OI can't be scored by "today vs previous close", so they become India VIX (a rise is
-- bearish) and the Nifty 50 close; OI is removed.
UPDATE nifty_alerts SET indicator = 'rsi14', threshold = 1, description = 'RSI (14) today vs the previous close'
  WHERE name = 'RSI Signal' AND indicator IS NULL;
UPDATE nifty_alerts SET indicator = 'macd', threshold = 1, description = 'MACD histogram (12, 26, 9) today vs the previous close'
  WHERE name = 'MACD Signal' AND indicator IS NULL;
UPDATE nifty_alerts SET indicator = 'ema20', threshold = 1, description = '20-day average of Nifty 50, rising or falling'
  WHERE name = 'Trend Signal' AND indicator IS NULL;
UPDATE nifty_alerts SET indicator = 'roc10', threshold = 0.1, description = '10-day rate of change (%) today vs the previous close'
  WHERE name = 'Momentum Signal' AND indicator IS NULL;
UPDATE nifty_alerts SET indicator = 'pcr', threshold = 0.02, description = 'Nifty put-call ratio today vs the previous trading day'
  WHERE name = 'PCR Signal' AND indicator IS NULL;
UPDATE nifty_alerts SET name = 'India VIX Signal', indicator = 'vix', higher_is_bullish = FALSE, threshold = 0.1,
    description = 'India VIX today vs the previous close (a rise in fear is bearish)'
  WHERE name = 'Volume Signal' AND indicator IS NULL;
UPDATE nifty_alerts SET name = 'Nifty Close Signal', indicator = 'close', threshold = 10,
    description = 'Nifty 50 price today vs the previous close'
  WHERE name = 'Support Signal' AND indicator IS NULL;
DELETE FROM nifty_alerts WHERE name = 'OI Signal' AND indicator IS NULL;
-- automatic rows start neutral: their hand-entered values no longer apply until the first calculation
UPDATE nifty_alerts SET signal_value = 0 WHERE indicator IS NOT NULL AND current_value IS NULL;
UPDATE app_state SET updated_at = now() WHERE key = 'nifty_alerts';
