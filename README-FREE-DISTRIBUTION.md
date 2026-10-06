# انتشار رایگان Rexa خارج از Google Play

این پروژه برای ساخت خودکار APK و AAB با GitHub Actions آماده شده است.

## نکته مهم درباره امضا
برای اینکه نسخه‌های بعدی روی نسخه قبلی نصب شوند، کلید امضا باید ثابت بماند. **فایل keystore را داخل GitHub یا ریپازیتوری قرار ندهید.**

ورک‌فلو از Secret زیر استفاده می‌کند:

`DEBUG_KEYSTORE_BASE64`

این Secret باید Base64 فایل `debug.keystore` شما باشد و خود فایل با این مشخصات ساخته شود:

- Alias: `androiddebugkey`
- Password: `android`

### ساخت keystore در ویندوز
در صورتی که Java/JDK نصب است، PowerShell را در پوشه پروژه باز کنید و اجرا کنید:

```powershell
keytool -genkeypair -v -keystore debug.keystore -storepass android -keypass android -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Rexa, OU=Rexa, O=Rexa, L=Local, ST=Local, C=IR"
[Convert]::ToBase64String([IO.File]::ReadAllBytes("debug.keystore")) | Set-Content debug-keystore-base64.txt
```

محتوای `debug-keystore-base64.txt` را در GitHub قرار دهید:

**Repository → Settings → Secrets and variables → Actions → New repository secret**

Name:

`DEBUG_KEYSTORE_BASE64`

Value: کل محتوای فایل `debug-keystore-base64.txt`

بعد از ثبت Secret، فایل‌های `debug.keystore` و `debug-keystore-base64.txt` را از کامپیوتر حذف و در GitHub آپلود نکنید.

## ساخت خروجی
با هر Push به `main`، یا با اجرای دستی Workflow، GitHub این دو فایل را می‌سازد:

- `Rexa-build-N.apk` — مناسب نصب مستقیم و مارکت‌هایی که APK می‌گیرند.
- `Rexa-build-N.aab` — Android App Bundle برای مسیرهایی که AAB می‌پذیرند؛ مخصوصاً Google Play در آینده.

همچنین هر Build به صورت GitHub Release منتشر می‌شود.

## انتشار رایگان
### Uptodown
Uptodown ثبت‌نام توسعه‌دهنده و انتشار اپ را رایگان اعلام کرده است. برای ارسال اپ باید APK امضاشده داشته باشید.

### Softonic Publishing Center
Softonic در سال 2026 اعلام کرده ایجاد حساب، آپلود و مدیریت انتشار در Publishing Center رایگان است و سهم درآمدی هم ندارد.

### Aptoide
شرایط Aptoide Connect متفاوت است و «رایگان» بودن به مسیر توزیع بستگی دارد؛ بعضی مسیرهای بررسی/انتشار نیاز به اشتراک دارند. بنابراین فعلاً Uptodown و Softonic گزینه‌های ساده‌تری برای انتشار بدون هزینه هستند.

## Google Play
برای Google Play همچنان باید حساب Play Console داشته باشید. همچنین برای انتشار حرفه‌ای بهتر است یک **release keystore اختصاصی** جدا از کلید این پروژه بسازید؛ کلید فعلی برای توزیع رایگان خارج از Google Play آماده شده است.
