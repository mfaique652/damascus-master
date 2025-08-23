$root = 'C:\Users\faiqs\Downloads\Programs\PortableGit\mingw64'
Write-Output ("Checking path: $root")
$candidates = @("$root\bin\git.exe","$root\cmd\git.exe","$root\share\git\git.exe","$root\git.exe")
foreach ($p in $candidates) { Write-Output ("Test: $p -> " + (Test-Path $p)) }
$found = $null
foreach ($p in $candidates) { if (Test-Path $p) { $found = $p; break } }
if ($found) { Write-Output ("Found git.exe: $found"); & $found --version; exit 0 } else {
  Write-Output 'No git.exe found in expected locations. Listing some git.exe under root...'
  Get-ChildItem -Path $root -Recurse -Filter git.exe -ErrorAction SilentlyContinue | Select-Object -First 10 | ForEach-Object { Write-Output $_.FullName }
  exit 2
}
