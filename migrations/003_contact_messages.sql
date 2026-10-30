-- Messages sent from the public Contact page; read and handled in the admin panel (/admin/messages).
CREATE TABLE contact_messages (
  id          BIGSERIAL PRIMARY KEY,
  name        VARCHAR(80)   NOT NULL CHECK (length(btrim(name)) >= 2),
  email       VARCHAR(254)  NOT NULL CHECK (position('@' IN email) > 1),
  phone       VARCHAR(20)   CHECK (phone IS NULL OR phone ~ '^\+?[0-9]{10,15}$'),
  topic       VARCHAR(20)   NOT NULL,
  message     VARCHAR(2000) NOT NULL CHECK (length(btrim(message)) >= 10),
  customer_id BIGINT        REFERENCES customers (id) ON DELETE SET NULL,
  status      VARCHAR(10)   NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'handled')),
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX contact_messages_created_idx ON contact_messages (created_at DESC);
