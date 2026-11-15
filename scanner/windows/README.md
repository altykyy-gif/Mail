# أداة الماسح لمنظومة الصادر والوارد

تستخدم الأداة تعريفات المسح المتوفرة في ويندوز عبر WIA. تعمل مع كروم وإيدج بعد تثبيت الأداة وتحميل الإضافة من مجلد `%LOCALAPPDATA%\SuluqMailScanner\extension`. يمكن التحقق من تعريف الجهاز أولًا بفحص ظهوره في تطبيق «المسح الضوئي» في ويندوز.

تعرض المنظومة قائمة الماسحات عند فتح تبويب «الماسح الضوئي» وتحدّثها أثناء عرضه. يرسل المتصفح طلبًا إلى الأداة وقت البحث أو المسح. تعود الصورة عبر الإضافة إلى الصفحة لتجميع الصفحات وتحويلها إلى PDF داخل المتصفح.

## إعادة بناء المثبّت

شغّل الأمرين التاليين من مجلد `scanner/windows` باستخدام مترجم ‎.NET Framework وأداة NSIS.

```cmd
"%SystemRoot%\Microsoft.NET\Framework\v4.0.30319\csc.exe" /nologo /optimize+ /platform:anycpu /r:Microsoft.CSharp.dll /r:System.Web.Extensions.dll /out:MailScannerHost.exe ScannerHost.cs
makensis Setup.nsi
powershell -NoProfile -Command "[IO.File]::WriteAllText((Join-Path ((Get-Location).Path) '../installer.txt'), [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path ((Get-Location).Path) '../Mail-Scanner-Setup.exe'))))"
```

ينشأ المثبّت في `scanner/Mail-Scanner-Setup.exe`. يتحول إلى صيغة نصية في `scanner/installer.txt` حتى تتمكن المنظومة من تنزيل الملف التنفيذي. يحدد المفتاح العام في ملف تعريف الإضافة معرّفها الذي يستخدمه الموقع وملف تسجيل أداة ويندوز.
