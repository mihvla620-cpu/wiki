-- Пользователи
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'user',
  blocked BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Страницы
CREATE TABLE IF NOT EXISTS pages (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) UNIQUE NOT NULL,
  namespace VARCHAR(50) DEFAULT 'Main',
  protected BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Ревизии
CREATE TABLE IF NOT EXISTS revisions (
  id SERIAL PRIMARY KEY,
  page_id INTEGER REFERENCES pages(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  text TEXT NOT NULL,
  summary VARCHAR(500),
  minor BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Обсуждения статей
CREATE TABLE IF NOT EXISTS talk_messages (
  id SERIAL PRIMARY KEY,
  page_id INTEGER REFERENCES pages(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  text TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Список наблюдения
CREATE TABLE IF NOT EXISTS watchlist (
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  page_id INTEGER REFERENCES pages(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, page_id)
);

-- Настройки
CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT
);

-- НОВОСТИ (для карусели на главной)
CREATE TABLE IF NOT EXISTS news (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  content TEXT,
  image_url TEXT,
  article_link VARCHAR(255),
  author_id INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- ГАЛЕРЕЯ
CREATE TABLE IF NOT EXISTS gallery (
  id SERIAL PRIMARY KEY,
  filename VARCHAR(255) NOT NULL,
  url TEXT NOT NULL,
  uploader_id INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- РЕКОМЕНДАЦИИ (настраивает админ)
CREATE TABLE IF NOT EXISTS recommendations (
  id SERIAL PRIMARY KEY,
  page_title VARCHAR(255) NOT NULL,
  position INTEGER DEFAULT 0
);

-- ФОРУМ: темы
CREATE TABLE IF NOT EXISTS forum_topics (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  author_id INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- ФОРУМ: ответы
CREATE TABLE IF NOT EXISTS forum_replies (
  id SERIAL PRIMARY KEY,
  topic_id INTEGER REFERENCES forum_topics(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  author_id INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Стартовые настройки
INSERT INTO settings (key, value) VALUES 
  ('siteName', 'Википедия'),
  ('logoUrl', 'logo.png')
ON CONFLICT (key) DO NOTHING;