param(
  [Parameter(Mandatory=$true)][string]$EmployeeId,
  [Parameter(Mandatory=$true)][string]$EmployeeEmail,
  [string]$EmployeeName = "",
  [string]$Department = "engineering",
  [string]$CollectorUrl = "http://127.0.0.1:4318"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$TokenLine = Get-Content (Join-Path $Root ".env") |
  Where-Object { $_ -match '^OTLP_TOKEN=' } |
  Select-Object -First 1
if (-not $TokenLine) { throw "OTLP_TOKEN is missing. Run scripts/start.ps1 first." }
$Token = ($TokenLine -split '=', 2)[1].Trim()
if (-not $Token) { throw "OTLP_TOKEN is empty." }

$env:CLAUDE_CODE_ENABLE_TELEMETRY = "1"
$env:OTEL_LOGS_EXPORTER = "otlp"
$env:OTEL_METRICS_EXPORTER = "otlp"
$env:OTEL_EXPORTER_OTLP_PROTOCOL = "http/protobuf"
$env:OTEL_EXPORTER_OTLP_ENDPOINT = $CollectorUrl.TrimEnd("/")
$env:OTEL_EXPORTER_OTLP_HEADERS = "Authorization=Bearer $Token"
$env:OTEL_LOGS_EXPORT_INTERVAL = "5000"
$env:OTEL_METRIC_EXPORT_INTERVAL = "10000"
$env:OTEL_LOG_USER_PROMPTS = "0"
$env:OTEL_LOG_ASSISTANT_RESPONSES = "0"
$env:OTEL_LOG_TOOL_DETAILS = "0"
$env:OTEL_LOG_TOOL_CONTENT = "0"
$env:OTEL_LOG_RAW_API_BODIES = "0"
$env:OTEL_METRICS_INCLUDE_ENTRYPOINT = "true"
$env:CLAUDE_CODE_OTEL_DIAG_STDERR = "1"

$Attributes = @(
  "org.name=Resolute_Corp",
  "employee.id=$EmployeeId",
  "employee.email=$EmployeeEmail",
  "department=$Department",
  "resolute.service=code"
)
if ($EmployeeName) { $Attributes += "employee.name=$EmployeeName" }
$env:OTEL_RESOURCE_ATTRIBUTES = $Attributes -join ","

Write-Host "Claude Code OTLP configured for this PowerShell session."
Write-Host "Endpoint: $($env:OTEL_EXPORTER_OTLP_ENDPOINT)"
Write-Host "Run Claude in this terminal: claude --debug"

