CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title VARCHAR(160) NOT NULL,
  organizer VARCHAR(120) NOT NULL,
  category VARCHAR(20) NOT NULL CHECK (category IN ('Workshop', 'Fest', 'Competition')),
  event_date DATE NOT NULL,
  time VARCHAR(16) NOT NULL,
  venue VARCHAR(200) NOT NULL,
  link VARCHAR(2048) NOT NULL DEFAULT '',
  image VARCHAR(2048) NOT NULL DEFAULT '',
  description VARCHAR(2000) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS events_event_date_idx ON events (event_date, created_at);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_expiration_idx ON sessions (expires_at);

INSERT INTO events (id, title, organizer, category, event_date, time, venue, link, image, description)
VALUES
  ('evt-001', 'Creative Coding Workshop', 'Campus Makers Club', 'Workshop', '2026-10-08', '15:00', 'Innovation Lab, Room 204', 'https://example.com/register/creative-coding', 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4', ''),
  ('evt-002', 'Autumn Lights Festival', 'Student Activities Council', 'Fest', '2026-10-16', '18:30', 'Central Quad', 'https://example.com/register/autumn-lights', 'https://images.unsplash.com/photo-1540575467063-178a50c2df87', ''),
  ('evt-003', 'Campus Startup Challenge', 'Entrepreneurship Society', 'Competition', '2026-10-22', '10:00', 'Business School Auditorium', 'https://example.com/register/startup-challenge', 'https://images.unsplash.com/photo-1521737604893-d14cc237f11d', ''),
  ('evt-004', 'Tensor Trails', 'IEEE Computer Society', 'Workshop', '2026-10-05', '11:00 AM', 'AIML Seminar Hall', '#', 'https://images.unsplash.com/photo-1509228468518-180dd4864904', 'A workshop focused on math and logic building.'),
  ('evt-005', 'WEB:RECON', 'IEEE WIE', 'Competition', '2026-09-25', '2:00 PM', 'AIML Seminar Hall', '#', 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4', 'A web development coding competition.'),
  ('evt-006', 'Pragati', 'BMSCE Dance Club', 'Fest', '2026-10-20', '9:00 AM', 'Main Auditorium', '#', 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad', 'A dance event.')
ON CONFLICT (id) DO NOTHING;
