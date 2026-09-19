$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$TokenLine = Get-Content (Join-Path $Root ".env") |
  Where-Object { $_ -match '^OTLP_TOKEN=' } |
  Select-Object -First 1
if (-not $TokenLine) { throw "OTLP_TOKEN is missing." }
$Token = ($TokenLine -split '=', 2)[1].Trim()

$Payload = @{
  resourceLogs = @(@{
    resource = @{ attributes = @(
      @{ key = "service.name"; value = @{ stringValue = "manual-otlp-test" } }
    ) }
    scopeLogs = @(@{
      scope = @{ name = "dashboard-integration-test" }
      logRecords = @(@{
        timeUnixNano = ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() * 1000000).ToString()
        attributes = @(
          @{ key = "event.name"; value = @{ stringValue = "endpoint_test" } }
          @{ key = "request_id"; value = @{ stringValue = "req_$([guid]::NewGuid().ToString('N'))" } }
          @{ key = "input_tokens"; value = @{ intValue = "25" } }
          @{ key = "output_tokens"; value = @{ intValue = "5" } }
        )
      })
    })
  })
} | ConvertTo-Json -Depth 12

$Response = Invoke-WebRequest `
  -Uri "http://127.0.0.1:4318/v1/logs" `
  -Method Post `
  -ContentType "application/json" `
  -Headers @{ Authorization = "Bearer $Token" } `
  -Body $Payload `
  -UseBasicParsing

Write-Host "Authenticated OTLP response: HTTP $($Response.StatusCode)"
Start-Sleep -Seconds 3
Get-Content (Join-Path $Root "data\logs.jsonl") -Tail 1
