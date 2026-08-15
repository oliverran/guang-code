@echo off
REM ============================================================
REM  Guang Code — Start Web UI (Windows)
REM  Double-click this file OR run in cmd:  start-ui.cmd
REM  Optional args:  start-ui.cmd 8080       -> port 8080
REM                  start-ui.cmd 8080 /pub  -> public + port 8080
REM ============================================================
setlocal

set GC_PORT=5173
set GC_HOST=127.0.0.1
set GC_PUBLIC=
set GC_OPEN=1

if "%~1" NEQ "" set GC_PORT=%~1
if /I "%~2" == "/pub" (
    set GC_HOST=0.0.0.0
    set GC_PUBLIC=--public
)
if /I "%~2" == "/no-open" set GC_OPEN=
if /I "%~3" == "/no-open" set GC_OPEN=

cd /d "%~dp0"
where node >nul 2>nul
if ERRORLEVEL 1 (
    echo [ERROR] Node.js not found in PATH. Install from https://nodejs.org (>=18).
    pause
    exit /b 1
)

echo.
echo ============================================================
echo   Guang Code Web UI
echo   Port: %GC_PORT%   Host: %GC_HOST%
echo ============================================================
echo.

set CMD=node "%~dp0scripts\start-ui.mjs" --port=%GC_PORT% --host=%GC_HOST%
if DEFINED GC_PUBLIC set CMD=%CMD% %GC_PUBLIC%
if NOT DEFINED GC_OPEN set CMD=%CMD% --no-open

%CMD%
pause
endlocal
