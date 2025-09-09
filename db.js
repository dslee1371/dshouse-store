import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'data.sqlite');
const db = new sqlite3.Database(dbPath);

// Promise helpers
const execP = (sql) => new Promise((resolve, reject) => db.exec(sql, (err) => err ? reject(err) : resolve()));
const allP  = (sql, params=[]) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows)));
const runP  = (sql, params=[]) => new Promise((resolve, reject) => db.run(sql, params, function(err){ if (err) reject(err); else resolve(this); }));

// 테이블 & 마이그레이션 (완료될 때까지 대기)
const init = async () => {
  // 1) 필수 테이블 일괄 생성
  await execP(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      price INTEGER NOT NULL,
      description TEXT,
      image_path TEXT,
      stock INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER,
      quantity INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      buyer_name TEXT,
      buyer_email TEXT,
      status TEXT DEFAULT 'pending',
      user_id INTEGER,
      variant_id INTEGER,
      option_size TEXT,
      option_color TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(product_id) REFERENCES products(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS product_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      image_path TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS product_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      size TEXT,
      color TEXT,
      stock INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(product_id) REFERENCES products(id)
    );

    CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);
    CREATE INDEX IF NOT EXISTS idx_variants_key ON product_variants(product_id,size,color);
  `);

  // 2) 기존 orders 테이블 컬럼 보강 (이미 있으면 무시)
  const cols = await allP(`PRAGMA table_info(orders)`);
  const names = cols.map(c => c.name);
  const alters = [];
  if (!names.includes('user_id'))     alters.push('ALTER TABLE orders ADD COLUMN user_id INTEGER');
  if (!names.includes('variant_id'))  alters.push('ALTER TABLE orders ADD COLUMN variant_id INTEGER');
  if (!names.includes('option_size')) alters.push('ALTER TABLE orders ADD COLUMN option_size TEXT');
  if (!names.includes('option_color'))alters.push('ALTER TABLE orders ADD COLUMN option_color TEXT');
  for (const sql of alters) {
    try { await runP(sql); } catch (e) { /* ignore if already added */ }
  }

  // 3) 인덱스 (컬럼 보강 후 생성)
  try { await runP('CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id)'); } catch (e) { /* ignore */ }
};

const all = (sql, params=[]) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
});

const get = (sql, params=[]) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
});

const run = (sql, params=[]) => new Promise((resolve, reject) => {
  db.run(sql, params, function(err){
    if (err) return reject(err);
    resolve(this);
  });
});

export default { db, init, all, get, run };