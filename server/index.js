import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 3000);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const secret = process.env.SESSION_SECRET || 'development-only-change-me';

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(root, 'dist')));

const sign = (user) => jwt.sign({ id: user.id, username: user.username }, secret, { expiresIn: '12h' });
function auth(req, res, next) {
  try { req.user = jwt.verify(req.cookies.bb_session, secret); next(); }
  catch { res.status(401).json({ error: '로그인이 필요합니다.' }); }
}

async function ensureUsers() {
  const password = process.env.APP_PASSWORD;
  if (!password) throw new Error('APP_PASSWORD가 설정되지 않았습니다.');
  const hash = await bcrypt.hash(password, 12);
  for (const username of ['병호', '영원']) {
    await pool.query('INSERT INTO app_users(username,password_hash) VALUES($1,$2) ON CONFLICT(username) DO UPDATE SET password_hash=EXCLUDED.password_hash', [username, hash]);
  }
}

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const { rows } = await pool.query('SELECT * FROM app_users WHERE username=$1', [username]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(String(password || ''), user.password_hash))) return res.status(401).json({ error: '이름 또는 비밀번호를 확인해 주세요.' });
  res.cookie('bb_session', sign(user), { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 43200000 });
  res.json({ user: { username: user.username } });
});
app.post('/api/logout', (_req, res) => { res.clearCookie('bb_session'); res.json({ ok: true }); });

app.get('/api/dashboard', auth, async (req, res) => {
  const month = String(req.query.month || new Date().toISOString().slice(0,7)) + '-01';
  const [summary, budgets, recent, loans] = await Promise.all([
    pool.query(`SELECT COALESCE(SUM(amount) FILTER(WHERE type='income'),0) income, COALESCE(SUM(amount) FILTER(WHERE type='expense'),0) expense FROM transactions WHERE management_month=$1`, [month]),
    pool.query(`SELECT c.name,c.icon,c.color,b.amount budget,COALESCE(SUM(t.amount),0) spent FROM budgets b JOIN categories c ON c.id=b.category_id LEFT JOIN transactions t ON t.category_id=c.id AND t.type='expense' AND t.management_month=b.month WHERE b.month=$1 GROUP BY c.id,b.amount ORDER BY b.amount DESC`, [month]),
    pool.query(`SELECT t.id,t.type,t.title,t.amount,t.management_month,t.actual_used_on,c.name category,c.icon,c.color,u.username FROM transactions t LEFT JOIN categories c ON c.id=t.category_id LEFT JOIN app_users u ON u.id=t.created_by ORDER BY t.actual_used_on DESC,t.created_at DESC LIMIT 8`),
    pool.query(`SELECT l.*,COALESCE(SUM(r.principal_amount),0) repaid,l.principal-COALESCE(SUM(r.principal_amount),0) balance FROM loans l LEFT JOIN loan_repayments r ON r.loan_id=l.id GROUP BY l.id ORDER BY l.created_at DESC`)
  ]);
  res.json({ summary: summary.rows[0], budgets: budgets.rows, recent: recent.rows, loans: loans.rows });
});

app.get('/api/categories', auth, async (_req,res) => res.json((await pool.query('SELECT * FROM categories ORDER BY id')).rows));

app.post('/api/budgets/batch', auth, async (req,res) => {
  const month=String(req.body.month||'')+'-01', items=Array.isArray(req.body.items)?req.body.items:[];
  if(!/^\d{4}-\d{2}-01$/.test(month)||!items.length) return res.status(400).json({error:'예산 정보를 확인해 주세요.'});
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    for(const item of items){
      await client.query('UPDATE categories SET name=$1 WHERE id=$2',[String(item.name).trim(),item.categoryId]);
      await client.query('INSERT INTO budgets(month,category_id,amount,created_by) VALUES($1,$2,$3,$4) ON CONFLICT(month,category_id) DO UPDATE SET amount=EXCLUDED.amount,created_by=EXCLUDED.created_by',[month,item.categoryId,item.amount,req.user.id]);
    }
    await client.query('COMMIT'); res.json({ok:true,count:items.length});
  } catch(error){await client.query('ROLLBACK');throw error} finally{client.release()}
});

app.post('/api/:resource', auth, async (req,res) => {
  const r=req.params.resource, b=req.body, uid=req.user.id;
  const map={
    budgets: ['INSERT INTO budgets(month,category_id,amount,created_by) VALUES($1,$2,$3,$4) ON CONFLICT(month,category_id) DO UPDATE SET amount=EXCLUDED.amount RETURNING *',[b.month+'-01',b.categoryId,b.amount,uid]],
    transactions: ['INSERT INTO transactions(type,category_id,amount,title,occurred_on,management_month,actual_used_on,memo,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[b.type,b.categoryId||null,b.amount,b.title,b.actualDate,b.managementMonth+'-01',b.actualDate,b.memo||null,uid]],
    loans: ['INSERT INTO loans(name,lender,principal,started_on,due_on,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[b.name,b.lender,b.principal,b.startDate,b.dueDate||null,uid]],
    repayments: ['INSERT INTO loan_repayments(loan_id,amount,principal_amount,interest_amount,paid_on,memo,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[b.loanId,b.amount,b.principalAmount,b.interestAmount,b.date,b.memo||null,uid]]
  };
  if(!map[r]) return res.status(404).json({error:'지원하지 않는 항목입니다.'});
  res.status(201).json((await pool.query(...map[r])).rows[0]);
});

app.put('/api/transactions/:id', auth, async (req,res) => {
  const b=req.body;
  const {rows}=await pool.query(`UPDATE transactions SET title=$1,amount=$2,category_id=$3,management_month=$4::date,actual_used_on=$5::date,occurred_on=$5::date,memo=$6 WHERE id=$7 RETURNING *`,[b.title,b.amount,b.categoryId,b.managementMonth+'-01',b.actualDate,b.memo||null,req.params.id]);
  if(!rows[0]) return res.status(404).json({error:'지출 내역을 찾을 수 없습니다.'});
  res.json(rows[0]);
});

app.delete('/api/transactions/:id', auth, async (req,res) => {
  const {rowCount}=await pool.query(`DELETE FROM transactions WHERE id=$1 AND type='expense'`,[req.params.id]);
  if(!rowCount) return res.status(404).json({error:'지출 내역을 찾을 수 없습니다.'});
  res.json({ok:true});
});

app.post('/api/gemini/test', auth, async (req,res) => {
  const apiKey=String(req.body.apiKey||process.env.GEMINI_API_KEY||'');
  const model=String(req.body.model||'gemini-2.5-flash');
  if(!apiKey) return res.status(400).json({error:'Gemini API 키를 입력해 주세요.'});
  const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:'연결 테스트입니다. 한국어로 “연결 성공”만 답해 주세요.'}]}]})});
  const data=await response.json();
  if(!response.ok) return res.status(response.status).json({error:data?.error?.message||'연결에 실패했습니다.'});
  res.json({ok:true,message:data?.candidates?.[0]?.content?.parts?.[0]?.text||'연결 성공'});
});

app.get('*', (_req,res)=>res.sendFile(path.join(root,'dist','index.html')));
app.use((err,_req,res,_next)=>{ console.error(err); res.status(500).json({error:'처리 중 오류가 발생했습니다.'}); });

ensureUsers().then(()=>app.listen(port,()=>console.log(`Bloom Budget http://localhost:${port}`))).catch(err=>{console.error(err);process.exit(1)});

