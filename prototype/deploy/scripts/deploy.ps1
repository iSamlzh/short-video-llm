param(
  [Parameter(Mandatory = $true)][string]$Server,
  [string]$User = "ubuntu",
  [Parameter(Mandatory = $true)][string]$RemoteSourceDirectory,
  [string]$ProductionDatabase = "/var/lib/content-agent/production.sqlite",
  [string]$BackupDirectory = "/var/backups/content-agent",
  [string]$IdentityFile = ""
)

$ErrorActionPreference = "Stop"
if ($Server -notmatch '^[A-Za-z0-9.-]+$') { throw "服务器地址格式不安全" }
if ($User -notmatch '^[A-Za-z_][A-Za-z0-9_-]*$') { throw "SSH 用户名格式不安全" }
if ($RemoteSourceDirectory -notmatch '^/[A-Za-z0-9._/-]+$') { throw "远程项目目录必须是安全的绝对路径" }
if ($ProductionDatabase -notmatch '^/[A-Za-z0-9._/-]+$') { throw "生产数据库必须是安全的绝对路径" }
if ($BackupDirectory -notmatch '^/[A-Za-z0-9._/-]+$') { throw "备份目录必须是安全的绝对路径" }

$sshArguments = @()
if ($IdentityFile) { $sshArguments += @("-i", $IdentityFile) }
$sshArguments += @("$User@$Server", "cd '$RemoteSourceDirectory' && sudo SOURCE_DIRECTORY='$RemoteSourceDirectory' PRODUCTION_DATABASE='$ProductionDatabase' PREDEPLOY_BACKUP_DIRECTORY='$BackupDirectory' bash deploy/scripts/deploy.sh")
& ssh @sshArguments
if ($LASTEXITCODE -ne 0) { throw "远程部署失败，退出码 $LASTEXITCODE" }
