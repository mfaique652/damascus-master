param(
    [int]$Port = 3026
)

$url = "http://localhost:$Port/"
Write-Output "Checking server at $url"
try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
    Write-Output ("HTTP " + $r.StatusCode + " " + $r.StatusDescription)
    if ($r.Content) {
        $c = $r.Content
        Write-Output "CONTENT_PREVIEW:"
        Write-Output $c.Substring(0,[math]::Min(500,$c.Length))
    }
} catch {
    Write-Output ("Request failed: " + $_.Exception.Message)
}

Write-Output "---- STDOUT (tail 80) ----"
try { Get-Content -Path (Join-Path $PSScriptRoot "..\server-local.log") -Tail 80 -ErrorAction SilentlyContinue } catch {}
Write-Output "---- STDERR (tail 80) ----"
try { Get-Content -Path (Join-Path $PSScriptRoot "..\server.err.log") -Tail 80 -ErrorAction SilentlyContinue } catch {}
