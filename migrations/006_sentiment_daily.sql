-- One row per IST calendar day: the latest overall Nifty sentiment that day. Powers the trend chart
-- on the homepage. Rows are written automatically when the public sentiment is read.
CREATE TABLE nifty_sentiment_daily (
  day        DATE         PRIMARY KEY,
  percent    NUMERIC(6, 2) NOT NULL,
  label      TEXT         NOT NULL CHECK (label IN ('Bullish', 'Bearish', 'Neutral')),
  bullish    INTEGER      NOT NULL DEFAULT 0,
  bearish    INTEGER      NOT NULL DEFAULT 0,
  neutral    INTEGER      NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
