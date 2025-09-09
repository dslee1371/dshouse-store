// db.js (MySQL 전용 풀 + 초기화 + 헬퍼)
import mysql from 'mysql2/promise';

const {
  MYSQL_HOST,
  MYSQL_PORT = '3306',
  MYSQL_USER = 'root',
  MYSQL_PASSWORD = 'Dongsu72071!',
  MYSQL_DATABASE = 'kidswear',
  INSTANCE_UNIX_SOCKET,
} = process.env;

const common = {
  user: MYSQL_USER,
  password: MYSQL_PASSWORD,
  database: MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  connectTimeout: 5000,
};

// ✅ Cloud Run(+Cloud SQL)에서는 소켓 경로를 우선 사용
const pool = mysql.createPool(
  INSTANCE_UNIX_SOCKET
    ? { ...common, socketPath: INSTANCE_UNIX_SOCKET }
    : { ...common, host: MYSQL_HOST || '127.0.0.1', port: Number(MYSQL_PORT) }
);

const query = async (sql, params=[]) => (await pool.query(sql, params))[0];

// 테이블/인덱스 보장
const init = async () => {
  // DB는 이미 존재한다고 가정 (필요하면 CREATE DATABASE 권한 확인)
  // 테이블 생성
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

    // 컬럼 보강 (이미 있으면 패스)
    const colExists = async (table, col) => {
      const rows = await query(
        `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=? LIMIT 1`,
        [MYSQL_DATABASE, table, col]
      );
      return rows.length > 0;
    };

    // 예: 과거 스키마에서 없을 수 있는 컬럼들
    if (!(await colExists('orders','user_id'))) {
      await query(`ALTER TABLE orders ADD COLUMN user_id INT NULL`);
    }
    if (!(await colExists('orders','variant_id'))) {
      await query(`ALTER TABLE orders ADD COLUMN variant_id INT NULL`);
    }
    if (!(await colExists('orders','option_size'))) {
      await query(`ALTER TABLE orders ADD COLUMN option_size VARCHAR(64) NULL`);
    }
    if (!(await colExists('orders','option_color'))) {
      await query(`ALTER TABLE orders ADD COLUMN option_color VARCHAR(64) NULL`);
    }
    
    // db.js init() 안, colExists 사용 파트에 추가
    if (!(await colExists('orders','ship_name')))     await query(`ALTER TABLE orders ADD COLUMN ship_name VARCHAR(100) NULL`);
    if (!(await colExists('orders','ship_phone')))    await query(`ALTER TABLE orders ADD COLUMN ship_phone VARCHAR(30) NULL`);
    if (!(await colExists('orders','ship_postcode'))) await query(`ALTER TABLE orders ADD COLUMN ship_postcode VARCHAR(10) NULL`);
    if (!(await colExists('orders','ship_addr1')))    await query(`ALTER TABLE orders ADD COLUMN ship_addr1 VARCHAR(255) NULL`);
    if (!(await colExists('orders','ship_addr2')))    await query(`ALTER TABLE orders ADD COLUMN ship_addr2 VARCHAR(255) NULL`);
    if (!(await colExists('orders','ship_memo')))     await query(`ALTER TABLE orders ADD COLUMN ship_memo VARCHAR(255) NULL`);
    
    // 인덱스 보장
    const idxExists = async (table, indexName) => {
      const rows = await query(
        `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND INDEX_NAME=? LIMIT 1`,
        [MYSQL_DATABASE, table, indexName]
      );
      return rows.length > 0;
    };

    if (!(await idxExists('product_variants','idx_variants_product'))) {
      await query(`CREATE INDEX idx_variants_product ON product_variants(product_id)`);
    }
    if (!(await idxExists('product_variants','idx_variants_key'))) {
      await query(`CREATE INDEX idx_variants_key ON product_variants(product_id, size, color)`);
    }
    if (!(await idxExists('orders','idx_orders_user'))) {
      await query(`CREATE INDEX idx_orders_user ON orders(user_id)`);
    }
  } catch (e) {
    console.error('[db.init] failed:', e?.message || e);
  }

};

// 헬퍼 (기존 코드 호환: lastID/changes 제공)
const all = query;
const get = async (s,p)=> { const rows = await query(s,p); return rows[0] || null; };
const run = async (s,p)=> { const [r] = await pool.execute(s,p); return { lastID: r.insertId || 0, changes: r.affectedRows || 0 }; };

export default { init, all, get, run };
