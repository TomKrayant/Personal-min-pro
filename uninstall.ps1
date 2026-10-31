param(
  [switch]$RemoveData
)

$ErrorActionPreference = 'SilentlyContinue'
Get-Process -Name 'LinhuPet' | Stop-Process -Force
Start-Sleep -Milliseconds 400

# Remove any auto-start value created by the tray toggle.
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$runProps = Get-ItemProperty -Path $runKey
foreach ($prop in $runProps.PSObject.Properties) {
  if ($prop.Name -notlike 'PS*' -and "$($prop.Value)" -like '*LinhuPet*') {
    Remove-ItemProperty -Path $runKey -Name $prop.Name -Force
  }
}
$approvedKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'
$approvedProps = Get-ItemProperty -Path $approvedKey
foreach ($prop in $approvedProps.PSObject.Properties) {
  if ($prop.Name -notlike 'PS*' -and $prop.Name -like '*Linhu*') {
    Remove-ItemProperty -Path $approvedKey -Name $prop.Name -Force
  }
}

$target = Join-Path $env:LOCALAPPDATA 'Programs\LinhuPet'
if (Test-Path $target) {
  Remove-Item -LiteralPath $target -Recurse -Force
  Write-Output "已删除：$target"
}

$desktop = [Environment]::GetFolderPath('Desktop')
Remove-Item -LiteralPath (Join-Path $desktop '林虎桌宠.lnk') -Force
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
Remove-Item -LiteralPath (Join-Path $startMenu '林虎桌宠.lnk') -Force

if ($RemoveData) {
  $data = Join-Path $env:APPDATA 'LinhuPet'
  if (Test-Path $data) {
    Remove-Item -LiteralPath $data -Recurse -Force
    Write-Output "已删除配置：$data"
  }
}

Write-Output '林虎桌宠已卸载。'
