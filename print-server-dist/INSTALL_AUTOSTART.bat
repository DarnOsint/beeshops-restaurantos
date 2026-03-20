@echo off
title Installing Beeshop Print Server
echo Copying files to C:\BeeshopPrint...
mkdir "C:\BeeshopPrint" 2>nul
copy "%~dp0BeeshopPrint.exe" "C:\BeeshopPrint\BeeshopPrint.exe" /Y
copy "%~dp0START_PRINT_SERVER.bat" "C:\BeeshopPrint\START_PRINT_SERVER.bat" /Y
echo Creating auto-start shortcut...
echo Set oWS = WScript.CreateObject("WScript.Shell") > "%TEMP%\s.vbs"
echo sLinkFile = oWS.SpecialFolders("Startup") ^& "\BeeshopPrint.lnk" >> "%TEMP%\s.vbs"
echo Set oLink = oWS.CreateShortcut(sLinkFile) >> "%TEMP%\s.vbs"
echo oLink.TargetPath = "C:\BeeshopPrint\BeeshopPrint.exe" >> "%TEMP%\s.vbs"
echo oLink.WindowStyle = 7 >> "%TEMP%\s.vbs"
echo oLink.Save >> "%TEMP%\s.vbs"
cscript "%TEMP%\s.vbs"
echo.
echo Done! Starting print server now...
start "" "C:\BeeshopPrint\BeeshopPrint.exe"
echo.
echo Test it: open Chrome and go to http://localhost:6543/health
pause
