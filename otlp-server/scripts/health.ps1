$ErrorActionPreference = "Stop"
$Response = Invoke-RestMethod -Uri "http://127.0.0.1:13134"
$Response

$Root = Split-Path -Parent $PSScriptRoot
$RawFile = Join-Path $Root "data\logs.jsonl"
if (Test-Path $RawFile) {
  Get-Item $RawFile | Select-Object FullName,Length,LastWriteTime
} else {
  Write-Host "logs.jsonl has not been created yet."
}
