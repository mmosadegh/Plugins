# MMScripts — افزونه افترافکت

یک پنل داک‌شونده برای After Effects که ابزارها رو از همین ریپو می‌گیره. هر ابزار جدید که اضافه بشه، با دکمه **Update** داخل پنل دانلود و فوراً بارگذاری می‌شه؛ لازم نیست افتر رو ببندید.

## نصب (یک بار)

1. فایل `MMScripts.jsx` و پوشه `MMScripts` رو کپی کنید توی پوشه ScriptUI Panels:
   - ویندوز: `C:\Program Files\Adobe\Adobe After Effects <نسخه>\Support Files\Scripts\ScriptUI Panels\`
   - مک: `/Applications/Adobe After Effects <نسخه>/Scripts/ScriptUI Panels/`
2. توی افتر: `Edit > Preferences > Scripting & Expressions` (مک: `After Effects > Settings`) تیک
   **Allow Scripts to Write Files and Access Network** رو بزنید. (برای دکمه Update لازمه.)
3. افتر رو یک بار ری‌استارت کنید و از منوی `Window > MMScripts.jsx` پنل رو باز کنید و هر جا خواستید داکش کنید.

> اگه فقط فایل `MMScripts.jsx` رو کپی کنید هم کار می‌کنه؛ بار اول خودش بقیه فایل‌ها رو از گیت‌هاب دانلود می‌کنه.
> ریپو باید public باشه، یا توی تنظیمات پنل (دکمه `...`) یک GitHub token بذارید.

## دکمه‌های بالای پنل

| دکمه | کار |
|---|---|
| **Update** | آخرین نسخه ابزارها رو از گیت‌هاب می‌گیره و پنل رو بدون ری‌استارت دوباره می‌سازه. |
| **Reload** | ابزارها رو دوباره از روی دیسک می‌خونه (اگه دستی فایلی عوض کردید). |
| **...** | تنظیمات: ریپو، برنچ (`HEAD` یعنی برنچ پیش‌فرض ریپو)، توکن، پروکسی. |

ابزارها و هسته پنل اینجا ذخیره می‌شن (و Update همین‌ها رو عوض می‌کنه):
- ویندوز: `%APPDATA%\MMScripts\`
- مک: `~/Library/Application Support/MMScripts/`

> اگه Update خطا داد و از فیلترشکن استفاده می‌کنید: پنل خودش پروکسی سیستم رو برمی‌داره. اگه نشد، آدرس پروکسی فیلترشکن
> (مثلاً `http://127.0.0.1:10809`) رو توی خانه **Proxy** در تنظیمات بنویسید. متن دقیق خطا هم توی پیام نشون داده می‌شه.

## ابزارها

### Crop Comp to Selected Layers
لایه‌ها رو انتخاب کنید و دکمه رو بزنید. سایز کامپ دقیقاً اندازه محدوده لایه‌های انتخاب‌شده می‌شه و همه لایه‌ها جابه‌جا می‌شن که چیزی روی صفحه تکون نخوره (کی‌فریم‌ها هم درست منتقل می‌شن).
- **Bounds**: `Current frame` (فقط فریم فعلی) یا `Entire duration` (همه فریم‌ها؛ برای لایه‌های متحرک).
- **Padding**: فاصله اضافه دور لایه‌ها به پیکسل.
- **Even width/height**: عرض و ارتفاع زوج (برای خروجی H.264).
- **Keep position where comp is nested**: اگه این کامپ داخل کامپ دیگه‌ای استفاده شده، anchor point اونجا اصلاح می‌شه که جابه‌جا نشه.

محدوده بر اساس bounds خود لایه حساب می‌شه (همون کادری که افتر دور لایه نشون می‌ده)؛ ماسک و افکت‌ها حساب نمی‌شن.

### Flip Comp
**Flip Horizontal** / **Flip Vertical**: همه چیز داخل کامپ حول مرکز کامپ آینه می‌شه. تغییر روی خود لایه‌ها اعمال می‌شه (scale منفی، rotation و کی‌فریم‌ها). اگه **Include cameras & lights** تیک داشته باشه، دوربین و نورها هم قرینه می‌شن. دو بار فلیپ = حالت اول.

گزینه **Keep objects unmirrored (flip layout only)**: چیدمان کامپ آینه می‌شه، ولی هر لایه دوباره سر جای خودش برعکس می‌شه که متن‌ها و آبجکت‌ها برعکس نباشن. لایه‌های child همراه parent خودشون حساب می‌شن.

### Flip Selected Layers
هر لایه انتخاب‌شده رو سر جای خودش (حول مرکز کادر خودش و در جهت محورهای خود لایه) افقی یا عمودی برعکس می‌کنه. کی‌فریم‌ها، parent و حرکت لایه حفظ می‌شن.

همه ابزارها با یک `Ctrl+Z` برمی‌گردن. اگه لایه‌ای روی transform اکسپرشن داشته باشه، دست نمی‌خوره و پنل بهتون اخطار می‌ده.

---

## Adding a tool (for whoever extends this)

1. Create `MMScripts/tools/<id>.jsx`. Wrap it in an IIFE and call
   `MM.register({ id, name, build: function (group, api) { ... } })`.
   `api` provides `comp()`, `status(msg)`, `undo(name, fn)`, `util.transformAll(comp, opts, modify)`
   and `util.mapProperty(prop, fn, mapTangent)` (see `core.jsx`).
2. Add the file to `files` in `MMScripts/manifest.json`, bump `version`, and update `changelog`.
3. Push to the default branch. Users press **Update**.

Scripts are ExtendScript (ES3): no `let`/`const`, arrow functions, `JSON`, `Array.prototype.indexOf/forEach` or `String.prototype.trim`.
The loader `MMScripts.jsx` should stay stable; put changes in `core.jsx` so they arrive through Update.
