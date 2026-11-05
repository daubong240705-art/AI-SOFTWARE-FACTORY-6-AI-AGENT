# Explicit local reset: close ASF Windows Worker before running this script.
# Removes only Worker SQLite files/backups, including stored configuration/key.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$taskAppData = [IO.Path]::GetFullPath([Environment]::GetFolderPath('ApplicationData'))
$taskExpected = [IO.Path]::GetFullPath((Join-Path $taskAppData 'ASF Windows Worker'))
if (-not (Test-Path -LiteralPath $taskExpected -PathType Container)) {
    Write-Output 'Worker data directory does not exist. Nothing to reset.'
    return
}
$taskDirectory = Get-Item -LiteralPath $taskExpected
if ($taskDirectory.FullName -ne $taskExpected -or ($taskDirectory.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'Unexpected Worker data directory or junction. Nothing was deleted.'
}
$taskRunning = @(Get-CimInstance Win32_Process | Where-Object {
    $_.Name -match '^(?:ASF Windows Worker|asf-windows-worker).*\.exe$' -or
    ($_.Name -eq 'electron.exe' -and ($_.CommandLine -like '*ASF Windows Worker*' -or $_.ExecutablePath -like '*\apps\windows-worker\node_modules\electron\dist\electron.exe'))
})
if ($taskRunning.Count) { throw 'Close ASF Windows Worker completely, then run this script again. Nothing was deleted.' }
$taskFiles = @(Get-ChildItem -LiteralPath $taskExpected -File | Where-Object { $_.Name -match '^worker(?:\..*)?\.sqlite(?:-(?:wal|shm|journal))?$' })
foreach ($taskFile in $taskFiles) {
    if ($taskFile.DirectoryName -ne $taskExpected -or ($taskFile.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Unexpected database file path. Reset stopped.'
    }
}
foreach ($taskFile in $taskFiles) { Remove-Item -LiteralPath $taskFile.FullName -Force }
Write-Output "Reset complete. Removed $($taskFiles.Count) Worker database/backup files. Project source folders were not changed."
Write-Output 'Start Worker and configure projects, model settings and API key again.'
