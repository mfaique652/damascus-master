$git='C:\Users\faiqs\Downloads\Programs\PortableGit\mingw64\bin\git.exe'
Set-Location -LiteralPath 'D:\Damascus Master'
Write-Output 'Git version:'; & $git --version
Write-Output '--- status ---'; & $git status --porcelain
Write-Output '--- add -A ---'; & $git add -A
Write-Output '--- commit ---'; & $git commit -m 'chore: fix local server wrapper: safe arg quoting, log rotation; add README and VS Code task; archive old launcher'
$rc=$LASTEXITCODE
if ($rc -eq 0) {
  Write-Output '--- commit succeeded ---'
  & $git rev-parse --abbrev-ref HEAD
  & $git log -1 --pretty=format:'%h %s'
} else {
  Write-Output ('git commit failed with exit code ' + $rc)
  & $git status --porcelain
}
