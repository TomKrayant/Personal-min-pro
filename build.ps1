param(
  [string]$DshRoot = 'D:\Appdownload_local\DeepSeekHar',
  [string]$OutDir = (Join-Path $PSScriptRoot 'dist\LinhuPet')
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$appSource = Join-Path $projectRoot 'linhu-pet'
$resolvedOut = [System.IO.Path]::GetFullPath($OutDir)
$distRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'dist'))

if (-not $resolvedOut.StartsWith($distRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "OutDir must stay under $distRoot"
}
if (-not (Test-Path (Join-Path $DshRoot 'DeepSeek Harness.exe'))) {
  throw "DSH installation not found at $DshRoot (pass -DshRoot)."
}
if (-not (Test-Path (Join-Path $appSource 'src\main.cjs'))) {
  throw "Pet source not found at $appSource"
}

if (Test-Path $resolvedOut) { Remove-Item -LiteralPath $resolvedOut -Recurse -Force }
New-Item -ItemType Directory -Force -Path $resolvedOut | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $resolvedOut 'resources') | Out-Null

$runtimeFiles = @(
  'chrome_100_percent.pak',
  'chrome_200_percent.pak',
  'd3dcompiler_47.dll',
  'dxcompiler.dll',
  'dxil.dll',
  'ffmpeg.dll',
  'icudtl.dat',
  'LICENSE.electron.txt',
  'LICENSES.chromium.html',
  'resources.pak',
  'snapshot_blob.bin',
  'v8_context_snapshot.bin',
  'vk_swiftshader.dll',
  'vk_swiftshader_icd.json',
  'version'
)

foreach ($name in $runtimeFiles) {
  Copy-Item -LiteralPath (Join-Path $DshRoot $name) -Destination (Join-Path $resolvedOut $name)
}
Copy-Item -LiteralPath (Join-Path $DshRoot 'locales') -Destination (Join-Path $resolvedOut 'locales') -Recurse
Copy-Item -LiteralPath (Join-Path $DshRoot 'DeepSeek Harness.exe') -Destination (Join-Path $resolvedOut 'LinhuPet.exe')
Copy-Item -LiteralPath (Join-Path $DshRoot 'resources\default_app.asar') -Destination (Join-Path $resolvedOut 'resources\default_app.asar')

# Electron loads resources/app before app.asar. Keeping no app.asar also avoids
# the signed DeepSeek binary's embedded app.asar integrity manifest.
$appDest = Join-Path $resolvedOut 'resources\app'
Copy-Item -LiteralPath $appSource -Destination $appDest -Recurse
Remove-Item -LiteralPath (Join-Path $appDest 'docs') -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $appDest 'src\preview.html') -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $appDest 'src\icon.html') -Force -ErrorAction SilentlyContinue

Copy-Item -LiteralPath (Join-Path $appDest 'assets\icon.png') -Destination (Join-Path $resolvedOut 'resources\icon.png') -Force
Copy-Item -LiteralPath (Join-Path $appDest 'assets\tray.ico') -Destination (Join-Path $resolvedOut 'resources\tray.ico') -Force

$buildInfo = [ordered]@{
  name = 'Linhu DSH Pet'
  version = '1.0.0'
  builtAt = (Get-Date).ToString('o')
  runtime = 'DeepSeek Harness Electron 44.7.0'
  source = $appSource
}
$buildInfo | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $appDest 'build-info.json') -Encoding UTF8

$launcher = @'
@echo off
cd /d "%~dp0"
start "" "%~dp0LinhuPet.exe"
'@
Set-Content -LiteralPath (Join-Path $resolvedOut '启动林虎桌宠.bat') -Value $launcher -Encoding ASCII

Copy-Item -LiteralPath (Join-Path $projectRoot 'README.md') -Destination (Join-Path $resolvedOut 'README.md') -Force -ErrorAction SilentlyContinue
if (Test-Path (Join-Path $projectRoot 'linhu-pet\docs')) {
  Copy-Item -LiteralPath (Join-Path $projectRoot 'linhu-pet\docs') -Destination (Join-Path $resolvedOut 'docs') -Recurse -Force
}

$size = (Get-ChildItem $resolvedOut -Recurse -File | Measure-Object -Property Length -Sum).Sum
Write-Output ("Built: {0}" -f $resolvedOut)
Write-Output ("Files: {0}  Size: {1:N1} MB" -f (Get-ChildItem $resolvedOut -Recurse -File).Count, ($size / 1MB))
Write-Output ("Executable: {0}" -f (Join-Path $resolvedOut 'LinhuPet.exe'))
