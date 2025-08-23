<#
Synopsis: Fix legacy album pages where price calculation breaks due to a regex typo.

Problem string:
	/[^d.]/g   (WRONG — matches any char except 'd' or '.')
Replacement:
	/[^\d.]/g (RIGHT — matches any char except digit or '.')

Usage:
	Run this script from PowerShell. It will scan all .html files under the script's folder,
	replace the incorrect pattern wherever found, and print a summary.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "Scanning HTML files under: $root" -ForegroundColor Cyan

$wrong  = "/[^d.]/g"
$right  = "/[^\d.]/g"
$changed = @()

Get-ChildItem -Path $root -Filter *.html -Recurse | ForEach-Object {
		$file = $_.FullName
		$content = Get-Content -LiteralPath $file -Raw -ErrorAction Stop
		if ($content -like "*${wrong}*") {
				$fixed = $content -replace [regex]::Escape($wrong), $right
				if ($fixed -ne $content) {
						Set-Content -LiteralPath $file -Value $fixed -Encoding UTF8
						$changed += $file
						Write-Host "Fixed: $file" -ForegroundColor Green
				}
		}
}

if ($changed.Count -gt 0) {
		Write-Host "`nUpdated $($changed.Count) file(s)." -ForegroundColor Green
} else {
		Write-Host "No files needed changes." -ForegroundColor Yellow
}
