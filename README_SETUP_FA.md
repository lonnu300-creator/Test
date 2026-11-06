# بسته اصلاح امضای انتشار فرنوا

این بسته برای مخزن GitHub زیر آماده شده است:

`lonnu300-creator/Test`

## فایل‌هایی که باید جایگزین شوند

فایل‌های این ZIP را از ریشه مخزن استخراج کن و در GitHub در همان مسیرها جایگزین کن:

1. `.github/workflows/android-market-release.yml`
2. `scripts/configure-release-signing.mjs`
3. `scripts/prepare-android.mjs`
4. `scripts/smoke-test.mjs`

**فقط Workflow داخل `.github/workflows/` اجرا می‌شود.** فایل هم‌نام در ریشه مخزن، Workflow فعال GitHub Actions نیست.

## چهار GitHub Secret موردنیاز

در مخزن برو به:

`Settings > Secrets and variables > Actions > New repository secret`

این چهار Secret باید وجود داشته باشند:

- `FARNAVA_KEYSTORE_BASE64`
- `FARNAVA_KEYSTORE_PASSWORD`
- `FARNAVA_KEY_ALIAS`
- `FARNAVA_KEY_PASSWORD`

مقادیر باید از همان فایل انتشار قبلی ساخته شوند:

`C:\Users\E H S A N K O O H I\farnava-release.jks`

Alias:

`farnava`

برای ساخت مقدار Base64 در PowerShell:

```powershell
$keystore = Join-Path $env:USERPROFILE "farnava-release.jks"
$bytes = [System.IO.File]::ReadAllBytes($keystore)
$base64 = [Convert]::ToBase64String($bytes)
Set-Clipboard -Value $base64
```

محتوای Clipboard را فقط در Secret با نام `FARNAVA_KEYSTORE_BASE64` قرار بده. آن را در کد، Issue، فایل عمومی یا چت منتشر نکن.

`FARNAVA_KEYSTORE_PASSWORD` رمز keystore است.
`FARNAVA_KEY_ALIAS` برابر `farnava` است.
`FARNAVA_KEY_PASSWORD` رمز کلید است. اگر هنگام ساخت کلید، رمز کلید و رمز keystore را یکسان وارد کردی، دو Secret رمز هم یکسان خواهند بود.

## اجرای ساخت

1. چهار فایل این بسته را در مسیرهای متناظر مخزن جایگزین کن.
2. تغییرات را روی شاخه `main` Commit کن.
3. به تب Actions برو.
4. Workflow با نام `Build Farnava Market Release APK` را اجرا کن.
5. در صورت موفقیت، Artifact با نام `farnava-market-release-v1.0.0` را دانلود کن.
6. فایل `Farnava-1.0.0-market-release.apk` را برای بررسی/ارسال به کافه‌بازار استفاده کن.

## کنترل امضا

Workflow این موارد را بررسی می‌کند:

- شناسه برنامه `ir.farnava.app` است.
- APK با apksigner معتبر است.
- APK با zipalign بررسی می‌شود.
- SHA-256 گواهی APK با گواهی استخراج‌شده از `farnava-release.jks` مقایسه می‌شود.
- اگر گواهی یکی نباشد، Workflow شکست می‌خورد و APK را به‌عنوان Artifact انتشار تحویل نمی‌دهد.

## هشدارهای امنیتی مهم

- `farnava-release.jks` را در GitHub repository یا ZIP عمومی آپلود نکن.
- رمزها را در کد قرار نده.
- کلید انتشار را گم نکن و از آن نسخه پشتیبان امن تهیه کن.
- برای به‌روزرسانی‌های بعدی همین کلید انتشار را حفظ کن.
- APK ساخته‌شده با `android-debug.yml` را برای بازار ارسال نکن.
