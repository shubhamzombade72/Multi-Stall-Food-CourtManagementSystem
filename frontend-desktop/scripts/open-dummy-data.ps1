# Opens the desktop app (from this folder's source) on the dummy data profile made by load-dummy-data.mjs.
# Its own profile and update folders, and no scheduled task, so the installed app and its data are never touched.
param([string]$Root = "$env:USERPROFILE\FoodCourt-Dummy-Data", [int]$DebugPort = 0)
$desktop = Split-Path -Parent $PSScriptRoot
$env:FOODCOURT_USER_DATA_DIR = Join-Path $Root 'profile'
$env:LOCALAPPDATA = Join-Path $Root 'local'
$env:FOODCOURT_UPDATE_NO_TASK = '1'
$env:FOODCOURT_UPDATE_FIRST_CHECK_MS = '86400000'
$env:FOODCOURT_PIN_LOCK = 'off'
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$electron = Join-Path $desktop 'node_modules\electron\dist\electron.exe'
$appArgs = @("`"$desktop`"")
if ($DebugPort -gt 0) { $appArgs = @("--remote-debugging-port=$DebugPort") + $appArgs }
Start-Process -FilePath $electron -ArgumentList $appArgs -WorkingDirectory $desktop
