$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

New-Item -ItemType Directory -Force -Path ".\data" | Out-Null

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
}

$TokenLine = Get-Content ".env" |
  Where-Object { $_ -match '^OTLP_TOKEN=' } |
  Select-Object -First 1

$Token = if ($TokenLine) { ($TokenLine -split '=', 2)[1].Trim() } else { "" }
if (-not $Token -or $Token -like "REPLACE_*" -or $Token.Length -lt 32) {
  throw "Configure a random OTLP_TOKEN of at least 32 characters in .env."
}

docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Desktop Linux engine is not running." }

docker compose config --quiet
if ($LASTEXITCODE -ne 0) { throw "Docker Compose configuration is invalid." }

docker compose up -d
if ($LASTEXITCODE -ne 0) { throw "OTLP Collector failed to start." }

docker compose ps
Write-Host "OTLP Collector started on http://127.0.0.1:4318"
Write-Host "Health: http://127.0.0.1:13134"
