Set-Location -LiteralPath 'D:\Damascus Master'
Write-Output '=== node processes ==='
try {
  Get-WmiObject Win32_Process -Filter "Name='node.exe'" | Select-Object ProcessId, CommandLine | Format-List
} catch {
  Write-Output 'Failed to list node processes: ' + $_.Exception.Message
}
