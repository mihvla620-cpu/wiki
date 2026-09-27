require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  try {
    const res = await pool.query('SELECT id, title FROM pages');
    let fixed = 0;
    for (const row of res.rows) {
      let decoded = row.title;
      try {
        const d = decodeURIComponent(row.title);
        if (d !== row.title && !/[\uFFFD]/.test(d)) decoded = d;
      } catch(e){}
      if (decoded !== row.title) {
        const exists = await pool.query('SELECT id FROM pages WHERE title = $1', [decoded]);
        if (exists.rows.length === 0) {
          await pool.query('UPDATE pages SET title = $1 WHERE id = $2', [decoded, row.id]);
          console.log('✅ Исправлено:', row.title, '→', decoded);
          fixed++;
        } else {
          await pool.query('DELETE FROM pages WHERE id = $1', [row.id]);
          console.log('🗑️ Удалён дубликат:', row.title);
        }
      }
    }
    console.log('\n📊 Итого исправлено:', fixed);
  } catch (e) {
    console.error('❌ Ошибка:', e.message);
  }
  process.exit();
})();