import express from "express";
import Database from "better-sqlite3";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "web");

// ---------- الإعدادات ----------
const env = process.env;
const PORT = Number(env.PORT || 3000);
const JWT_SECRET = env.JWT_SECRET;
const POSTBACK_SECRET = env.POSTBACK_SECRET;
const ADMIN_KEY = env.ADMIN_KEY;
const REWARD_SHARE = Number(env.REWARD_SHARE || 0.6);
const MIN_WITHDRAW_CENTS = Math.round(Number(env.MIN_WITHDRAW || 5) * 100);
const OFFERWALL_URL_TEMPLATE = env.OFFERWALL_URL_TEMPLATE || "";
const PAYPAL_BASE =
  env.PAYPAL_ENV === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

for (const [k, v] of Object.entries({ JWT_SECRET, POSTBACK_SECRET, ADMIN_KEY })) {
  if (!v || v.length < 16) {
    console.error(`المتغير ${k} مطلوب (16 حرفاً على الأقل).`);
    process.exit(1);
  }
}
if (!(REWARD_SHARE > 0 && REWARD_SHARE <= 1)) {
  console.error("REWARD_SHARE يجب أن يكون بين 0 و1.");
  process.exit(1);
}

// ---------- قاعدة البيانات ----------
const db = new Database(env.DB_PATH || "./data.db");
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  cents INTEGER NOT NULL,
  ref TEXT UNIQUE,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ledger_user ON ledger(user_id);
CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  paypal_email TEXT NOT NULL,
  cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payout_batch_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

const q = {
  userByEmail: db.prepare("SELECT * FROM users WHERE email = ?"),
  userById: db.prepare("SELECT id, email FROM users WHERE id = ?"),
  insertUser: db.prepare("INSERT INTO users (email, pass_hash) VALUES (?, ?)"),
  balance: db.prepare("SELECT COALESCE(SUM(cents), 0) AS c FROM ledger WHERE user_id = ?"),
  insertLedger: db.prepare(
    "INSERT INTO ledger (user_id, type, cents, ref, note) VALUES (?, ?, ?, ?, ?)"
  ),
  history: db.prepare(
    "SELECT type, cents, note, created_at FROM ledger WHERE user_id = ? ORDER BY id DESC LIMIT 100"
  ),
  userWithdrawals: db.prepare(
    "SELECT id, cents, status, paypal_email, created_at FROM withdrawals WHERE user_id = ? ORDER BY id DESC LIMIT 50"
  ),
  insertWithdrawal: db.prepare(
    "INSERT INTO withdrawals (user_id, paypal_email, cents) VALUES (?, ?, ?)"
  ),
  getWithdrawal: db.prepare("SELECT * FROM withdrawals WHERE id = ?"),
  claimWithdrawal: db.prepare(
    "UPDATE withdrawals SET status = 'processing', updated_at = datetime('now') WHERE id = ? AND status = 'pending'"
  ),
  finishWithdrawal: db.prepare(
    "UPDATE withdrawals SET status = ?, payout_batch_id = ?, updated_at = datetime('now') WHERE id = ?"
  ),
  listWithdrawals: db.prepare(
    "SELECT w.*, u.email AS user_email FROM withdrawals w JOIN users u ON u.id = w.user_id WHERE w.status = ? ORDER BY w.id"
  ),
};

const balanceOf = (userId) => q.balance.get(userId).c;

// ---------- أدوات ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a ?? "")).digest();
  const hb = crypto.createHash("sha256").update(String(b ?? "")).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// محدّد معدل بسيط في الذاكرة (لكل IP)
const hits = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key = `${req.path}|${req.ip}`;
    const now = Date.now();
    const rec = hits.get(key) || { n: 0, reset: now + windowMs };
    if (now > rec.reset) {
      rec.n = 0;
      rec.reset = now + windowMs;
    }
    rec.n += 1;
    hits.set(key, rec);
    if (rec.n > max) return res.status(429).json({ error: "محاولات كثيرة، حاول لاحقاً" });
    next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
}, 60_000).unref();

function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = q.userById.get(payload.uid);
    if (!user) throw new Error("no user");
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: "انتهت الجلسة، سجّل الدخول من جديد" });
  }
}

function admin(req, res, next) {
  if (!safeEqual(req.headers["x-admin-key"], ADMIN_KEY)) {
    return res.status(403).json({ error: "ممنوع" });
  }
  next();
}

const signToken = (uid) => jwt.sign({ uid }, JWT_SECRET, { expiresIn: "30d" });

// ---------- PayPal Payouts ----------
async function paypalToken() {
  const id = env.PAYPAL_CLIENT_ID;
  const secret = env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error("PayPal غير مُعدّ");
  const r = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new Error(`PayPal auth ${r.status}`);
  return (await r.json()).access_token;
}

async function paypalPayout(w) {
  const token = await paypalToken();
  const value = (w.cents / 100).toFixed(2);
  const r = await fetch(`${PAYPAL_BASE}/v1/payments/payouts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender_batch_header: {
        sender_batch_id: `withdrawal-${w.id}`, // يمنع الدفع المكرر لنفس الطلب
        email_subject: "لقد وصلتك أرباحك",
      },
      items: [
        {
          recipient_type: "EMAIL",
          amount: { value, currency: "USD" },
          receiver: w.paypal_email,
          note: "Rewards payout",
          sender_item_id: `withdrawal-${w.id}`,
        },
      ],
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`PayPal payout ${r.status}: ${data.message || ""}`);
  return data.batch_header?.payout_batch_id || null;
}

// ---------- التطبيق ----------
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((_req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
  });
  next();
});
app.use(express.json({ limit: "20kb" }));
// نسخة الويب (PWA) تُخدم من نفس الخادم، فلا حاجة لإعداد CORS
app.use(express.static(WEB_DIR, { index: "index.html" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/auth/register", rateLimit(10, 3_600_000), (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "بريد غير صالح" });
  if (password.length < 8) return res.status(400).json({ error: "كلمة المرور 8 أحرف على الأقل" });
  if (q.userByEmail.get(email)) return res.status(409).json({ error: "البريد مسجّل مسبقاً" });
  const info = q.insertUser.run(email, bcrypt.hashSync(password, 10));
  res.json({ token: signToken(Number(info.lastInsertRowid)) });
});

app.post("/auth/login", rateLimit(20, 900_000), (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const user = q.userByEmail.get(email);
  if (!user || !bcrypt.compareSync(password, user.pass_hash)) {
    return res.status(401).json({ error: "بيانات الدخول غير صحيحة" });
  }
  res.json({ token: signToken(user.id) });
});

app.get("/me", auth, (req, res) => {
  res.json({
    email: req.user.email,
    balanceCents: balanceOf(req.user.id),
    minWithdrawCents: MIN_WITHDRAW_CENTS,
    history: q.history.all(req.user.id),
    withdrawals: q.userWithdrawals.all(req.user.id),
  });
});

app.get("/offerwall-url", auth, (req, res) => {
  if (!OFFERWALL_URL_TEMPLATE.includes("{uid}")) {
    return res.status(503).json({ error: "جدار العروض غير مُعدّ بعد" });
  }
  res.json({ url: OFFERWALL_URL_TEMPLATE.replaceAll("{uid}", encodeURIComponent(req.user.id)) });
});

// ---- Postback من شبكة العروض ----
// اضبط الرابط في لوحة الشبكة، مثلاً:
//   https://YOUR-SERVER/postback?secret=XXX&uid={subid}&txid={transaction_id}&amount={payout}
// أضف &status=reversed عند إلغاء المكافأة إن كانت الشبكة تدعم ذلك.
// الرد المطلوب عادةً: "1" عند النجاح.
async function handlePostback(req, res) {
  const p = { ...req.query, ...(req.body || {}) };
  if (!safeEqual(p.secret, POSTBACK_SECRET)) return res.status(403).send("0");

  const uid = Number(p.uid);
  const txid = String(p.txid || "").slice(0, 120);
  const amount = Number(p.amount); // عمولتك من الشبكة بالدولار
  if (!Number.isInteger(uid) || !txid || !Number.isFinite(amount) || amount <= 0 || amount > 1000) {
    return res.status(400).send("0");
  }
  if (!q.userById.get(uid)) return res.status(404).send("0");

  const cents = Math.floor(amount * 100 * REWARD_SHARE);
  const reversed = ["reversed", "chargeback", "0", "false"].includes(
    String(p.status || "").toLowerCase()
  );

  try {
    if (reversed) {
      q.insertLedger.run(uid, "reversal", -cents, `${txid}:rev`, "إلغاء مكافأة");
    } else {
      q.insertLedger.run(uid, "reward", cents, txid, "مكافأة مهمة");
    }
  } catch (e) {
    if (String(e.code).startsWith("SQLITE_CONSTRAINT")) return res.send("1"); // مكرر
    console.error(e);
    return res.status(500).send("0");
  }
  res.send("1");
}
app.get("/postback", handlePostback);
app.post("/postback", handlePostback);

// ---- السحب ----
app.post("/withdraw", auth, rateLimit(10, 3_600_000), (req, res) => {
  const paypalEmail = String(req.body?.paypalEmail || "").trim().toLowerCase();
  const cents = Number(req.body?.cents);
  if (!EMAIL_RE.test(paypalEmail)) return res.status(400).json({ error: "بريد PayPal غير صالح" });
  if (!Number.isInteger(cents) || cents < MIN_WITHDRAW_CENTS) {
    return res.status(400).json({
      error: `أقل مبلغ للسحب $${(MIN_WITHDRAW_CENTS / 100).toFixed(2)}`,
    });
  }

  const run = db.transaction(() => {
    if (balanceOf(req.user.id) < cents) return null;
    const w = q.insertWithdrawal.run(req.user.id, paypalEmail, cents);
    q.insertLedger.run(
      req.user.id, "withdraw_hold", -cents, `w:${w.lastInsertRowid}`, "طلب سحب"
    );
    return Number(w.lastInsertRowid);
  });
  const id = run();
  if (id === null) return res.status(400).json({ error: "الرصيد غير كافٍ" });
  res.json({ id, status: "pending" });
});

// ---- مراجعة السحب (يدوية من لوحتك) ----
app.get("/admin/withdrawals", admin, (req, res) => {
  res.json(q.listWithdrawals.all(String(req.query.status || "pending")));
});

app.post("/admin/withdrawals/:id/approve", admin, async (req, res) => {
  const id = Number(req.params.id);
  if (q.claimWithdrawal.run(id).changes !== 1) {
    return res.status(409).json({ error: "الطلب غير موجود أو تمت معالجته" });
  }
  const w = q.getWithdrawal.get(id);
  try {
    const batchId = await paypalPayout(w);
    q.finishWithdrawal.run("paid", batchId, id);
    res.json({ id, status: "paid", batchId });
  } catch (e) {
    console.error("payout failed", id, e.message);
    db.transaction(() => {
      q.finishWithdrawal.run("failed", null, id);
      q.insertLedger.run(w.user_id, "withdraw_refund", w.cents, `w:${id}:refund`, "فشل السحب، أُعيد المبلغ");
    })();
    res.status(502).json({ error: "فشل الدفع عبر PayPal وتم رد المبلغ", detail: e.message });
  }
});

app.post("/admin/withdrawals/:id/reject", admin, (req, res) => {
  const id = Number(req.params.id);
  const w = q.getWithdrawal.get(id);
  if (!w) return res.status(404).json({ error: "غير موجود" });
  const ok = db.transaction(() => {
    if (q.claimWithdrawal.run(id).changes !== 1) return false;
    q.finishWithdrawal.run("rejected", null, id);
    q.insertLedger.run(w.user_id, "withdraw_refund", w.cents, `w:${id}:refund`, "رُفض السحب، أُعيد المبلغ");
    return true;
  })();
  if (!ok) return res.status(409).json({ error: "تمت معالجته مسبقاً" });
  res.json({ id, status: "rejected" });
});

app.listen(PORT, () => console.log(`Rewards backend on :${PORT}`));
