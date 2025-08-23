$marker = '<!-- smoke-test: append ' + (Get-Date -Format 'u') + ' -->'
$marker | Out-File -FilePath (Join-Path $PSScriptRoot "..\index.html") -Encoding utf8 -Append
Write-Output 'Appended smoke-test marker to index.html'
