CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL CHECK (username IN ('병호', '영원')),
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  icon TEXT NOT NULL,
  color TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month DATE NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  created_by UUID REFERENCES app_users(id),
  UNIQUE(month, category_id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  category_id INTEGER REFERENCES categories(id),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  title TEXT NOT NULL,
  occurred_on DATE NOT NULL,
  management_month DATE NOT NULL,
  actual_used_on DATE NOT NULL,
  memo TEXT,
  created_by UUID REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS management_month DATE;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS actual_used_on DATE;
UPDATE transactions SET management_month=date_trunc('month',occurred_on)::date WHERE management_month IS NULL;
UPDATE transactions SET actual_used_on=occurred_on WHERE actual_used_on IS NULL;
ALTER TABLE transactions ALTER COLUMN management_month SET NOT NULL;
ALTER TABLE transactions ALTER COLUMN actual_used_on SET NOT NULL;
CREATE INDEX IF NOT EXISTS transactions_management_month_idx ON transactions(management_month);

CREATE TABLE IF NOT EXISTS loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  lender TEXT NOT NULL,
  principal NUMERIC(14,2) NOT NULL CHECK (principal > 0),
  interest_rate NUMERIC(6,3) NOT NULL CHECK (interest_rate >= 0),
  started_on DATE NOT NULL,
  due_on DATE,
  created_by UUID REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS loan_repayments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id UUID NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  principal_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  interest_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid_on DATE NOT NULL,
  memo TEXT,
  created_by UUID REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO categories(id, name, icon, color) VALUES
  (1, '주거·관리비', 'home', '#22c55e'), (2, '식비·장보기', 'utensils', '#f59e0b'),
  (3, '교통·주유', 'car', '#38bdf8'), (4, '통신·구독', 'signal', '#60a5fa'),
  (5, '보험', 'shield', '#a78bfa'), (6, '태권도', 'activity', '#fb7185'),
  (7, '영어', 'book', '#818cf8'), (8, '의료·교육 비정기', 'heart', '#f472b6'),
  (9, '공과금·생활용품', 'bulb', '#34d399'), (10, '외식·쇼핑·여가', 'sparkles', '#facc15'),
  (11, '비상예비비', 'reserve', '#94a3b8'), (12, '금융이자', 'percent', '#f97316')
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, icon=EXCLUDED.icon, color=EXCLUDED.color;

SELECT setval(pg_get_serial_sequence('categories','id'), GREATEST(12, (SELECT MAX(id) FROM categories)));

