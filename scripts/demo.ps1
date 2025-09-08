<#
PowerShell demo script for a quick reproducible API flow.

Usage (PowerShell):
  # ensure server is running on localhost:3000
  pwsh ./scripts/demo.ps1

Parameters:
  -BaseUrl: base URL for the API (default http://localhost:3000)
  -JourneyFile: path to journey JSON (default examples/journeys/example_journey.json)
  -TriggerFile: path to trigger JSON (default examples/triggers/example_trigger_hip.json)
  -PollIntervalSec: how often to poll run status (default 1)
  -TimeoutSec: overall timeout in seconds (default 120)
  -Quiet: suppress per-poll output

This script is intended to be short and deterministic for recording a GIF/demo.
#>

param(
    [string]$BaseUrl = 'http://localhost:3000',
    [string]$JourneyFile = 'examples/journeys/example_journey.json',
    [string]$TriggerFile = 'examples/triggers/example_trigger_hip.json',
    [int]$PollIntervalSec = 1,
    [int]$TimeoutSec = 120,
    [switch]$Quiet
)

function PostJson($endpoint, $file) {
    if (-not (Test-Path $file)) {
        Write-Error "File not found: $file"
        exit 2
    }
    if (-not $Quiet) { Write-Host "POST $endpoint <- $file" -ForegroundColor Cyan }

    # Preferred: stream the file directly so PowerShell doesn't miscalculate Content-Length
    try {
        return Invoke-RestMethod -Uri $endpoint -Method Post -InFile $file -ContentType 'application/json'
    } catch {
        # If -InFile isn't supported or failed, fall back to UTF8-encoded body with correct Content-Length
        try {
            $body = Get-Content -Raw -Path $file -Encoding UTF8
        } catch {
            # older PS versions may not accept -Encoding on Get-Content -Raw
            $body = Get-Content -Raw -Path $file
        }

        try {
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
            $headers = @{ 'Content-Length' = $bytes.Length }
            return Invoke-RestMethod -Uri $endpoint -Method Post -Body $body -ContentType 'application/json; charset=utf-8' -Headers $headers
        } catch {
            # Best-effort diagnostics: dump the full error and try several common locations
            $err = $_
            Write-Error "Request failed: $($err.Exception.Message)"
            # Show the full error record for debugging
            try {
                $full = $err | Format-List * -Force | Out-String
                Write-Error "Full error record:\n$full"
            } catch { }

            $tryResponses = @()
            try { if ($null -ne $err.Exception) { $tryResponses += $err.Exception.Response } } catch {}
            try { if ($null -ne $err.Exception.InnerException) { $tryResponses += $err.Exception.InnerException.Response } } catch {}
            try { if ($null -ne $err.Response) { $tryResponses += $err.Response } } catch {}

            foreach ($resp in $tryResponses) {
                try {
                    if ($null -ne $resp) {
                        $stream = $resp.GetResponseStream()
                        if ($null -ne $stream) {
                            $reader = New-Object System.IO.StreamReader($stream)
                            $bodyDump = $reader.ReadToEnd()
                            if ($bodyDump) { Write-Error "Response body: $bodyDump" }
                        }
                    }
                } catch { }
            }

            exit 3
        }
    }
}

function GetJson($endpoint) {
    try {
        return Invoke-RestMethod -Uri $endpoint -Method Get
    } catch {
        Write-Error "GET failed: $($_.Exception.Message)"
        exit 4
    }
}

Write-Host "Demo: baseUrl=$BaseUrl" -ForegroundColor Green

# 1) Create journey
$journeyEndpoint = "$BaseUrl/journeys"
$journeyResp = PostJson $journeyEndpoint $JourneyFile

# Try common response shapes for journey id
$journeyId = $null
if ($null -ne $journeyResp) {
    if ($journeyResp.journeyId) { $journeyId = $journeyResp.journeyId }
    elseif ($journeyResp.id) { $journeyId = $journeyResp.id }
    elseif ($journeyResp.journey -and $journeyResp.journey.id) { $journeyId = $journeyResp.journey.id }
}

if (-not $journeyId) {
    Write-Error "Could not determine journeyId from response. Response was:`n$($journeyResp | ConvertTo-Json -Depth 5)"
    exit 5
}

Write-Host "Created journeyId=$journeyId" -ForegroundColor Yellow

# 2) Trigger journey
$triggerEndpoint = "$BaseUrl/journeys/$journeyId/trigger"
$triggerResp = PostJson $triggerEndpoint $TriggerFile

# Try common response shapes for run id
$runId = $null
if ($null -ne $triggerResp) {
    if ($triggerResp.runId) { $runId = $triggerResp.runId }
    elseif ($triggerResp.id) { $runId = $triggerResp.id }
    elseif ($triggerResp.run -and $triggerResp.run.id) { $runId = $triggerResp.run.id }
}

if (-not $runId) {
    Write-Error "Could not determine runId from trigger response. Response was:`n$($triggerResp | ConvertTo-Json -Depth 5)"
    exit 6
}

Write-Host "Triggered runId=$runId" -ForegroundColor Yellow

# 3) Poll run status until final
$runEndpoint = "$BaseUrl/journeys/runs/$runId"
$deadline = (Get-Date).AddSeconds($TimeoutSec)
while ((Get-Date) -lt $deadline) {
    $run = GetJson $runEndpoint
    $state = $null
    if ($null -ne $run) {
        if ($run.state) { $state = $run.state }
        elseif ($run.status) { $state = $run.status }
    }

    if (-not $Quiet) { Write-Host "[poll] state=$state at $(Get-Date -Format o)" }

    if ($state -in @('completed','failed','cancelled')) {
        Write-Host "Run finished with state=$state" -ForegroundColor Green
        Write-Host "Full run object:" -ForegroundColor Gray
        $run | ConvertTo-Json -Depth 10
        if ($state -eq 'completed') { exit 0 } else { exit 1 }
    }

    Start-Sleep -Seconds $PollIntervalSec
}

Write-Error "Timeout waiting for run to complete after $TimeoutSec seconds"
exit 7
