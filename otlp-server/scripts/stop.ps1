$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
docker compose down --remove-orphans
if ($LASTEXITCODE -ne 0) { throw "Failed to stop the OTLP Collector." }

