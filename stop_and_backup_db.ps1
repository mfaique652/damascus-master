# stop_and_backup_db.ps1
# Stops node server processes matching server.js or run_local_server, and backs up server/data/db.json

Write-Output "Running stop_and_backup_db.ps1"

# Try to find processes with command line containing server.js or run_local_server
$matches = Get-CimInstance Win32_Process | Where-Object {
    ($_.CommandLine -and ($_.CommandLine -like '*server.js*' -or $_.CommandLine -like '*run_local_server*' -or $_.CommandLine -like '*run_local_server.ps1*')) -or ($_.Name -like 'node*')
}

if ($matches) {
    Write-Output "Found candidate processes:"
    $matches | Select-Object ProcessId, Name, @{Name='CommandLine';Expression={$_.CommandLine}} | Format-List
    foreach ($p in $matches) {
        try {
            Write-Output "Stopping PID $($p.ProcessId) ($($p.Name))"
            Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
            Write-Output "Stopped $($p.ProcessId)"
        } catch {
            Write-Output "Failed to stop $($p.ProcessId): $($_.Exception.Message)"
        }
    }
} else {
    Write-Output "No candidate server processes found."
}

# Backup db.json
$src = Join-Path $PSScriptRoot 'server\data\db.json'
if (Test-Path $src) {
    $ts = Get-Date -Format 'yyyyMMdd_HHmmss'
    $bak = Join-Path (Split-Path $src) ("db.json.bak.$ts")
    try {
        Copy-Item -Path $src -Destination $bak -Force
        Write-Output "Backup created: $bak"
        Get-Item $src | Select-Object FullName, LastWriteTime, Length | Format-List
        Write-Output "Available backups:"
        Get-ChildItem (Split-Path $src) -Filter 'db.json.bak*' | Sort-Object LastWriteTime -Descending | Select-Object Name, LastWriteTime, Length | Format-Table -AutoSize
    } catch {
        Write-Output "Backup failed: $($_.Exception.Message)"
    }
} else {
    Write-Output "Source db.json not found at $src"
}
