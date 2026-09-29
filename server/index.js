import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString, ssl: connectionString?.includes('localhost') ? false : { rejectUnauthorized: false } });
const secret = process.env.SESSION_SECRET || 'development-only-change-me';
const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(cookieParser());
if (!process.env.VERCEL) app.use(express.static(path.join(root, 'dist')));
app.get('/', (_req, res) => res.sendFile(path.join(root, process.env.VERCEL ? 'public' : 'dist', 'index.html')));

let readyPromise;
export function ensureReady() {
  if (!readyPromise) readyPromise = (async () => {
    if (!connectionString) throw new Error('DATABASE_URL이 설정되지 않았습니다.');
    await pool.query(await fs.readFile(path.join(root, 'db', 'schema.sql'), 'utf8'));
    const password = process.env.APP_PASSWORD;
    if (!password) throw new Error('APP_PASSWORD가 설정되지 않았습니다.');
    const hash = await bcrypt.hash(password, 12);
    for (const username of ['병호', '영원']) {
      await pool.query(`INSERT INTO app_users(username,password_hash) VALUES($1,$2)
        ON CONFLICT(username) DO UPDATE SET password_hash=EXCLUDED.password_hash`, [username, hash]);
    }
  })().catch(error => { readyPromise = undefined; throw error; });
  return readyPromise;
}

app.use('/api', async (_req, _res, next) => { try { await ensureReady(); next(); } catch (error) { next(error); } });
const sign = user => jwt.sign({ id: user.id, username: user.username }, secret, { expiresIn: '12h' });
function auth(req, res, next) {
  try { req.user = jwt.verify(req.cookies.bb_session, secret); next(); }
  catch { res.status(401).json({ error: '로그인이 필요합니다.' }); }
}
const monthDate = value => `${String(value || '').slice(0, 7)}-01`;

app.get('/api/health', (_req, res) => res.json({ ok: true, database: 'neon' }));
app.post('/api/login', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM app_users WHERE username=$1', [req.body.username]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(String(req.body.password || ''), user.password_hash))) return res.status(401).json({ error: '이름 또는 비밀번호를 확인해 주세요.' });
  res.cookie('bb_session', sign(user), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 43200000 });
  res.json({ user: { username: user.username } });
});
app.post('/api/logout', (_req, res) => { res.clearCookie('bb_session'); res.json({ ok: true }); });

app.get('/api/data', auth, async (req, res) => {
  const selected = monthDate(req.query.month || new Date().toISOString().slice(0, 7));
  const [categories, budgets, transactions, loans, repayments] = await Promise.all([
    pool.query('SELECT * FROM categories ORDER BY id'),
    pool.query('SELECT id,month,category_id,amount AS budget FROM budgets WHERE month=$1 ORDER BY category_id', [selected]),
    pool.query(`SELECT t.id,t.type,t.category_id,t.amount,t.title,t.management_month,t.actual_used_on,t.memo,u.username AS "user"
      FROM transactions t LEFT JOIN app_users u ON u.id=t.created_by ORDER BY t.actual_used_on DESC,t.created_at DESC`),
    pool.query(`SELECT l.id,l.name,l.lender,l.principal,l.started_on,l.due_on,
      GREATEST(0,l.principal-COALESCE(SUM(r.principal_amount),0)) AS balance
      FROM loans l LEFT JOIN loan_repayments r ON r.loan_id=l.id GROUP BY l.id ORDER BY l.created_at DESC`),
    pool.query(`SELECT r.id,r.loan_id,r.amount,r.principal_amount,r.interest_amount,r.paid_on,r.memo,l.name AS loan_name,u.username AS "user"
      FROM loan_repayments r JOIN loans l ON l.id=r.loan_id LEFT JOIN app_users u ON u.id=r.created_by ORDER BY r.paid_on DESC,r.created_at DESC`)
  ]);
  res.json({ categories: categories.rows, budgets: budgets.rows, transactions: transactions.rows, loans: loans.rows, repayments: repayments.rows });
});

app.post('/api/budgets/batch', auth, async (req, res) => {
  const selected = monthDate(req.body.month), items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!/^\d{4}-\d{2}-01$/.test(selected) || !items.length) return res.status(400).json({ error: '예산 정보를 확인해 주세요.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of items) {
      await client.query('UPDATE categories SET name=$1 WHERE id=$2', [String(item.name).trim(), item.categoryId]);
      await client.query(`INSERT INTO budgets(month,category_id,amount,created_by) VALUES($1,$2,$3,$4)
        ON CONFLICT(month,category_id) DO UPDATE SET amount=EXCLUDED.amount,created_by=EXCLUDED.created_by`, [selected, item.categoryId, item.amount, req.user.id]);
    }
    await client.query('COMMIT'); res.json({ ok: true });
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
});
app.delete('/api/budgets/:month/:categoryId', auth, async (req, res) => {
  const result = await pool.query('DELETE FROM budgets WHERE month=$1 AND category_id=$2', [monthDate(req.params.month), req.params.categoryId]);
  res.json({ ok: true, deleted: result.rowCount });
});

app.post('/api/transactions', auth, async (req, res) => {
  const b = req.body;
  const { rows } = await pool.query(`INSERT INTO transactions(type,category_id,amount,title,occurred_on,management_month,actual_used_on,memo,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$5,$7,$8) RETURNING *`, [b.type, b.type === 'expense' ? b.categoryId : null, b.amount, b.title, b.actualDate, monthDate(b.managementMonth), b.memo || null, req.user.id]);
  res.status(201).json(rows[0]);
});
app.put('/api/transactions/:id', auth, async (req, res) => {
  const b = req.body;
  const { rows } = await pool.query(`UPDATE transactions SET title=$1,amount=$2,category_id=$3,management_month=$4,actual_used_on=$5,occurred_on=$5,memo=$6
    WHERE id=$7 RETURNING *`, [b.title, b.amount, b.type === 'income' ? null : b.categoryId, monthDate(b.managementMonth), b.actualDate, b.memo || null, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: '거래 내역을 찾을 수 없습니다.' }); res.json(rows[0]);
});
app.delete('/api/transactions/:id', auth, async (req, res) => { const r = await pool.query('DELETE FROM transactions WHERE id=$1', [req.params.id]); res.json({ ok: true, deleted: r.rowCount }); });

app.post('/api/loans', auth, async (req, res) => {
  const b = req.body; const { rows } = await pool.query('INSERT INTO loans(name,lender,principal,started_on,due_on,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [b.name,b.lender,b.principal,b.startDate,b.dueDate||null,req.user.id]); res.status(201).json(rows[0]);
});
app.put('/api/loans/:id', auth, async (req, res) => { const b=req.body; const {rows}=await pool.query('UPDATE loans SET name=$1,lender=$2,principal=$3,started_on=$4,due_on=$5 WHERE id=$6 RETURNING *',[b.name,b.lender,b.principal,b.startDate,b.dueDate||null,req.params.id]); res.json(rows[0]); });
app.delete('/api/loans/:id', auth, async (req, res) => { const r=await pool.query('DELETE FROM loans WHERE id=$1',[req.params.id]); res.json({ok:true,deleted:r.rowCount}); });

app.post('/api/repayments', auth, async (req, res) => { const b=req.body; const amount=Number(b.principalAmount)+Number(b.interestAmount); const {rows}=await pool.query('INSERT INTO loan_repayments(loan_id,amount,principal_amount,interest_amount,paid_on,memo,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[b.loanId,amount,b.principalAmount,b.interestAmount,b.date,b.memo||null,req.user.id]); res.status(201).json(rows[0]); });
app.put('/api/repayments/:id', auth, async (req, res) => { const b=req.body; const amount=Number(b.principalAmount)+Number(b.interestAmount); const {rows}=await pool.query('UPDATE loan_repayments SET loan_id=$1,amount=$2,principal_amount=$3,interest_amount=$4,paid_on=$5,memo=$6 WHERE id=$7 RETURNING *',[b.loanId,amount,b.principalAmount,b.interestAmount,b.date,b.memo||null,req.params.id]); res.json(rows[0]); });
app.delete('/api/repayments/:id', auth, async (req, res) => { const r=await pool.query('DELETE FROM loan_repayments WHERE id=$1',[req.params.id]); res.json({ok:true,deleted:r.rowCount}); });

app.post('/api/gemini/test', auth, async (req, res) => {
  const apiKey = String(req.body.apiKey || process.env.GEMINI_API_KEY || ''), model = String(req.body.model || 'gemini-2.5-flash');
  if (!apiKey) return res.status(400).json({ error: 'Gemini API 키를 입력해 주세요.' });
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({contents:[{parts:[{text:'연결 테스트입니다. 한국어로 연결 성공만 답해 주세요.'}]}]}) });
  const data = await response.json();
  if (!response.ok) return res.status(response.status).json({ error: data?.error?.message || '연결에 실패했습니다.' });
  res.json({ ok:true, message:data?.candidates?.[0]?.content?.parts?.[0]?.text || '연결 성공' });
});

if (!process.env.VERCEL) app.get('*', (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: err.message || '처리 중 오류가 발생했습니다.' }); });

export default app;

if (!process.env.VERCEL && process.argv[1] === fileURLToPath(import.meta.url)) {
  ensureReady().then(() => app.listen(Number(process.env.PORT || 3000), () => console.log('Bloom Budget server ready'))).catch(error => { console.error(error); process.exit(1); });
}
