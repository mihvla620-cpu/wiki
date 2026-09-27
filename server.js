require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';

// Папка для загрузок
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + '-' + Math.random().toString(36).slice(2) + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// Умный SSL: включаем только если БД требует (по sslmode=require в URL)
const dbUrl = process.env.DATABASE_URL || '';
const needsSSL = dbUrl.includes('sslmode=require') || dbUrl.includes('neon.tech') || dbUrl.includes('aiven');

const pool = new Pool({
  connectionString: dbUrl,
  ssl: needsSSL ? { rejectUnauthorized: false } : false
});

// Не давать приложению падать при ошибках БД
process.on('unhandledRejection', (err) => {
  console.error('⚠️ Unhandled rejection:', err.message);
});
process.on('uncaughtException', (err) => {
  console.error('⚠️ Uncaught exception:', err.message);
});

app.use(cors());
app.use(express.json({ limit: '30mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ========== ИНИЦИАЛИЗАЦИЯ БД ==========
async function initDB() {
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'db', 'init.sql'), 'utf8');
    await pool.query(sql);

    const adminCheck = await pool.query('SELECT id FROM users WHERE username = $1', ['разработчик26']);
    if (adminCheck.rows.length === 0) {
      const hash = await bcrypt.hash('16042012', 10);
      await pool.query('INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)',
        ['разработчик26', hash, 'bureaucrat']);
      console.log('✅ Админ создан');
    }

    const pageCheck = await pool.query('SELECT id FROM pages WHERE title = $1', ['Main_Page']);
    if (pageCheck.rows.length === 0) {
      const pr = await pool.query('INSERT INTO pages (title) VALUES ($1) RETURNING id', ['Main_Page']);
      const ar = await pool.query('SELECT id FROM users WHERE username = $1', ['разработчик26']);
      await pool.query('INSERT INTO revisions (page_id, user_id, text, summary) VALUES ($1, $2, $3, $4)',
        [pr.rows[0].id, ar.rows[0].id, 'Главная страница нашей Википедии.', 'Создание']);
    }
    console.log('✅ База данных инициализирована');
  } catch (err) {
    console.error('❌ Ошибка инициализации БД:', err.message);
  }
}

// ========== АВТОРИЗАЦИЯ ==========
const auth = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return next();
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await pool.query('SELECT id, username, role, blocked FROM users WHERE id = $1', [decoded.id]);
    if (result.rows[0] && !result.rows[0].blocked) req.user = result.rows[0];
  } catch (e) {}
  next();
};
const requireAuth = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Требуется авторизация' });
const requireEditor = (req, res, next) => {
  if (!req.user || !['admin', 'bureaucrat', 'editor'].includes(req.user.role))
    return res.status(403).json({ error: 'Недостаточно прав' });
  next();
};
const requireAdmin = (req, res, next) => {
  if (!req.user || !['admin', 'bureaucrat'].includes(req.user.role))
    return res.status(403).json({ error: 'Только для админов' });
  next();
};
app.use(auth);

// ========== АУТЕНТИФИКАЦИЯ ==========
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Заполните поля' });
    const exists = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (exists.rows.length > 0) return res.status(400).json({ error: 'Пользователь существует' });
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username, role',
      [username, hash]);
    const token = jwt.sign({ id: r.rows[0].id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const r = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (r.rows.length === 0) return res.status(400).json({ error: 'Неверный логин или пароль' });
    const user = r.rows[0];
    if (user.blocked) return res.status(403).json({ error: 'Аккаунт заблокирован' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(400).json({ error: 'Неверный логин или пароль' });
    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: req.user }));

// ========== СТРАНИЦЫ ==========
app.get('/api/pages', async (req, res) => {
  const r = await pool.query('SELECT id, title, namespace, protected, updated_at FROM pages ORDER BY title');
  res.json(r.rows);
});

app.get('/api/pages/:title', async (req, res) => {
  const pr = await pool.query('SELECT * FROM pages WHERE title = $1', [req.params.title]);
  if (pr.rows.length === 0) return res.status(404).json({ error: 'Не найдено' });
  const rr = await pool.query(`SELECT r.*, u.username FROM revisions r 
    LEFT JOIN users u ON u.id = r.user_id WHERE r.page_id = $1 
    ORDER BY r.created_at DESC LIMIT 1`, [pr.rows[0].id]);
  res.json({ page: pr.rows[0], revision: rr.rows[0] || null });
});

app.post('/api/pages/:title', requireAuth, async (req, res) => {
  try {
    const { title } = req.params;
    const { text, summary, minor, namespace = 'Main' } = req.body;
    let pr = await pool.query('SELECT * FROM pages WHERE title = $1', [title]);
    let page;
    if (pr.rows.length === 0) {
      const np = await pool.query('INSERT INTO pages (title, namespace) VALUES ($1, $2) RETURNING *', [title, namespace]);
      page = np.rows[0];
    } else {
      page = pr.rows[0];
      if (page.protected && !['admin','bureaucrat','editor'].includes(req.user.role))
        return res.status(403).json({ error: 'Страница защищена' });
    }
    await pool.query('INSERT INTO revisions (page_id, user_id, text, summary, minor) VALUES ($1,$2,$3,$4,$5)',
      [page.id, req.user.id, text, summary || 'Нет описания', minor || false]);
    await pool.query('UPDATE pages SET updated_at = NOW() WHERE id = $1', [page.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/pages/:title/revisions', async (req, res) => {
  const pr = await pool.query('SELECT id FROM pages WHERE title = $1', [req.params.title]);
  if (pr.rows.length === 0) return res.json([]);
  const r = await pool.query(`SELECT r.id, r.text, r.summary, r.minor, r.created_at, u.username 
    FROM revisions r LEFT JOIN users u ON u.id = r.user_id WHERE r.page_id = $1 
    ORDER BY r.created_at DESC`, [pr.rows[0].id]);
  res.json(r.rows);
});

app.post('/api/pages/:title/rollback/:revId', requireEditor, async (req, res) => {
  const pr = await pool.query('SELECT id FROM pages WHERE title = $1', [req.params.title]);
  if (pr.rows.length === 0) return res.status(404).json({ error: 'Не найдено' });
  const rev = await pool.query('SELECT text FROM revisions WHERE id = $1', [req.params.revId]);
  if (rev.rows.length === 0) return res.status(404).json({ error: 'Версия не найдена' });
  await pool.query('INSERT INTO revisions (page_id, user_id, text, summary) VALUES ($1,$2,$3,$4)',
    [pr.rows[0].id, req.user.id, rev.rows[0].text, `Откат к версии ${req.params.revId}`]);
  res.json({ success: true });
});

// ========== ОБСУЖДЕНИЕ ==========
app.get('/api/pages/:title/talk', async (req, res) => {
  const pr = await pool.query('SELECT id FROM pages WHERE title = $1', [req.params.title]);
  if (pr.rows.length === 0) return res.json([]);
  const r = await pool.query(`SELECT t.*, u.username FROM talk_messages t 
    LEFT JOIN users u ON u.id = t.user_id WHERE t.page_id = $1 ORDER BY t.created_at ASC`, [pr.rows[0].id]);
  res.json(r.rows);
});

app.post('/api/pages/:title/talk', requireAuth, async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Пусто' });
  let pr = await pool.query('SELECT id FROM pages WHERE title = $1', [req.params.title]);
  let pid;
  if (pr.rows.length === 0) {
    const np = await pool.query('INSERT INTO pages (title) VALUES ($1) RETURNING id', [req.params.title]);
    pid = np.rows[0].id;
  } else pid = pr.rows[0].id;
  await pool.query('INSERT INTO talk_messages (page_id, user_id, text) VALUES ($1,$2,$3)', [pid, req.user.id, text]);
  res.json({ success: true });
});

// ========== СПИСОК НАБЛЮДЕНИЯ ==========
app.post('/api/pages/:title/watch', requireAuth, async (req, res) => {
  const pr = await pool.query('SELECT id FROM pages WHERE title = $1', [req.params.title]);
  if (pr.rows.length === 0) return res.status(404).json({ error: 'Не найдено' });
  const pid = pr.rows[0].id;
  const chk = await pool.query('SELECT 1 FROM watchlist WHERE user_id=$1 AND page_id=$2', [req.user.id, pid]);
  if (chk.rows.length > 0) {
    await pool.query('DELETE FROM watchlist WHERE user_id=$1 AND page_id=$2', [req.user.id, pid]);
    res.json({ watched: false });
  } else {
    await pool.query('INSERT INTO watchlist (user_id, page_id) VALUES ($1,$2)', [req.user.id, pid]);
    res.json({ watched: true });
  }
});

app.get('/api/watchlist', requireAuth, async (req, res) => {
  const r = await pool.query(`SELECT p.title, p.updated_at FROM watchlist w 
    JOIN pages p ON p.id = w.page_id WHERE w.user_id = $1 ORDER BY p.updated_at DESC`, [req.user.id]);
  res.json(r.rows);
});

// ========== СВЕЖИЕ ПРАВКИ ==========
app.get('/api/recent', async (req, res) => {
  const r = await pool.query(`SELECT r.id, r.summary, r.minor, r.created_at, p.title, u.username 
    FROM revisions r JOIN pages p ON p.id = r.page_id 
    LEFT JOIN users u ON u.id = r.user_id ORDER BY r.created_at DESC LIMIT 50`);
  res.json(r.rows);
});

// ========== ПОИСК ==========
app.get('/api/search', async (req, res) => {
  const q = `%${req.query.q || ''}%`;
  const r = await pool.query(`SELECT DISTINCT p.title, p.namespace,
    (SELECT text FROM revisions WHERE page_id = p.id ORDER BY created_at DESC LIMIT 1) as snippet
    FROM pages p LEFT JOIN revisions r ON r.page_id = p.id
    WHERE p.title ILIKE $1 OR r.text ILIKE $1 LIMIT 20`, [q]);
  res.json(r.rows);
});

// ========== НАСТРОЙКИ ==========
app.get('/api/settings', async (req, res) => {
  const r = await pool.query('SELECT key, value FROM settings');
  const s = {};
  r.rows.forEach(x => s[x.key] = x.value);
  res.json(s);
});

app.post('/api/settings', requireAdmin, async (req, res) => {
  const { siteName, logoUrl } = req.body;
  if (siteName) await pool.query('INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2', ['siteName', siteName]);
  if (logoUrl) await pool.query('INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2', ['logoUrl', logoUrl]);
  res.json({ success: true });
});

// ========== НОВОСТИ (карусель) ==========
app.get('/api/news', async (req, res) => {
  const r = await pool.query(`SELECT n.*, u.username FROM news n 
    LEFT JOIN users u ON u.id = n.author_id ORDER BY n.created_at DESC LIMIT 20`);
  res.json(r.rows);
});

app.post('/api/news', requireEditor, async (req, res) => {
  const { title, content, image_url, article_link } = req.body;
  if (!title) return res.status(400).json({ error: 'Введите заголовок' });
  await pool.query('INSERT INTO news (title, content, image_url, article_link, author_id) VALUES ($1,$2,$3,$4,$5)',
    [title, content || '', image_url || '', article_link || '', req.user.id]);
  res.json({ success: true });
});

app.delete('/api/news/:id', requireEditor, async (req, res) => {
  await pool.query('DELETE FROM news WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

// ========== ГАЛЕРЕЯ ==========
app.get('/api/gallery', async (req, res) => {
  const r = await pool.query(`SELECT g.*, u.username FROM gallery g 
    LEFT JOIN users u ON u.id = g.uploader_id ORDER BY g.created_at DESC`);
  res.json(r.rows);
});

app.post('/api/gallery/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  const url = '/uploads/' + req.file.filename;
  const r = await pool.query('INSERT INTO gallery (filename, url, uploader_id) VALUES ($1,$2,$3) RETURNING *',
    [req.file.originalname, url, req.user.id]);
  res.json(r.rows[0]);
});

app.delete('/api/gallery/:id', requireAuth, async (req, res) => {
  const r = await pool.query('SELECT * FROM gallery WHERE id = $1', [req.params.id]);
  if (r.rows.length === 0) return res.status(404).json({ error: 'Не найдено' });
  if (r.rows[0].uploader_id !== req.user.id && !['admin','bureaucrat'].includes(req.user.role))
    return res.status(403).json({ error: 'Нет прав' });
  const filePath = path.join(__dirname, 'public', r.rows[0].url);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  await pool.query('DELETE FROM gallery WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

// ========== РЕКОМЕНДАЦИИ ==========
app.get('/api/recommendations', async (req, res) => {
  const r = await pool.query('SELECT * FROM recommendations ORDER BY position');
  res.json(r.rows);
});

app.post('/api/recommendations', requireAdmin, async (req, res) => {
  const { page_title, position } = req.body;
  await pool.query('INSERT INTO recommendations (page_title, position) VALUES ($1,$2)', [page_title, position || 0]);
  res.json({ success: true });
});

app.delete('/api/recommendations/:id', requireAdmin, async (req, res) => {
  await pool.query('DELETE FROM recommendations WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

// ========== ФОРУМ ==========
app.get('/api/forum', async (req, res) => {
  const r = await pool.query(`SELECT t.*, u.username,
    (SELECT COUNT(*) FROM forum_replies WHERE topic_id = t.id) as replies_count
    FROM forum_topics t LEFT JOIN users u ON u.id = t.author_id
    ORDER BY t.created_at DESC`);
  res.json(r.rows);
});

app.get('/api/forum/:id', async (req, res) => {
  const t = await pool.query(`SELECT t.*, u.username FROM forum_topics t 
    LEFT JOIN users u ON u.id = t.author_id WHERE t.id = $1`, [req.params.id]);
  if (t.rows.length === 0) return res.status(404).json({ error: 'Тема не найдена' });
  const rep = await pool.query(`SELECT r.*, u.username FROM forum_replies r 
    LEFT JOIN users u ON u.id = r.author_id WHERE r.topic_id = $1 ORDER BY r.created_at ASC`, [req.params.id]);
  res.json({ topic: t.rows[0], replies: rep.rows });
});

app.post('/api/forum', requireAuth, async (req, res) => {
  const { title, content } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'Заполните поля' });
  const r = await pool.query('INSERT INTO forum_topics (title, content, author_id) VALUES ($1,$2,$3) RETURNING id',
    [title, content, req.user.id]);
  res.json({ id: r.rows[0].id });
});

app.post('/api/forum/:id/reply', requireAuth, async (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'Пустое сообщение' });
  await pool.query('INSERT INTO forum_replies (topic_id, content, author_id) VALUES ($1,$2,$3)',
    [req.params.id, content, req.user.id]);
  res.json({ success: true });
});

// ========== АДМИН ==========
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  const r = await pool.query('SELECT id, username, role, blocked, created_at FROM users ORDER BY id');
  res.json(r.rows);
});

app.post('/api/admin/users/:id/block', requireAdmin, async (req, res) => {
  const r = await pool.query('UPDATE users SET blocked = NOT blocked WHERE id = $1 RETURNING blocked', [req.params.id]);
  res.json(r.rows[0]);
});

app.post('/api/admin/users/:id/role', requireAdmin, async (req, res) => {
  await pool.query('UPDATE users SET role = $1 WHERE id = $2', [req.body.role, req.params.id]);
  res.json({ success: true });
});

app.post('/api/admin/pages/:title/protect', requireAdmin, async (req, res) => {
  const r = await pool.query('UPDATE pages SET protected = NOT protected WHERE title = $1 RETURNING protected', [req.params.title]);
  res.json(r.rows[0]);
});

app.delete('/api/admin/pages/:title', requireAdmin, async (req, res) => {
  await pool.query('DELETE FROM pages WHERE title = $1', [req.params.title]);
  res.json({ success: true });
});

// ========== SPA FALLBACK ==========
// ========== БАННЕРЫ ==========
app.get('/api/banners', async (req, res) => {
  const r = await pool.query('SELECT * FROM banners WHERE active = TRUE ORDER BY side, position');
  res.json(r.rows);
});

app.post('/api/banners', requireAdmin, async (req, res) => {
  const { side, image_url, link_url } = req.body;
  if (!side || !image_url) return res.status(400).json({ error: 'Заполните поля' });
  await pool.query('INSERT INTO banners (side, image_url, link_url) VALUES ($1,$2,$3)', [side, image_url, link_url || '']);
  res.json({ success: true });
});

app.delete('/api/banners/:id', requireAdmin, async (req, res) => {
  await pool.query('DELETE FROM banners WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

app.post('/api/banners/:id/toggle', requireAdmin, async (req, res) => {
  await pool.query('UPDATE banners SET active = NOT active WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

initDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 Сервер запущен на порту ${PORT}`));
});
