-- Admin accounts. Passwords are stored as scrypt hashes, never in plain text.
CREATE TABLE admin_users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT        NOT NULL UNIQUE CHECK (email = lower(email) AND position('@' IN email) > 1),
  password_hash TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

-- Configured market alerts. signal_value is signed: +2 strong bullish ... -2 strong bearish.
CREATE TABLE nifty_alerts (
  id            BIGSERIAL PRIMARY KEY,
  name          VARCHAR(80)   NOT NULL CHECK (length(btrim(name)) > 0),
  description   VARCHAR(300)  NOT NULL DEFAULT '',
  signal_value  NUMERIC(6, 2) NOT NULL CHECK (signal_value BETWEEN -100 AND 100),
  enabled       BOOLEAN       NOT NULL DEFAULT TRUE,
  display_order INTEGER       NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX nifty_alerts_display_order_idx ON nifty_alerts (display_order, id);

-- Small key/value table; records when the alert configuration last changed (including deletes).
CREATE TABLE app_state (
  key        TEXT PRIMARY KEY,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO app_state (key) VALUES ('nifty_alerts');

-- Session store used by connect-pg-simple.
CREATE TABLE user_sessions (
  sid    VARCHAR      NOT NULL COLLATE "default" PRIMARY KEY,
  sess   JSON         NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX user_sessions_expire_idx ON user_sessions (expire);

-- Eight example alerts to start with; admins can edit, disable, delete or add more.
INSERT INTO nifty_alerts (name, description, signal_value, enabled, display_order) VALUES
  ('RSI Signal',      'Relative Strength Index momentum reading',         2, TRUE, 1),
  ('MACD Signal',     'MACD line position relative to its signal line',  1, TRUE, 2),
  ('Trend Signal',    'Price relative to key moving averages',           -2, TRUE, 3),
  ('Volume Signal',   'Volume compared with the 20-day average',          1, TRUE, 4),
  ('Support Signal',  'Price reaction at nearby support levels',         -1, TRUE, 5),
  ('Momentum Signal', 'Short-term price momentum',                        2, TRUE, 6),
  ('PCR Signal',      'Put-call ratio from the Nifty option chain',       0, TRUE, 7),
  ('OI Signal',       'Change in call and put open interest',             0, TRUE, 8);
