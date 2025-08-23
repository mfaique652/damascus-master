$launcher = Join-Path -Path $PSScriptRoot -ChildPath 'server_launcher.js'
Write-Output "PSScriptRoot = $PSScriptRoot"
Write-Output "launcher = $launcher"
$argString = '"' + $launcher + '" 3027'
Write-Output "argString = $argString"
$nodeCmd = (Get-Command node -ErrorAction SilentlyContinue).Source
Write-Output "nodeCmd = $nodeCmd"
try {
    $p = Start-Process -FilePath $nodeCmd -ArgumentList $argString -WorkingDirectory $PSScriptRoot -PassThru -ErrorAction Stop
    Write-Output "Started: PID=$($p.Id)"
} catch {
    Write-Output "Start-Process failed: $($_ | Out-String)"
}
