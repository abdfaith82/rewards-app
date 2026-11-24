"use strict";

const $ = (s) => document.querySelector(s);
const TOKEN_KEY = "rw_token";
const VIEWS = ["auth", "home", "offers", "withdraw", "history"];
const STATUS = {
  pending: "قيد المراجعة",
  processing: "قيد التحويل",
  paid: "تم الدفع",
  rejected: "مرفوض",
  failed: "فشل (أُعيد المبلغ)",
};

let token = null;
try { token = localStorage.getItem(TOKEN_KEY); } catch { /* التخزين غير متاح */ }
let registerMode = false;

const money = (cents) => "$" + (Math.abs(cents) / 100).toFixed(2);

function say(text, kind) {
  const el = $("#msg");
  el.textContent = text || "";
  el.className = kind || "";
}

function setToken(t) {
  token = t;
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* تجاهل */ }
}

async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("تعذر الاتصال بالخادم");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) {
    setToken(null);
    show("auth");
  }
  if (!res.ok) throw new Error(data.error || "خطأ (" + res.status + ")");
  return data;
}

function show(name) {
  for (const v of VIEWS) $("#view-" + v).hidden = v !== name;
  say("");
  if (name !== "offers") $("#offers-frame").removeAttribute("src");
  if (name === "home") loadHome();
  if (name === "offers") loadOffers();
  if (name === "withdraw") loadWithdraw();
  if (name === "history") loadHistory();
}

async function loadMe() {
  return api("GET", "/me");
}

async function loadHome() {
  try {
    const me = await loadMe();
    $("#balance").textContent = money(me.balanceCents);
    $("#user-email").textContent = me.email;
  } catch (e) {
    say(e.message, "err");
  }
}

async function loadOffers() {
  try {
    const { url } = await api("GET", "/offerwall-url");
    $("#offers-open").href = url;
    $("#offers-frame").src = url;
  } catch (e) {
    say(e.message, "err");
  }
}

async function loadWithdraw() {
  try {
    const me = await loadMe();
    $("#wd-info").textContent =
      "الرصيد: " + money(me.balanceCents) + " — أقل مبلغ للسحب: " + money(me.minWithdrawCents);
  } catch (e) {
    say(e.message, "err");
  }
}

function row(title, sub, amount) {
  const li = document.createElement("li");
  const left = document.createElement("div");
  left.textContent = title;
  if (sub) {
    const s = document.createElement("small");
    s.textContent = sub;
    left.appendChild(s);
  }
  const right = document.createElement("span");
  right.className = "amt";
  right.textContent = amount;
  li.append(left, right);
  return li;
}

async function loadHistory() {
  try {
    const me = await loadMe();
    const wl = $("#wd-list");
    const hl = $("#hist-list");
    wl.replaceChildren(
      ...me.withdrawals.map((w) =>
        row(STATUS[w.status] || w.status, w.created_at, money(w.cents))
      )
    );
    hl.replaceChildren(
      ...me.history.map((h) =>
        row(h.note || "", h.created_at, (h.cents >= 0 ? "+" : "-") + money(h.cents))
      )
    );
  } catch (e) {
    say(e.message, "err");
  }
}

// ---- الأحداث ----
document.querySelectorAll("[data-go]").forEach((b) =>
  b.addEventListener("click", () => show(b.dataset.go))
);

$("#auth-toggle").addEventListener("click", () => {
  registerMode = !registerMode;
  $("#auth-title").textContent = registerMode ? "إنشاء حساب" : "تسجيل الدخول";
  $("#auth-submit").textContent = registerMode ? "إنشاء الحساب" : "دخول";
  $("#auth-toggle").textContent = registerMode
    ? "لدي حساب، تسجيل الدخول"
    : "ليس لدي حساب، إنشاء حساب";
  $("#password").autocomplete = registerMode ? "new-password" : "current-password";
  say("");
});

$("#auth-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const btn = $("#auth-submit");
  btn.disabled = true;
  try {
    const { token: t } = await api("POST", registerMode ? "/auth/register" : "/auth/login", {
      email: $("#email").value.trim(),
      password: $("#password").value,
    });
    setToken(t);
    $("#password").value = "";
    show("home");
  } catch (e) {
    say(e.message, "err");
  }
  btn.disabled = false;
});

$("#wd-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const dollars = Number($("#wd-amount").value);
  if (!(dollars > 0)) return say("أدخل مبلغاً صحيحاً", "err");
  const btn = ev.submitter;
  if (btn) btn.disabled = true;
  try {
    await api("POST", "/withdraw", {
      paypalEmail: $("#wd-email").value.trim(),
      cents: Math.round(dollars * 100),
    });
    $("#wd-amount").value = "";
    await loadWithdraw();
    say("تم إرسال الطلب، سيُراجع ويُحوَّل إلى PayPal", "ok");
  } catch (e) {
    say(e.message, "err");
  }
  if (btn) btn.disabled = false;
});

$("#logout").addEventListener("click", () => {
  setToken(null);
  show("auth");
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

show(token ? "home" : "auth");
