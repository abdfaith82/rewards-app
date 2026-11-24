# Rewards App

تطبيق أندرويد (Kotlin/Compose) يعرض للمستخدم مهاماً واستبيانات عبر جدار عروض (CPAlead / Pollfish وغيرها)، ويحوّل أرباحه إلى PayPal. أنت تربح الفرق بين عمولة الشبكة وحصة المستخدم.

```
التطبيق  ──▶  الخادم (backend/)  ◀── postback ──  شبكة العروض
                  │
                  └──▶ PayPal Payouts (بعد موافقتك)
```

الرصيد والدفع يمرّان عبر الخادم فقط. التطبيق وحده لا يستطيع الدفع بأمان.

## 1) تجهيز الحسابات
1. حساب ناشر في CPAlead أو Pollfish، واحصل على رابط جدار العروض.
2. حساب PayPal Business، ثم تطبيق REST في developer.paypal.com (ابدأ بـ sandbox) وفعّل Payouts.
3. استضافة Node 18+ بـ HTTPS (Render، Railway، VPS…).

## 2) تشغيل الخادم
```bash
cd backend
cp .env.example .env     # املأ القيم، وولّد الأسرار بـ: openssl rand -hex 32
npm install
set -a; . ./.env; set +a
npm start
```
على Render وغيره ضع القيم كمتغيرات بيئة بدل ملف .env. يحتاج القرص دائماً (persistent disk) لملف `data.db`.

## 3) إعداد الـ postback في لوحة الشبكة
```
https://YOUR-SERVER/postback?secret=POSTBACK_SECRET&uid={subid}&txid={transaction_id}&amount={payout}
```
أسماء الماكروهات `{subid}` و`{transaction_id}` و`{payout}` تختلف من شبكة لأخرى؛ راجع توثيق شبكتك. وضع `OFFERWALL_URL_TEMPLATE` بحيث يُمرَّر `{uid}` كـ subid.
إن دعمت الشبكة إلغاء المكافآت فأضف `&status=reversed` لحالة الإلغاء.

## 4) مراجعة السحوبات والدفع
```bash
# الطلبات المعلّقة
curl -H "x-admin-key: ADMIN_KEY" https://YOUR-SERVER/admin/withdrawals
# موافقة (تدفع عبر PayPal) أو رفض (يعيد الرصيد)
curl -X POST -H "x-admin-key: ADMIN_KEY" https://YOUR-SERVER/admin/withdrawals/1/approve
curl -X POST -H "x-admin-key: ADMIN_KEY" https://YOUR-SERVER/admin/withdrawals/1/reject
```
المراجعة اليدوية مقصودة: تحميك من الاحتيال وإلغاءات الشبكة قبل خروج المال. لا تغيّر `PAYPAL_ENV` إلى `live` قبل اختبار كامل على sandbox.

## نسخة الويب (PWA) للينكس وكل الأنظمة
مجلد `web/` يحتوي نسخة ويب بنفس الميزات، ويخدمها الخادم نفسه من الجذر `/`. افتح رابط خادمك في أي متصفح (Chrome أو Chromium أو Firefox على لينكس)، وفي Chrome/Chromium يمكن تثبيتها كتطبيق من زر التثبيت في شريط العنوان.
- تحتاج HTTPS ليعمل التثبيت وخدمة العمل (service worker).
- عند الاستضافة اجعل الجذر هو المستودع كله (لأن الخادم يقرأ `../web`)، وأمر التشغيل: `cd backend && npm install && npm start`.
- بعض جدران العروض تمنع العرض داخل إطار؛ في هذه الحالة استخدم زر "فتح في تبويب جديد".

## 5) بناء التطبيق
- من تبويب Actions في GitHub: شغّل **Build Debug APK** ثم نزّل `rewards-debug-apk`.
- لتحديد رابط خادمك: عدّل `apiBaseUrl` في `gradle.properties` (HTTPS فقط).

## تنبيهات
- لم يُختبر الكود بالتشغيل الفعلي بعد؛ الحكم النهائي من تبويب Actions واختبار sandbox.
- الأسرار (JWT/Postback/Admin/PayPal) تبقى في بيئة الخادم فقط ولا تُرفع إلى GitHub.
- تحقق من شروط الشبكة التي تستخدمها (البلدان المسموحة، منع الـ VPN والحسابات المتعددة) ومن قوانين الضرائب وخصوصية البيانات في بلدك. أضف سياسة خصوصية قبل النشر على Google Play.
- تخزين التوكن في SharedPreferences عادي؛ للإنتاج استخدم EncryptedSharedPreferences.
