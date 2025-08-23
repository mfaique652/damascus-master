Set-Location -LiteralPath 'D:\Damascus Master'
Write-Output '=== node processes (WMI) ==='
try {
  Get-WmiObject Win32_Process -Filter "Name='node.exe'" | Select-Object ProcessId, CommandLine | Format-List
} catch {
  Write-Output 'Failed to list node processes: ' + $_.Exception.Message
}

Write-Output '\n=== server.js header (bytes) ==='
try {
  $bytes = Get-Content -Path .\server\server.js -Encoding Byte -TotalCount 16
  $hex = $bytes | ForEach-Object { $_.ToString('X2') }
  Write-Output ($hex -join ' ')
} catch {
  Write-Output 'Failed to read file header: ' + $_.Exception.Message
}
