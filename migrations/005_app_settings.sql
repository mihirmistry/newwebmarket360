-- Settings edited in the admin panel (e.g. SMTP and notification emails). Secrets inside are encrypted by the app.
CREATE TABLE app_settings (
  key        VARCHAR(60) PRIMARY KEY,
  value      JSONB       NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
