-- Customer accounts (people buying alert plans). Separate from admin_users on purpose:
-- a customer login never grants admin access, and vice versa.
CREATE TABLE customers (
  id               BIGSERIAL PRIMARY KEY,
  name             VARCHAR(80)  NOT NULL CHECK (length(btrim(name)) >= 2),
  email            VARCHAR(254) NOT NULL UNIQUE CHECK (email = lower(email) AND position('@' IN email) > 1),
  phone            VARCHAR(20)  NOT NULL CHECK (phone ~ '^\+?[0-9]{10,15}$'),
  experience_years SMALLINT     NOT NULL CHECK (experience_years BETWEEN 0 AND 60),
  password_hash    TEXT         NOT NULL,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_login_at    TIMESTAMPTZ
);
