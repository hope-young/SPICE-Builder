@echo off
REM SpiceBuilder Dev Mode — HMR live preview
REM Double-click this file to start
REM
REM 启动后会:
REM   1. 终端 1: Python FastAPI backend (port 8000)
REM   2. 终端 2: Vite + Tauri (port 1420, auto-opens GUI window)
REM
REM 改任何 React (.tsx) 文件 → < 1秒 自动刷新
REM 改 Python → 重启终端 1
REM 改 Rust → Tauri 自动 rebuild (~30s)

setlocal
cd /d "%~dp0"

echo ==========================================
echo   SpiceBuilder Dev Mode
echo ==========================================
echo.

REM Check Python
where python >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found in PATH
    echo Please install Python 3.10+ and add to PATH
    pause
    exit /b 1
)

REM Check spicebuilder package
python -c "import spicebuilder" >nul 2>&1
if errorlevel 1 (
    echo [WARN] spicebuilder not installed, installing...
    pip install -e .
    if errorlevel 1 (
        echo [ERROR] Failed to install spicebuilder
        pause
        exit /b 1
    )
)

REM Check node_modules
if not exist "node_modules" (
    echo [INFO] Installing npm dependencies (first time)...
    call npm install
)

REM Start Python API in new window
echo [1/2] Starting Python API (port 8000)...
start "SpiceBuilder-PythonAPI" cmd /k "set PYTHONPATH=. && python -m spicebuilder.api.scripts.run_api"

REM Wait for API
echo [INFO] Waiting 3s for API to be ready...
timeout /t 3 /nobreak >nul

REM Start Tauri dev in new window
echo [2/2] Starting Tauri dev (port 1420, will open GUI window)...
echo.
echo ==========================================
echo   Tauri window should open in a few seconds
echo   Edit src/app/components/*.tsx to see changes
echo   Close Tauri window to stop dev mode
echo ==========================================
echo.
call npm run tauri dev

endlocal
