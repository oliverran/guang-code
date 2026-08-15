@echo off
REM ============================================================
REM  Guang Code — Web UI Status (Windows)
REM ============================================================
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if ERRORLEVEL 1 (
    echo [ERROR] Node.js not found.
    pause
    exit /b 1
)
node "%~dp0scripts\check-ui.mjs"
pause
endlocal
