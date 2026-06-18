@echo off
chcp 65001 >nul
title BrainSpark Dev Server
cls

echo ================================================
echo   BrainSpark - AI Brainstorming Assistant
echo ================================================
echo.

:: Switch to script directory (project root, since start.bat lives at repo root)
cd /d "%~dp0"

:: Log file setup (relative to project root)
if not exist "logs" mkdir logs
set LOG=logs\start_%date:~0,4%%date:~5,2%%date:~8,2%_%time:~0,2%%time:~3,2%%time:~6,2%.log
set LOG=%LOG: =0%

call :log INFO  "BrainSpark startup initiated"
call :log INFO  "Project root: %CD%"
call :log INFO  "Log file: %LOG%"

:: Check Node.js
call :log INFO  "Checking Node.js..."
where node >nul 2>&1
if errorlevel 1 (
    call :log ERROR "Node.js not found. Install from https://nodejs.org"
    pause & exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do call :log INFO  "Node.js %%v"
for /f "tokens=*" %%v in ('npm --version') do call :log INFO  "npm %%v"

:: Install dependencies
if not exist "node_modules" (
    call :log INFO  "Installing dependencies (first run)..."
    npm install >> "%LOG%" 2>&1
    if errorlevel 1 (
        call :log ERROR "npm install failed"
        pause & exit /b 1
    )
    call :log INFO  "Dependencies installed."
) else (
    call :log INFO  "node_modules OK."
)

:: Free port 5173
call :log INFO  "Checking port 5173..."
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":5173 " ^| findstr LISTENING') do (
    call :log WARN  "Port 5173 in use by PID %%p, releasing..."
    taskkill /PID %%p /F >nul 2>&1
)

:: Free port 5174 (log server)
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":5174 " ^| findstr LISTENING') do (
    call :log WARN  "Port 5174 in use by PID %%p, releasing..."
    taskkill /PID %%p /F >nul 2>&1
)

:: Start log server in background (path relative to project root)
call :log INFO  "Starting log server on port 5174..."
start /b "" node scripts\log-server.mjs
timeout /t 1 >nul
call :log INFO  "Log server started."

:: Start Vite
call :log INFO  "Starting Vite on port 5173..."
echo ================================================
echo   App:      http://localhost:5173
echo   Logs:     %LOG%
echo   Ctrl+C to stop
echo ================================================
echo.

npm run dev

echo.
call :log INFO  "Server stopped."
pause
exit /b 0

:: ---- subroutine: timestamped log to console + file ----
:log
set _LVL=%~1
set _MSG=%~2
for /f "tokens=1-4 delims=:." %%a in ("%time%") do set _T=%%a:%%b:%%c.%%d
set _T=%_T: =0%
set _D=%date:~0,4%-%date:~5,2%-%date:~8,2%
set _LINE=%_D% %_T% [%_LVL%] %_MSG%
echo %_LINE%
echo %_LINE%>> "%LOG%"
exit /b 0
