$git = 'C:\Users\faiqs\Downloads\Programs\PortableGit\mingw64\bin\git.exe'
Set-Location -LiteralPath 'D:\Damascus Master'

if (-not (Test-Path .git)) {
    Write-Output 'No .git directory found — initializing new git repository.'
    & $git init
} else {
    Write-Output '.git directory found — using existing repository.'
}

# Ensure user identity is set locally (avoid global changes)
$localName = & $git config --local user.name 2>$null
$localEmail = & $git config --local user.email 2>$null
if (-not $localName) {
    $user = $env:USERNAME
    if (-not $user) { $user = 'dev' }
    Write-Output ("Setting local git user.name to: $user")
    & $git config user.name $user
}
if (-not $localEmail) {
    $user = & $git config --local user.name 2>$null
    if (-not $user) { $user = $env:USERNAME; if (-not $user) { $user = 'dev' } }
    $email = "$user@local"
    Write-Output ("Setting local git user.email to: $email")
    & $git config user.email $email
}

Write-Output 'Staging all changes...'
& $git add -A

Write-Output 'Committing...'
& $git commit -m 'chore: fix local server wrapper: safe arg quoting, log rotation; add README and VS Code task; archive old launcher'
if ($LASTEXITCODE -ne 0) { Write-Output 'Nothing to commit or commit failed.' }

Write-Output 'Repository status:'
& $git status --short
Write-Output 'Last commit:'
& $git log -1 --pretty=format:'%h %s'
