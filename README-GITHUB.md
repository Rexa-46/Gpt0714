# راه‌اندازی Rexa روی گیت‌هاب (یک‌بار)

## ۱) نسخه‌ی وب (GitHub Pages)
Settings ← Pages ← Build and deployment ← Source: **GitHub Actions**
بعد از هر push روی main، نسخه‌ی وب خودکار منتشر می‌شود. آدرس: `https://USERNAME.github.io/REPO/`
(روی گوشی در مرورگر باز کنید و «افزودن به صفحه‌ی اصلی» بزنید؛ آفلاین هم اجرا می‌شود.)
نکته: Pages برای ریپوی خصوصی نیاز به پلن پولی گیت‌هاب دارد.

## ۲) به‌روزرسانی APK (امضای ثابت)
هر push روی main یک Release با نام `build-N` و فایل APK می‌سازد و برنامه از همان‌جا نسخه‌ی جدید را پیدا می‌کند.
برای اینکه APK جدید روی نسخه‌ی قبلی نصب شود (بدون حذف برنامه) باید امضا ثابت باشد. یک‌بار این کار را بکنید:

```
keytool -genkey -v -keystore debug.keystore -storepass android -alias androiddebugkey -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Android,C=US"
```
سپس فایل را به base64 تبدیل کنید:
- لینوکس/مک: `base64 -w0 debug.keystore`
- ویندوز (PowerShell): `[Convert]::ToBase64String([IO.File]::ReadAllBytes("debug.keystore"))`

خروجی را در Settings ← Secrets and variables ← Actions ← New repository secret با نام **DEBUG_KEYSTORE_BASE64** ذخیره کنید. فایل debug.keystore را جای امنی نگه دارید و در ریپو نگذارید.
نکته: اگر ریپو خصوصی باشد، برنامه نمی‌تواند Release را بدون ورود پیدا کند؛ برای به‌روزرسانی داخل برنامه ریپو باید عمومی باشد.

## ۳) ذخیره‌ی داده‌ها روی گیت‌هاب
- یک ریپوی **خصوصی** جدا بسازید (مثلاً `rexa-data`)؛ داده‌ها را در ریپوی خود برنامه نگذارید.
- Settings ← Developer settings ← Fine-grained tokens: توکنی فقط برای همان ریپو با دسترسی **Contents: Read and write**.
- در برنامه: منوی سه‌خط ← همگام‌سازی ابری (گیت‌هاب) ← ریپو، توکن و یک رمز همگام‌سازی (حداقل ۸ نویسه).
- داده‌ها روی گوشی با AES-256-GCM رمز می‌شوند؛ رمز را فراموش کنید داده قابل بازیابی نیست.

## خواندن برگه پوز و جمله روزانه (آفلاین و رایگان)
- خواندن برگه پوز با OCR فارسی روی خود گوشی انجام می‌شود (Tesseract.js). موتور و داده‌ی زبان در `public/ocr` است؛ نیازی به اینترنت یا کلید API نیست.
- جمله روزانه‌ی انگلیسی هر روز به‌صورت تصادفی و نامحدود از اینترنت (Tatoeba، رایگان و بدون کلید) گرفته می‌شود. هیچ جمله‌ای داخل برنامه نیست؛ بدون اینترنت جمله‌ای نمایش داده نمی‌شود.
