-- 0007_communities: one community per sector (Sprint 6 P1). Membership is a feed filter only:
-- it never affects visibility, scoring or anything financial.
CREATE TABLE communities (
  id           uuid7 PRIMARY KEY,
  slug         text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,40}$'),
  name         text NOT NULL,
  description  text NOT NULL,
  -- Registry sectors (entities.sector) whose company posts appear in this community's feed.
  sectors      text[] NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE community_members (
  community_id  uuid NOT NULL REFERENCES communities (id),
  user_id       uuid NOT NULL REFERENCES users (id),
  joined_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, user_id)
);
CREATE INDEX community_members_user ON community_members (user_id);

ALTER TABLE posts ADD COLUMN community_id uuid REFERENCES communities (id);
CREATE INDEX posts_community ON posts (community_id, created_at DESC) WHERE community_id IS NOT NULL;

INSERT INTO communities (id, slug, name, description, sectors) VALUES
  ('01a1ca60-0000-7000-8000-000000000001', 'technology', 'Technology', 'Software, hardware, internet platforms and IT services.', ARRAY['Software', 'Technology Hardware', 'Internet', 'IT Services', 'Media']),
  ('01a1ca60-0000-7000-8000-000000000002', 'semiconductors', 'Semiconductors', 'Chip designers, foundries and equipment makers.', ARRAY['Semiconductors', 'Semiconductor Equipment']),
  ('01a1ca60-0000-7000-8000-000000000003', 'consumer', 'Consumer', 'Retail, autos, travel and consumer brands.', ARRAY['Automobiles', 'Internet Retail', 'Retail', 'Travel', 'Transportation']),
  ('01a1ca60-0000-7000-8000-000000000004', 'energy', 'Energy', 'Oil and gas, utilities and the energy transition.', ARRAY['Energy', 'Oil & Gas', 'Utilities']),
  ('01a1ca60-0000-7000-8000-000000000005', 'finance', 'Finance', 'Banks, insurers, payments and financial services.', ARRAY['Banks', 'Financial Services', 'Insurance', 'Diversified']),
  ('01a1ca60-0000-7000-8000-000000000006', 'crypto', 'Crypto', 'Crypto assets and the companies around them. Research only: no token trading here.', ARRAY['Crypto asset']);

GRANT SELECT ON communities TO suiem_app;
REVOKE INSERT, UPDATE ON communities FROM suiem_app;
GRANT SELECT, INSERT, DELETE ON community_members TO suiem_app;
