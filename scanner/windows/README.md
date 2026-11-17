# أداة الماسح لمنظومة الصادر والوارد

تستخدم الأداة تعريفات المسح المتوفرة في ويندوز عبر WIA. تعمل مع كروم وإيدج بعد تثبيت الأداة وتحميل الإضافة من مجلد `%LOCALAPPDATA%\SuluqMailScanner\extension`. يمكن التحقق من تعريف الجهاز أولًا بفحص ظهوره في تطبيق «المسح الضوئي» في ويندوز.

عند التحديث، شغّل المثبّت ثم اضغط «إعادة تحميل» بجانب الإضافة في صفحة الإضافات وحدّث المنظومة.

تبحث المنظومة عن الماسحات عند فتح تبويب «الماسح الضوئي» وتعيد البحث خلال عرضه. تعيد أداة ويندوز الصورة وأبعاد المساحة المطلوبة بوحدة البكسل. تعرض المنظومة المسح في إطار A4 وتستخدم المقاس نفسه في ملف PDF.

## إعادة بناء المثبّت

نفّذ الأوامر التالية من مجلد `scanner/windows` باستخدام مترجم ‎.NET Framework وأداة NSIS.

```cmd
"%SystemRoot%\Microsoft.NET\Framework\v4.0.30319\csc.exe" /nologo /optimize+ /platform:anycpu /r:Microsoft.CSharp.dll /r:System.Web.Extensions.dll /out:MailScannerHost-1.0.3.exe ScannerHost.cs
makensis Setup.nsi
powershell -NoProfile -Command "[IO.File]::WriteAllText((Join-Path ((Get-Location).Path) '../installer.txt'), [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path ((Get-Location).Path) '../Mail-Scanner-Setup.exe'))))"
```

ينشأ المثبّت في `scanner/Mail-Scanner-Setup.exe`. يتحول إلى صيغة نصية في `scanner/installer.txt` حتى تتمكن المنظومة من تنزيل الملف التنفيذي. يحدد المفتاح العام في ملف تعريف الإضافة معرّفها الذي يستخدمه الموقع وملف تسجيل أداة ويندوز.
