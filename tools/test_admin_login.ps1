$ErrorActionPreference = 'Stop'

$body = @{ email = 'faiqsajjad652@gmail.com'; password = 'faiq1032' } | ConvertTo-Json
try {
    $login = Invoke-RestMethod -Uri 'http://localhost:3026/api/auth/login' -Method Post -ContentType 'application/json' -Body $body
} catch {
    Write-Output "LOGIN_ERROR: $($_.Exception.Message)"
    exit 2
}

Write-Output "LOGIN_RESPONSE:`n$($login | ConvertTo-Json -Depth 5)"
$token = $login.token
if (-not $token) { Write-Output 'No token returned'; exit 3 }

try {
    $inquiries = Invoke-RestMethod -Uri 'http://localhost:3026/api/admin/inquiries' -Headers @{ Authorization = "Bearer $token" } -Method Get
} catch {
    Write-Output "INQUIRIES_ERROR: $($_.Exception.Message)"
    exit 4
}

Write-Output "INQUIRIES_COUNT: $($inquiries.Count)"
Write-Output $($inquiries | ConvertTo-Json -Depth 6)
