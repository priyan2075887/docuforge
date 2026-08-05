@echo off
setlocal
cd /d "%~dp0"

if not exist "services\api\.venv\Scripts\python.exe" (
  echo [DocuForge] Backend environment is missing.
  echo Run: cd services\api ^&^& python -m venv .venv ^&^& .venv\Scripts\python -m pip install -r requirements.txt
  pause
  exit /b 1
)

if not exist "apps\web\node_modules" (
  echo [DocuForge] Frontend dependencies are missing. Installing them now...
  pushd "apps\web"
  call npm.cmd install
  if errorlevel 1 exit /b 1
  popd
)

echo [DocuForge] Starting local API at http://127.0.0.1:8000
start "DocuForge API - keep open" /D "%~dp0services\api" cmd /k ".venv\Scripts\python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000"

echo [DocuForge] Starting web app at http://localhost:5173
start "DocuForge Web - keep open" /D "%~dp0apps\web" cmd /k "npm.cmd run dev"

echo.
echo Keep both new windows open while using DocuForge.
echo Open http://localhost:5173 in your browser.
timeout /t 3 /nobreak >nul
endlocal
