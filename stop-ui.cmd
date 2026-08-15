@echo off
REM ============================================================
REM  Guang Code — Stop Web UI (Windows)  (Kills process on 5173
REM ============================================================
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if ERRORLEVEL 1 (
    echo [ERROR] Node.js not found.
    pause
    exit /b 1
)
set PORT=5173
if "%~1" NEQ "" set PORT=%~1
node "%~dp0scripts\stop-ui.mjs --port=%PORT%
pause
endlocal
