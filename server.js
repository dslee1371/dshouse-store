import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import db from './db.js';
import ejs from 'ejs';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// 비동기 에러 핸들러 래퍼
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// DB 초기화 완료까지 대기 (테이블 생성/마이그레이션 보장)
const PORT = Number(process.env.PORT) || 8080;

app.get('/healthz', (req,res) => res.status(200).send('ok')); // 선택


// DB 초기화는 비치명적으로 백그라운드에서
(async () => {
  try {
    await db.init();
    console.log('DB init OK');
  } catch (e) {
    console.error('DB init failed (non-fatal):', e?.message || e);
  }
})();


// 업로드 스토리지
const uploadDir = path.join(__dirname, 'uploads');
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g,'');
    cb(null, `${Date.now()}_${base}${ext}`);
  }
});
const upload = multer({ storage });

// 미들웨어
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(session({
  secret: 'kidswear-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 1000*60*60*8 }
}));

// 정적 파일
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadDir));

// 뷰 엔진
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// 템플릿 헬퍼
const view = (name) => path.join(__dirname, 'views', `${name}.ejs`);
const renderEJS = (name, data={}) => new Promise((resolve, reject) => {
  ejs.renderFile(view(name), data, {}, (err, str)=> err?reject(err):resolve(str));
});
const renderSync = (name, data={}) => {
  const tpl = fs.readFileSync(view(name), 'utf8');
  return ejs.render(tpl, data);
};

// 인증 헬퍼
const ensureAdmin = (req, res, next) => {
  if (req.session?.isAdmin) return next();
  res.redirect('/admin/login');
};

// 홈(상품 목록) - 옵션 재고 합산 표시
app.get('/', ah(async (req, res) => {
  const products = await db.all(`
    SELECT p.*, COALESCE((SELECT SUM(stock) FROM product_variants v WHERE v.product_id=p.id), p.stock) AS total_stock
    FROM products p
    ORDER BY p.created_at DESC
  `);
  res.render('layout', {
    title: '아동복샵',
    user: req.session.user || null,     // ← 추가(보강)
    body: await renderEJS('index', { products })
  });
}));


// 갤러리 셔플
function shuffle(arr){ for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; } return arr; }

// 상품 상세 (갤러리 + 옵션)
app.get('/product/:id', ah(async (req, res) => {
  const product = await db.get('SELECT * FROM products WHERE id=?', [req.params.id]);
  if (!product) return res.status(404).send('상품을 찾을 수 없습니다');
  const rows = await db.all('SELECT image_path FROM product_images WHERE product_id=? ORDER BY id DESC', [product.id]);
  let gallery = rows.map(r=>r.image_path);
  if (gallery.length === 0 && product.image_path) gallery = [product.image_path];
  shuffle(gallery);

  const variants = await db.all('SELECT id,size,color,stock FROM product_variants WHERE product_id=? ORDER BY id ASC', [product.id]);

  res.render('layout', {
  title: product.title,
  body: await renderEJS('product', { product, gallery, variants, user: req.session.user || null })
  });

}));

// ✅ 계좌송금 방식 체크아웃 (옵션 유효성 검사)
// ✅ 계좌송금 체크아웃 (옵션/재고 검증 + user_id 저장)
app.post('/checkout', ensureAuth, ah(async (req, res) => {
  // body에서 꺼낼 때 변수명 충돌/TDZ 방지 위해 "Raw" 이름으로 받기
  const { product_id, quantity, variant_id } = req.body || {};
  const buyerNameRaw  = (req.body?.buyer_name  ?? '').trim();
  const buyerEmailRaw = (req.body?.buyer_email ?? '').trim();

  const product = await db.get('SELECT * FROM products WHERE id=?', [product_id]);
  if (!product) return res.status(400).send('상품 없음');

  const qty = Math.max(1, parseInt(quantity || '1', 10) || 1);
  const amountKRW = product.price * qty;

  // 옵션/재고 검증
  const variants = await db.all(
    'SELECT id,size,color,stock FROM product_variants WHERE product_id=?',
    [product.id]
  );
  let option_size = null, option_color = null, vid = null;

  if (variants.length > 0) {
    vid = parseInt(variant_id || '0', 10);
    const v = variants.find(x => x.id === vid);
    if (!v) return res.status(400).send('옵션을 선택해주세요');
    if (qty > (v.stock || 0)) return res.status(400).send('선택한 옵션의 재고가 부족합니다');
    option_size = v.size; option_color = v.color;
  } else {
    if (qty > (product.stock || 0)) return res.status(400).send('재고가 부족합니다');
  }

  // 로그인 사용자와 폼 값을 합쳐서 사용
  const uid        = req.session.user?.id || null;
  const buyerName  = buyerNameRaw  || req.session.user?.name  || '';
  const buyerEmail = buyerEmailRaw || req.session.user?.email || '';

  const order = await db.run(
    `INSERT INTO orders
     (product_id, user_id, variant_id, option_size, option_color,
      quantity, amount, buyer_name, buyer_email, status)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [product.id, uid, vid, option_size, option_color,
     qty, amountKRW, buyerName, buyerEmail, 'pending']
  );

  const optionText = option_size || option_color
    ? `${option_size || ''}${option_color ? ' / ' + option_color : ''}` : '';

  const body = await renderEJS('checkout', {
    orderId: order.lastID,
    amount: amountKRW,
    productTitle: product.title,
    optionText,
    buyerName
  });
  res.render('layout', { title: '입금 안내', body });
}));


// (관리자) 입금확인 처리 + 재고 차감
app.post('/admin/orders/:id/mark-paid', ensureAdmin, ah(async (req, res) => {
  const order = await db.get('SELECT * FROM orders WHERE id=?', [req.params.id]);
  if (!order) return res.redirect('/admin/orders');

  if (order.variant_id) {
    await db.run('UPDATE product_variants SET stock = GREATEST(stock - ?, 0) WHERE id=?', [order.quantity, order.variant_id]);
  } else {
    await db.run('UPDATE products SET stock = GREATEST(stock - ?, 0) WHERE id=?', [order.quantity, order.product_id]);
  }
  await db.run("UPDATE orders SET status='paid' WHERE id=?", [req.params.id]);

  res.redirect('/admin/orders');
}));

// 판매자 로그인/대시보드/등록/주문
app.get('/admin/login', (req, res) => {
  if (req.session?.isAdmin) return res.redirect('/admin');
  res.render('layout', { title: '판매자 로그인', body: renderSync('admin_login') });
});

app.post('/admin/login', (req, res) => {
  const { password } = req.body;
  if (password && process.env.ADMIN_PASSWORD && password === process.env.ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.redirect('/admin');
  }
  res.status(401).send('비밀번호가 올바르지 않습니다');
});

app.get('/admin', ensureAdmin, ah(async (req, res) => {
  const products = await db.all('SELECT * FROM products ORDER BY created_at DESC');
  res.render('layout', { title: '판매자 대시보드', body: await renderEJS('admin_dashboard', { products }) });
}));

app.get('/admin/new', ensureAdmin, (req, res) => {
  res.render('layout', { title: '상품 등록', body: renderSync('admin_new') });
});

// 다중 이미지 + 옵션 생성
app.post('/admin/new', ensureAdmin, upload.array('images', 12), ah(async (req, res) => {
  const { title, price, description } = req.body;
  const stockRaw = parseInt(req.body.stock||'0',10);
  const files = req.files || [];
  const first = files[0]?.filename ? `/uploads/${files[0].filename}` : null;
  const p = parseInt(price||'0',10);
  if (!title || isNaN(p)) return res.status(400).send('입력값 오류');

  const result = await db.run('INSERT INTO products (title, price, description, image_path, stock) VALUES (?,?,?,?,?)',
    [title, p, description||'', first, isNaN(stockRaw)?0:stockRaw]);
  const productId = result.lastID;

  for (const f of files) {
    const pathUrl = `/uploads/${f.filename}`;
    await db.run('INSERT INTO product_images (product_id, image_path) VALUES (?,?)', [productId, pathUrl]);
  }

  // 옵션 배열 수집 (opt_size[], opt_color[], opt_stock[])
  const sizes = [].concat(req.body['opt_size[]'] || req.body.opt_size || []);
  const colors = [].concat(req.body['opt_color[]'] || req.body.opt_color || []);
  const stocks = [].concat(req.body['opt_stock[]'] || req.body.opt_stock || []);

  for (let i=0;i<sizes.length;i++){
    const s = (Array.isArray(sizes)?sizes[i]:sizes) || '';
    const c = (Array.isArray(colors)?colors[i]:colors) || '';
    const st = parseInt(Array.isArray(stocks)?stocks[i]:stocks,10);
    if ((s||c) && !isNaN(st)){
      await db.run('INSERT INTO product_variants (product_id, size, color, stock) VALUES (?,?,?,?)', [productId, s, c, Math.max(0, st)]);
    }
  }

  res.redirect('/admin');
}));

// ▼ 템플릿에서 user를 쓰기 위한 미들웨어(중복 OK)
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

// ▼ 로그인/회원가입/로그아웃 라우트 (중복되면 기존 것을 이걸로 교체)
app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/account');
  res.render('layout', { title: '로그인', body: renderSync('user_login') });
});

app.post('/login', ah(async (req, res) => {
  const { email, password } = req.body;
  const user = await db.get('SELECT * FROM users WHERE email=?', [email]);
  if (!user) return res.status(401).send('이메일 또는 비밀번호가 올바르지 않습니다');
  const ok = await (await import('bcryptjs')).default.compare(password, user.password_hash);
  if (!ok) return res.status(401).send('이메일 또는 비밀번호가 올바르지 않습니다');
  req.session.user = { id: user.id, email: user.email, name: user.name };
  res.redirect('/account');
}));

app.get('/signup', (req, res) => {
  if (req.session.user) return res.redirect('/account');
  res.render('layout', { title: '회원가입', body: renderSync('user_signup') });
});

app.post('/signup', ah(async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password) return res.status(400).send('이메일과 비밀번호를 입력하세요');
  const exists = await db.get('SELECT id FROM users WHERE email=?', [email]);
  if (exists) return res.status(409).send('이미 가입된 이메일입니다');
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(password, 10);
  const u = await db.run('INSERT INTO users (email, password_hash, name) VALUES (?,?,?)', [email, hash, name||'']);
  req.session.user = { id: u.lastID, email, name: name||'' };
  res.redirect('/account');
}));

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ▼ 마이페이지

// 로그인 강제 + 리다이렉트 복귀 지원
const ensureAuth = (req, res, next) => {
  if (req.session?.user) return next();
  // 로그인 후 돌아올 위치 저장
  req.session.nextUrl = req.originalUrl || '/';
  return res.redirect('/login');
};

app.get('/account', ensureAuth, ah(async (req, res) => {
  const user = req.session.user;
  const orders = await db.all(`
    SELECT o.*, p.title FROM orders o
    LEFT JOIN products p ON p.id=o.product_id
    WHERE o.user_id=?
    ORDER BY o.created_at DESC
  `, [user.id]);
  const body = await renderEJS('user_account', { user, orders });
  res.render('layout', { title: '마이페이지', body });
}));


app.get('/admin/orders', ensureAdmin, ah(async (req, res) => {
  const orders = await db.all(`SELECT o.*, p.title FROM orders o LEFT JOIN products p ON p.id=o.product_id ORDER BY o.created_at DESC`);
  res.render('layout', { title: '주문 목록', body: await renderEJS('admin_orders', { orders }) });
}));


app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});



// 서버 시작
app.listen(PORT, () => {
  console.log('Kidswear shop running on http://localhost:'+PORT);
});
