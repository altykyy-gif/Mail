Unicode true
RequestExecutionLevel user
Name "ماسح منظومة الصادر والوارد"
InstallDir "$LOCALAPPDATA\SuluqMailScanner"
OutFile "../Mail-Scanner-Setup.exe"
VIProductVersion "1.0.2.0"
VIAddVersionKey /LANG=1025 "ProductName" "ماسح منظومة الصادر والوارد"
VIAddVersionKey /LANG=1025 "FileVersion" "1.0.2"
VIAddVersionKey /LANG=1025 "FileDescription" "أداة تثبيت ماسح منظومة الصادر والوارد"
VIAddVersionKey /LANG=1025 "CompanyName" "مراقبة التربية والتعليم سلوق"
VIAddVersionKey /LANG=1025 "LegalCopyright" "يحيى التيغي"

!ifndef HOST_EXE
  !define HOST_EXE "MailScannerHost.exe"
!endif

!include "MUI2.nsh"
!define MUI_FINISHPAGE_TEXT "حدّث صفحة المنظومة بعد انتهاء التثبيت. عند التجهيز لأول مرة، حمّل الإضافة غير المضغوطة في كروم أو إيدج من المجلد التالي.$\r$\n$\r$\n$INSTDIR\extension"
!define MUI_FINISHPAGE_SHOWREADME "$INSTDIR\extension"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "فتح مجلد الإضافة"
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Arabic"

!define CHROME_HOST "Software\Google\Chrome\NativeMessagingHosts\ly.suluq.mail_scanner"
!define EDGE_HOST "Software\Microsoft\Edge\NativeMessagingHosts\ly.suluq.mail_scanner"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\SuluqMailScanner"

Section
  SetOutPath "$INSTDIR"
  File /oname=MailScannerHost.exe "${HOST_EXE}"
  File "ly.suluq.mail_scanner.json"
  SetOutPath "$INSTDIR\extension"
  File "../extension/manifest.json"
  File "../extension/background.js"
  WriteRegStr HKCU "${CHROME_HOST}" "" "$INSTDIR\ly.suluq.mail_scanner.json"
  WriteRegStr HKCU "${EDGE_HOST}" "" "$INSTDIR\ly.suluq.mail_scanner.json"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "ماسح منظومة الصادر والوارد"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "1.0.2"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  DeleteRegKey HKCU "${CHROME_HOST}"
  DeleteRegKey HKCU "${EDGE_HOST}"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  Delete "$INSTDIR\extension\manifest.json"
  Delete "$INSTDIR\extension\background.js"
  Delete "$INSTDIR\ly.suluq.mail_scanner.json"
  Delete "$INSTDIR\MailScannerHost.exe"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR\extension"
  RMDir "$INSTDIR"
SectionEnd
