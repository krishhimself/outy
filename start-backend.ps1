# Starts the Outy backend (FastAPI) using the virtualenv in backend\venv.
# Usage (from the repo root):  .\start-backend.ps1
$backend = Join-Path $PSScriptRoot "backend"
$python  = Join-Path $backend "venv\Scripts\python.exe"

if (-not (Test-Path $python)) {
    Write-Host "No virtualenv found at backend\venv. Create it once with:" -ForegroundColor Yellow
    Write-Host "  cd backend; python -m venv venv; venv\Scripts\python.exe -m pip install -r requirements.txt"
    exit 1
}

Set-Location $backend
& $python -m uvicorn server:app --reload --port 8000
