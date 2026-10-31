param(
  [string]$Source = '',
  [string]$Target = (Join-Path $env:LOCALAPPDATA 'Programs\LinhuPet'),
  [switch]$NoLaunch,
  [switch]$NoDesktopShortcut,
  [switch]$NoStartMenuShortcut
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($Source)) {
  if (Test-Path (Join-Path $PSScriptRoot 'LinhuPet.exe')) {
    $Source = $PSScriptRoot
  } else {
    $Source = Join-Path $PSScriptRoot 'dist\LinhuPet'
  }
}
$sourcePath = [System.IO.Path]::GetFullPath($Source)
$targetPath = [System.IO.Path]::GetFullPath($Target)
$localRoot = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs'))

if (-not (Test-Path (Join-Path $sourcePath 'LinhuPet.exe'))) {
  throw "找不到桌宠可执行文件：$sourcePath\LinhuPet.exe。请先运行 .\build.ps1。"
}
if (-not $targetPath.StartsWith($localRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "安装目录必须位于 $localRoot 下。"
}

Get-Process -Name 'LinhuPet' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 400

if (Test-Path $targetPath) {
  Remove-Item -LiteralPath $targetPath -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $targetPath | Out-Null
Copy-Item -Path (Join-Path $sourcePath '*') -Destination $targetPath -Recurse -Force

$exe = Join-Path $targetPath 'LinhuPet.exe'
$icon = Join-Path $targetPath 'resources\app\assets\tray.ico'
$shell = New-Object -ComObject WScript.Shell

function New-PetShortcut([string]$Path) {
  $shortcut = $shell.CreateShortcut($Path)
  $shortcut.TargetPath = $exe
  $shortcut.WorkingDirectory = $targetPath
  $shortcut.IconLocation = $icon
  $shortcut.Description = '林虎 · DSH 桌宠'
  $shortcut.Save()
}

if (-not $NoDesktopShortcut) {
  $desktop = [Environment]::GetFolderPath('Desktop')
  New-PetShortcut (Join-Path $desktop '林虎桌宠.lnk')
  Write-Output "已创建桌面快捷方式：$desktop\林虎桌宠.lnk"
}

if (-not $NoStartMenuShortcut) {
  $startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
  New-PetShortcut (Join-Path $startMenu '林虎桌宠.lnk')
  Write-Output "已创建开始菜单快捷方式：$startMenu\林虎桌宠.lnk"
}

Write-Output "已安装到：$targetPath"
if (-not $NoLaunch) {
  Start-Process -FilePath $exe -WorkingDirectory $targetPath
  Write-Output '林虎桌宠已启动，右下角托盘可见。'
}
