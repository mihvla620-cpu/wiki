CREATE TABLE IF NOT EXISTS banners (
  id SERIAL PRIMARY KEY,
  side VARCHAR(10) NOT NULL,
  image_url TEXT NOT NULL,
  link_url TEXT,
  active BOOLEAN DEFAULT TRUE,
  position INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);