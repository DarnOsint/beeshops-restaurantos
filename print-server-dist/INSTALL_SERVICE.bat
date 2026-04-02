@echo off
title Beeshop Print Server - Background Service Install
echo ============================================
echo   Beeshop's Place - Print Server Installer
echo ============================================
echo.
echo Installing print server as background service...
echo.

mkdir "C:\BeeshopPrint" 2>nul
copy "%~dp0BeeshopPrint.exe" "C:\BeeshopPrint\BeeshopPrint.exe" /Y >nul

echo [1/3] Files copied to C:\BeeshopPrint
echo.

REM Remove old scheduled task if exists
schtasks /delete /tn "BeeshopPrintServer" /f >nul 2>&1

REM Create scheduled task that runs at system startup (before login)
schtasks /create /tn "BeeshopPrintServer" /tr "C:\BeeshopPrint\BeeshopPrint.exe" /sc onstart /ru SYSTEM /rl highest /f >nul 2>&1

echo [2/3] Auto-start service created (runs on boot, no window)
echo.

REM Also create logon task as backup
schtasks /create /tn "BeeshopPrintServerLogon" /tr "C:\BeeshopPrint\BeeshopPrint.exe" /sc onlogon /rl highest /f >nul 2>&1

REM Start it now
taskkill /f /im BeeshopPrint.exe >nul 2>&1
start "" /min "C:\BeeshopPrint\BeeshopPrint.exe"

echo [3/3] Print server started!
echo.
echo ============================================
echo   DONE! The print server will now:
echo   - Run silently in the background
echo   - Auto-start when Windows boots
echo   - Listen on port 6543
echo   - Forward prints to 192.168.0.10
echo.
echo   Test: open Chrome and go to
echo   http://localhost:6543/health
echo ============================================
echo.
pause
