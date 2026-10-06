# ساخت APK با Android Studio Quail 3 (2026.1.3) — راهنمای دقیق

> ⚠️ اگه در مراحل قبلی به خطای شبکه (مثل `Unknown host https://403.online`) خوردی، اون مشکل مال اینترنت خود کامپیوترته، نه این پروژه. توصیه می‌کنم اول از روش **GitHub Actions** در `README-APK.md` استفاده کنی — اونجا GitHub خودش APK رو می‌سازه و این مشکلات شبکه‌ی محلی اصلاً پیش نمیاد. این فایل رو فقط برای وقتی نگه دار که بخوای اپ رو محلی روی Android Studio اجرا/دیباگ کنی (نه برای گرفتن APK نهایی).

این راهنما مخصوص همون نسخه‌ای‌ست که داری: **Android Studio Quail 3 | 2026.1.3 Patch 1**.
با رعایت این مراحل، سینک Gradle و ساخت پروژه بدون خطا انجام می‌شه.

## سازگاری نسخه‌ها (از قبل چک شده)
- Quail 3 بازه‌ی AGP بین **۷.۱ تا ۹.۳** رو قبول می‌کنه.
- پکیج Capacitor که در `package.json` پین شده (نسخه‌ی `8.4.1`) هنگام اجرای `npx cap add android`، به‌صورت خودکار یک پروژه‌ی اندروید با AGP و Gradle سازگار می‌سازه (در محدوده‌ی همون ۷.۱ تا ۹.۳ که Quail 3 پشتیبانی می‌کنه).
- JDK: هم Capacitor 8 و هم Quail 3 حداقل JDK 21 لازم دارن — Android Studio Quail خودش JDK 21 رو همراه داره، پس نیازی به نصب جداگونه نیست.

## نکته‌ی مهم: پیشنهاد "Upgrade AGP" را قبول نکن
وقتی پروژه رو در Android Studio باز می‌کنی، ممکنه یک بنر بالای صفحه ببینی که پیشنهاد می‌ده Android Gradle Plugin رو به آخرین نسخه (AGP 9.x) آپدیت کنی. **این پیشنهاد رو قبول نکن** — پلاگین‌های اصلی Capacitor هنوز به‌طور کامل با تغییرات breaking نسخه‌ی AGP 9 (مثل حذف `proguard-android.txt`) هماهنگ نشدن و ممکنه build رو خراب کنه. نسخه‌ای که خود Capacitor پیشنهاد می‌ده (چیزی حدود AGP 8.x) برای این پروژه کاملاً کافی و امن است.

## مراحل دقیق

### ۱. آماده‌سازی روی کامپیوتر
```bash
cd apk-scaffold
npm install --legacy-peer-deps
```
(پرچم `--legacy-peer-deps` لازمه چون یکی از افزونه‌های بومی — خواندن پیامک بانکی — نسخه‌ی قدیمی‌تری از Capacitor core رو به‌عنوان peer dependency اعلام کرده؛ عملاً با نسخه‌ی جدید هم کار می‌کنه، فقط npm بدون این پرچم گیر می‌ده.)

### ۲. اضافه کردن پلتفرم اندروید
```bash
npx cap add android
```
این دستور یک پوشه‌ی `android/` می‌سازه — این پوشه توسط Capacitor تولید می‌شه و نباید دستی ویرایشش کنی (به‌جز جاهایی که این راهنما می‌گه).

### ۳. ساخت خروجی وب و همگام‌سازی
```bash
npm run build
npx cap sync android
```

### ۴. باز کردن در Android Studio
```bash
npx cap open android
```
یا مستقیم از داخل Android Studio: **File → Open** و پوشه‌ی `android/` رو انتخاب کن.

### ۵. سینک Gradle
- بذار Android Studio خودش شروع به Sync کنه (نوار پایین صفحه رو ببین: «Gradle sync in progress»).
- اگه بنر آبی بالای صفحه دیدی که می‌گه *"Android Gradle Plugin Update Recommended"* یا مشابه، روی **Don't remind me again for this project** یا **Dismiss** بزن — طبق توضیح بالا.
- اگه به‌هرحال باز هم پیام "Update" اومد و به‌اشتباه زدیش، از منوی **File → Project Structure → Project** نسخه‌ی AGP رو به همون مقداری که Capacitor تولید کرده برگردون (داخل فایل `android/build.gradle` دنبال خط `com.android.tools.build:gradle` بگرد).

### ۶. اجرا روی شبیه‌ساز یا گوشی واقعی (اختیاری، برای تست)
- از نوار بالا یک دستگاه (Emulator یا گوشی متصل با USB Debugging فعال) انتخاب کن و دکمه‌ی ▶ Run رو بزن.

### ۷. ساخت فایل APK نهایی
از منوی بالا:
**Build → Build App Bundle(s) / APK(s) → Build APK(s)**

وقتی تموم شد، پایین صفحه یک لینک **locate** ظاهر می‌شه — روی اون بزن تا فایل apk رو در مسیر:
```
android/app/build/outputs/apk/debug/app-debug.apk
```
پیدا کنی.

## اگه با این حال خطا گرفتی
اگه در هر مرحله پیام خطا دیدی، متن دقیق خطا (کل پیام قرمز رنگ در پنجره‌ی Build یا Gradle Console) رو برام کپی کن — از روی همون متن دقیق می‌تونم بگم مشکل از کجاست؛ خطاهای Gradle معمولاً خیلی به جزئیات متن حساس هستن.

## علائم رایج و راه‌حل سریع‌شون
| خطا | راه‌حل |
|---|---|
| `SDK location not found` | فایل `android/local.properties` رو باز کن و مسیر SDK رو دستی اضافه کن: `sdk.dir=مسیر SDK شما` (در ویندوز معمولاً `C:\\Users\\USERNAME\\AppData\\Local\\Android\\Sdk`) |
| `Failed to install the following Android SDK packages` | از منوی **Tools → SDK Manager** پلتفرم اندروید و Build-Tools پیشنهادی رو نصب کن |
| `Could not find com.android.tools.build:gradle:X.X.X` | اینترنت/فایروال داره جلوی دانلود از `google()`/`mavenCentral()` رو می‌گیره؛ VPN یا شبکه رو چک کن |
| هشدار زرد "Gradle Sync" با پیشنهاد AGP upgrade | طبق بخش «نکته‌ی مهم» بالا، رد کن |
