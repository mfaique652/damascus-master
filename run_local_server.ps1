param(
	[int]$Port = 3026,
	[switch]$Watch
)

Set-Location -Path (Split-Path -Parent $MyInvocation.MyCommand.Definition)

Write-Output ("Starting local server helper - requested port: {0} (Watch={1})" -f $Port, ([bool]$Watch))

function Test-PortInUse {
	param([int]$p)
	# Prefer Get-NetTCPConnection where available; fall back to parsing netstat output so this works on
	# systems where the cmdlet is not present (older Windows or restricted environments).
	try {
		$g = Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue
		if ($g) {
			return Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue
		} else {
			# Fallback: use netstat -ano and look for a line with :<port> and a PID
			$lines = & netstat -ano 2>$null | Select-String -Pattern ":$p\b"
			if (-not $lines) { return $null }
			# netstat columns: Proto  Local Address  Foreign Address  State  PID
			foreach ($l in $lines) {
				$text = $l.ToString().Trim()
				# Split on whitespace and take last token as PID when present
				$parts = $text -split '\s+' | Where-Object { $_ -ne '' }
				if ($parts.Count -ge 1) {
					$ownerPidToken = $parts[-1]
					if ($ownerPidToken -match '^[0-9]+$') {
						# Return a minimal object with OwningProcess property to keep calling code unchanged
						return @{ OwningProcess = [int]$ownerPidToken }
					}
				}
			}
			return $null
		}
	} catch {
		return $null
	}
}

$maxAttempts = 20
$attempt = 0
$chosen = $Port

while ($attempt -lt $maxAttempts) {
	$conn = Test-PortInUse -p $chosen
	if (-not $conn) { break }

	$ownerPid = $conn.OwningProcess
	if ($ownerPid) {
		try {
			$proc = Get-CimInstance Win32_Process -Filter "ProcessId=$ownerPid" -ErrorAction SilentlyContinue
		} catch {
			$proc = $null
		}

		if ($proc -and $proc.Name -and $proc.Name.ToLower().Contains('node')) {
			$cmd = ''
			if ($proc.CommandLine) { $cmd = $proc.CommandLine.ToLower() }
			if ($cmd -and ($cmd -like '*server\\server.js*' -or $cmd -like '*server/server.js*')) {
				Write-Output "Found existing node server on port $chosen (PID $ownerPid). Stopping it to free the port."
				try { Stop-Process -Id $ownerPid -Force -ErrorAction SilentlyContinue } catch {}
				Start-Sleep -Milliseconds 500
				$conn = Test-PortInUse -p $chosen
				if (-not $conn) { break }
			}
		}
	}

	Write-Output "Port $chosen is in use (owner PID: $ownerPid). Trying next port."
	$chosen += 1
	$attempt += 1
}

if ($attempt -ge $maxAttempts) {
	Write-Output "Could not find a free port after $maxAttempts attempts. Aborting."
	exit 1
}

Write-Output ("Using port {0} - launching server (watch={1})" -f $chosen, ([bool]$Watch))
$env:PORT = [string]$chosen
# Prefer nodemon when watch requested; run detached so wrapper exits and doesn't get interrupted by the caller
$nodemonCmdInfo = Get-Command nodemon -ErrorAction SilentlyContinue
$nodemonCmd = if ($nodemonCmdInfo) { $nodemonCmdInfo.Source } else { $null }

# Prepare logging paths so child process output is captured for troubleshooting
$logOut = Join-Path -Path $PSScriptRoot -ChildPath 'server-local.log'
$logErr = Join-Path -Path $PSScriptRoot -ChildPath 'server.err.log'

# Archive existing logs to avoid stale/corrupted traces confusing future runs.
# Archived logs are placed under backups/logs with a timestamp.
$backupDir = Join-Path -Path $PSScriptRoot -ChildPath 'backups\logs'
if (-not (Test-Path $backupDir)) {
	try { New-Item -Path $backupDir -ItemType Directory | Out-Null } catch {}
}
$ts = Get-Date -Format 'yyyyMMdd_HHmmss'
if (Test-Path $logOut) {
	try {
		Move-Item -Path $logOut -Destination (Join-Path $backupDir ("server-local_$ts.log")) -Force
	} catch {
		# If Move fails (file in use), copy the current log to archive so we don't lose history.
		try { Copy-Item -Path $logOut -Destination (Join-Path $backupDir ("server-local_$ts.log")) -Force } catch {}
	}
}
if (Test-Path $logErr) {
	try {
		Move-Item -Path $logErr -Destination (Join-Path $backupDir ("server-err_$ts.log")) -Force
	} catch {
		# Fall back to copy if move fails
		try { Copy-Item -Path $logErr -Destination (Join-Path $backupDir ("server-err_$ts.log")) -Force } catch {}
	}
}
# Run node directly against the server script to avoid an extra launcher process which
# previously caused argument/encoding corruption when started via Start-Process.
$serverScript = Join-Path -Path $PSScriptRoot -ChildPath 'server\server.js'
# Build an argument array passing the server script and port. Rely on package.json "type":"module"
# (or .mjs) so Node treats server/server.js as an ES module without needing --input-type.
# Build an argument array passing the server script and port. Rely on package.json "type":"module"
# (or .mjs) so Node treats server/server.js as an ES module without needing --input-type.
$arguments = @($serverScript, [string]$chosen)
# Use a single, quoted argument string when calling Start-Process to avoid splitting/encoding
# issues with paths that contain spaces. Example: "\"D:\Path With Space\server\\server.js\" 3026"
$argString = '"' + $serverScript + '" ' + [string]$chosen

# Ensure log files exist so Start-Process can redirect to them on start
try { New-Item -Path $logOut -ItemType File -Force | Out-Null } catch {}
try { New-Item -Path $logErr -ItemType File -Force | Out-Null } catch {}

# Diagnostic: dump key variables so we can debug Start-Process failures when run as a whole
Write-Output ("[DIAG] PSScriptRoot={0}" -f $PSScriptRoot)
Write-Output ("[DIAG] serverScript={0}" -f $serverScript)
Write-Output ("[DIAG] arguments={0}" -f ($arguments -join ' '))
Write-Output ("[DIAG] nodemonCmd={0}" -f $nodemonCmd)



if ($Watch -and $nodemonCmd) {
	Write-Output ("Launching nodemon as a detached process (stdout: {0}, stderr: {1})" -f $logOut, $logErr)
		Write-Output ("Attempting to Start-Process nodemon: FilePath={0} ArgumentList={1}" -f $nodemonCmd, $argString)
		try {
			$proc = Start-Process -FilePath $nodemonCmd -ArgumentList $argString -WorkingDirectory $PSScriptRoot -RedirectStandardOutput $logOut -RedirectStandardError $logErr -WindowStyle Hidden -PassThru -ErrorAction Stop
		} catch {
		Write-Output ("Failed to launch nodemon. Error record:\n{0}" -f ($_ | Out-String))
		$proc = $null
	}
}

if (-not $proc) {
	Write-Output ("Launching node as a detached process (stdout: {0}, stderr: {1})" -f $logOut, $logErr)
	$nodeCmdInfo = Get-Command node -ErrorAction SilentlyContinue
	$nodeCmd = if ($nodeCmdInfo) { $nodeCmdInfo.Source } else { $null }
	if (-not $nodeCmd) {
		Write-Output "node executable not found in PATH. Please install Node.js or ensure it's on PATH."
		exit 2
	}
		Write-Output ("Attempting to Start-Process node: FilePath={0} ArgumentList={1}" -f $nodeCmd, $argString)
		try {
			$proc = Start-Process -FilePath $nodeCmd -ArgumentList $argString -WorkingDirectory $PSScriptRoot -RedirectStandardOutput $logOut -RedirectStandardError $logErr -WindowStyle Hidden -PassThru -ErrorAction Stop
		} catch {
		Write-Output ("Failed to start node. Error record:\n{0}" -f ($_ | Out-String))
		exit 1
	}
}

if ($proc -and $proc.Id) {
	Write-Output ("Server process started (PID={0}). Use Stop-Process -Id {0} to stop it." -f $proc.Id)
	exit 0
} else {
	Write-Output "Failed to start server process"
	exit 1
}
