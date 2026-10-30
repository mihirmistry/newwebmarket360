-- Plan purchases made through the QR checkout. The admin checks the payment, creates the customer's
-- login and emails the credentials, then marks the order done in /admin/orders.
CREATE TABLE plan_orders (
  id                BIGSERIAL PRIMARY KEY,
  plan_id           VARCHAR(20)  NOT NULL,
  plan_name         VARCHAR(40)  NOT NULL,
  amount            INTEGER      NOT NULL CHECK (amount > 0),
  name              VARCHAR(80)  NOT NULL CHECK (length(btrim(name)) >= 2),
  email             VARCHAR(254) NOT NULL CHECK (position('@' IN email) > 1),
  phone             VARCHAR(20)  NOT NULL CHECK (phone ~ '^\+?[0-9]{10,15}$'),
  experience_years  SMALLINT     NOT NULL CHECK (experience_years BETWEEN 0 AND 60),
  payment_ref       VARCHAR(40),
  status            VARCHAR(10)  NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'done')),
  admin_notified_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX plan_orders_created_idx ON plan_orders (created_at DESC);
