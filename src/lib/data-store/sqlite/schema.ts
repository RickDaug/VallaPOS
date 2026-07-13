/**
 * Local (offline edition) SQLite schema — the CASH-ONLY subset of
 * `prisma/schema.prisma` (docs/EDITIONS.md §5). Single-tenant: `businessId`
 * columns are kept (so the shared DataStore signatures and query shapes are
 * reused verbatim) but collapse to one seeded business per install.
 *
 * Deliberately DROPPED vs. the Postgres schema: Better Auth tables (User/Session/
 * Account/Verification), Membership/TimeEntry (replaced by a tiny `operator`
 * table), all Stripe/QR fields on business, and the restaurant floor/tabs models.
 *
 * Invariants preserved: money is INTEGER cents, tax is INTEGER basis points
 * (SQLite INTEGER is 64-bit — exact). Enums are stored as TEXT; booleans as 0/1;
 * timestamps as ISO-8601 TEXT.
 *
 * Statements are split on `;` by the migrator, so keep one statement per `;` and
 * no semicolons inside a statement.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS business (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  mode               TEXT NOT NULL DEFAULT 'STORE',
  taxRateBps         INTEGER NOT NULL DEFAULT 0,
  taxInclusive       INTEGER NOT NULL DEFAULT 0,
  currency           TEXT NOT NULL DEFAULT 'USD',
  timezone           TEXT NOT NULL DEFAULT 'America/New_York',
  singleOperatorMode INTEGER NOT NULL DEFAULT 0,
  createdAt          TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS operator (
  id         TEXT PRIMARY KEY,
  businessId TEXT NOT NULL REFERENCES business(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  pinHash    TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  createdAt  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_counter (
  businessId TEXT PRIMARY KEY REFERENCES business(id) ON DELETE CASCADE,
  lastNumber INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS category (
  id         TEXT PRIMARY KEY,
  businessId TEXT NOT NULL REFERENCES business(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  sortOrder  INTEGER NOT NULL DEFAULT 0,
  createdAt  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_category_business ON category(businessId);

CREATE TABLE IF NOT EXISTS item (
  id         TEXT PRIMARY KEY,
  businessId TEXT NOT NULL REFERENCES business(id) ON DELETE CASCADE,
  categoryId TEXT REFERENCES category(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'PRODUCT',
  trackStock INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1,
  createdAt  TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_item_business ON item(businessId);
CREATE INDEX IF NOT EXISTS idx_item_category ON item(categoryId);

CREATE TABLE IF NOT EXISTS variation (
  id         TEXT PRIMARY KEY,
  businessId TEXT NOT NULL REFERENCES business(id) ON DELETE CASCADE,
  itemId     TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  name       TEXT NOT NULL DEFAULT 'Default',
  sku        TEXT,
  priceCents INTEGER NOT NULL,
  stock      INTEGER,
  sortOrder  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_variation_item ON variation(itemId);

CREATE TABLE IF NOT EXISTS modifier_group (
  id         TEXT PRIMARY KEY,
  businessId TEXT NOT NULL REFERENCES business(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  minSelect  INTEGER NOT NULL DEFAULT 0,
  maxSelect  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS modifier (
  id              TEXT PRIMARY KEY,
  businessId      TEXT NOT NULL REFERENCES business(id) ON DELETE CASCADE,
  groupId         TEXT NOT NULL REFERENCES modifier_group(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  priceDeltaCents INTEGER NOT NULL DEFAULT 0,
  sortOrder       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_modifier_group ON modifier(groupId);

CREATE TABLE IF NOT EXISTS item_modifier_group (
  itemId  TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  groupId TEXT NOT NULL REFERENCES modifier_group(id) ON DELETE CASCADE,
  PRIMARY KEY (itemId, groupId)
);

CREATE TABLE IF NOT EXISTS "order" (
  id            TEXT PRIMARY KEY,
  businessId    TEXT NOT NULL REFERENCES business(id) ON DELETE CASCADE,
  clientUuid    TEXT NOT NULL,
  number        INTEGER NOT NULL,
  cashierId     TEXT,
  customerName  TEXT,
  status        TEXT NOT NULL DEFAULT 'PAID',
  subtotalCents INTEGER NOT NULL DEFAULT 0,
  discountCents INTEGER NOT NULL DEFAULT 0,
  taxCents      INTEGER NOT NULL DEFAULT 0,
  tipCents      INTEGER NOT NULL DEFAULT 0,
  totalCents    INTEGER NOT NULL DEFAULT 0,
  createdAt     TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (businessId, clientUuid),
  UNIQUE (businessId, number)
);
CREATE INDEX IF NOT EXISTS idx_order_business_created ON "order"(businessId, createdAt);

CREATE TABLE IF NOT EXISTS order_line (
  id             TEXT PRIMARY KEY,
  businessId     TEXT NOT NULL,
  orderId        TEXT NOT NULL REFERENCES "order"(id) ON DELETE CASCADE,
  variationId    TEXT,
  nameSnapshot   TEXT NOT NULL,
  unitPriceCents INTEGER NOT NULL,
  quantity       INTEGER NOT NULL DEFAULT 1,
  discountCents  INTEGER NOT NULL DEFAULT 0,
  taxCents       INTEGER NOT NULL DEFAULT 0,
  totalCents     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_line_order ON order_line(orderId);

CREATE TABLE IF NOT EXISTS order_line_modifier (
  id              TEXT PRIMARY KEY,
  orderLineId     TEXT NOT NULL REFERENCES order_line(id) ON DELETE CASCADE,
  nameSnapshot    TEXT NOT NULL,
  priceDeltaCents INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_olm_line ON order_line_modifier(orderLineId);

CREATE TABLE IF NOT EXISTS payment (
  id            TEXT PRIMARY KEY,
  businessId    TEXT NOT NULL,
  orderId       TEXT NOT NULL REFERENCES "order"(id) ON DELETE CASCADE,
  method        TEXT NOT NULL DEFAULT 'CASH',
  status        TEXT NOT NULL DEFAULT 'CAPTURED',
  amountCents   INTEGER NOT NULL,
  tenderedCents INTEGER,
  changeCents   INTEGER,
  cardBrand     TEXT,
  cardLast4     TEXT,
  processorRef  TEXT,
  createdAt     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payment_order ON payment(orderId);
CREATE INDEX IF NOT EXISTS idx_payment_business ON payment(businessId);

CREATE TABLE IF NOT EXISTS cash_drawer_session (
  id                TEXT PRIMARY KEY,
  businessId        TEXT NOT NULL REFERENCES business(id) ON DELETE CASCADE,
  openedById        TEXT,
  openingFloatCents INTEGER NOT NULL DEFAULT 0,
  expectedCents     INTEGER,
  countedCents      INTEGER,
  varianceCents     INTEGER,
  openedAt          TEXT NOT NULL DEFAULT (datetime('now')),
  closedAt          TEXT
);
CREATE INDEX IF NOT EXISTS idx_drawer_business ON cash_drawer_session(businessId);
`;
