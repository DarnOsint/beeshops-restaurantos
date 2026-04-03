@echo off
title Beeshop POS - Auto Open Setup
echo ============================================
echo   Beeshop's Place - Auto Open on Boot
echo ============================================
echo.
echo This will make beeshop.place open automatically
echo in Chrome every time this computer starts.
echo.

REM Create startup shortcut for Chrome opening beeshop.place in kiosk mode
echo Set oWS = WScript.CreateObject("WScript.Shell") > "%TEMP%\bp.vbs"
echo sLinkFile = oWS.SpecialFolders("Startup") ^& "\BeeshopPOS.lnk" >> "%TEMP%\bp.vbs"
echo Set oLink = oWS.CreateShortcut(sLinkFile) >> "%TEMP%\bp.vbs"

REM Try to find Chrome
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    echo oLink.TargetPath = "C:\Program Files\Google\Chrome\Application\chrome.exe" >> "%TEMP%\bp.vbs"
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    echo oLink.TargetPath = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" >> "%TEMP%\bp.vbs"
) else (
    echo oLink.TargetPath = "chrome.exe" >> "%TEMP%\bp.vbs"
)

echo oLink.Arguments = "--start-fullscreen https://beeshop.place" >> "%TEMP%\bp.vbs"
echo oLink.WindowStyle = 1 >> "%TEMP%\bp.vbs"
echo oLink.Save >> "%TEMP%\bp.vbs"
cscript //nologo "%TEMP%\bp.vbs"
del "%TEMP%\bp.vbs"

echo.
echo [OK] Auto-open shortcut created!
echo.
echo When this computer starts, Chrome will automatically
echo open beeshop.place in full screen.
echo.
echo To remove: delete "BeeshopPOS" from your Startup folder.
echo (Press Win+R, type "shell:startup", press Enter)
echo.
pause
