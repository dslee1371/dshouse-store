// db.js — MySQL(IP/Port) 접속 전용 + 초기화 + 헬퍼
import mysql from 'mysql2/promise';

const {
  MYSQL_HOST = '34.84.243.137',
  MYSQL_PORT = '3306',
  MYSQL_USER = 'app-1',
  MYSQL_PASSWORD = 'temp1',
  MYSQL_DATABASE = 'kidswear',

  // ⬇️ 필요 시 외부 MySQL(Cloud, RDS 등)용 SSL 옵션
  MYSQL_SSL = 'false',                        // 'true'면 SSL 사용
  MYSQL_SSL_REJECT_UNAUTHORIZED = 'false',    // 'true'로 하면 CA 검증
  MYSQL_SSL_CA_BASE64,                        // (선택) CA 인증서(base64)
} = process.env;

const baseConfig = {
  host: MYSQL_HOST,
  port: Number(MYSQL_PORT),
  user: MYSQL_USER,
  password: MYSQL_PASSWORD,
  database: MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  connectTimeout: 10_000,
  // time/date를 문자열로 받을지 여부 (선택)
  // dateStrings: true,
};

let poolConfig = { ...baseConfig };
if (MYSQL_SSL === 'true') {
  const ssl = { rejectUnauthorized: MYSQL_SSL_REJECT_UNAUTHORIZED === 'true' };
  if (MYSQL_SSL_CA_BASE64) {
    ssl.ca = Buffer.from(MYSQL_SSL_CA_BASE64, 'base64').toString('utf8');
  }
  poolConfig.ssl = ssl;
}

const pool = mysql.createPool(poolConfig);

// 공용 쿼리 래퍼
const query = async (sql, params = []) => (await pool.query(sql, params))[0];

// ---------- 스키마 초기화 ----------
const init = async () => {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB;
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS products (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        price INT NOT NULL,
        description TEXT,
        image_path VARCHAR(512),
        stock INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB;
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        product_id INT,
        quantity INT NOT NULL,
        amount INT NOT NULL,
        buyer_name VARCHAR(255),
        buyer_email VARCHAR(255),
        status VARCHAR(32) DEFAULT 'pending',
        user_id INT,
        variant_id INT,
        option_size VARCHAR(64),
        option_color VARCHAR(64),
        ship_name VARCHAR(255),
        ship_phone VARCHAR(64),
        ship_postcode VARCHAR(32),
        ship_addr1 VARCHAR(255),
        ship_addr2 VARCHAR(255),
        ship_memo VARCHAR(1024),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_orders_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
        CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB;
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS product_images (
        id INT AUTO_INCREMENT PRIMARY KEY,
        product_id INT NOT NULL,
        image_path VARCHAR(512) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_images_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS product_variants (
        id INT AUTO_INCREMENT PRIMARY KEY,
        product_id INT NOT NULL,
        size VARCHAR(64),
        color VARCHAR(64),
        stock INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_variants_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);

    // 인덱스
    const idxExists = async (table, indexName) => {
      const rows = await query(
        `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
         WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND INDEX_NAME=? LIMIT 1`,
        [MYSQL_DATABASE, table, indexName]
      );
      return rows.length > 0;
    };
    if (!(await idxExists('product_variants', 'idx_variants_product'))) {
      await query(`CREATE INDEX idx_variants_product ON product_variants(product_id)`);
    }
    if (!(await idxExists('product_variants', 'idx_variants_key'))) {
      await query(`CREATE INDEX idx_variants_key ON product_variants(product_id, size, color)`);
    }
    if (!(await idxExists('orders', 'idx_orders_user'))) {
      await query(`CREATE INDEX idx_orders_user ON orders(user_id)`);
    }

  } catch (e) {
    console.error('[db.init] failed:', e?.message || e);
  }
};

// 헬퍼 (기존 코드 호환: lastID/changes 제공)
const all = query;
const get = async (s, p) => {
  const rows = await query(s, p);
  return rows[0] || null;
};
const run = async (s, p) => {
  const [r] = await pool.execute(s, p);
  return { lastID: r.insertId || 0, insertId: r.insertId || 0, changes: r.affectedRows || 0, raw: r };
};

export default { init, all, get, run };
