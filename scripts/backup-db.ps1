# learningenglish - vo boc cho Task Scheduler.
#
# Trigger: Windows Task Scheduler 04:00 hang ngay (task "learningenglish-backup-daily").
#
# Ban than viec sao luu nam TRON trong scripts/backup-db.sh - file nay chi lam
# ba viec: goi no bang git-bash, dong dau thoi gian vao tung dong, va ghi ra
# logs/backup.log de sang hom sau con biet dem qua co chay khong.
#
# CO Y khong chep logic sang PowerShell: hai ban cai dat cua cung mot viec thi
# kieu gi cung lech nhau, va ban .sh la ban da duoc nghiem thu.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup-db.ps1

$ErrorActionPreference = 'Stop'

$ScriptRoot  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptRoot
$LogDir      = Join-Path $ProjectRoot 'logs'
$LogFile     = Join-Path $LogDir 'backup.log'

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

# KHONG dung `Tee-Object -FilePath`: tren PowerShell 5.1 no ghi file bang
# UTF-16LE, nen logs/backup.log doc bang tail/grep/git-bash ra toan rac
# ("[ 2 0 2 6 - 0 9 ..."). Da dinh that o lan chay dau. Add-Content -Encoding
# UTF8 thi moi cong cu deu doc duoc.
function Write-Log {
    param([string]$Level, [string]$Message)
    $line = "[{0}] [{1}] {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    Write-Host $line
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

# git-bash. Khong co thi bao ro chu khong de task "thanh cong" trong im lang.
$Bash = 'C:\Program Files\Git\bin\bash.exe'
if (-not (Test-Path $Bash)) {
    Write-Log 'ERROR' "Khong tim thay git-bash tai $Bash. Sao luu KHONG chay."
    exit 1
}

Write-Log 'INFO' '===== bat dau sao luu ====='

# 2>&1 gom ca stderr: `die` trong ban .sh ghi ra stderr, mat no la mat ly do loi.
$out = & $Bash -lc "cd '$($ProjectRoot -replace '\\','/')' && bash scripts/backup-db.sh" 2>&1
$code = $LASTEXITCODE

foreach ($line in $out) {
    if ("$line".Trim()) { Write-Log 'INFO' "$line" }
}

if ($code -ne 0) {
    Write-Log 'ERROR' "backup-db.sh thoat voi ma $code - KHONG co ban sao luu moi."
    exit $code
}

Write-Log 'INFO' '===== xong ====='
exit 0
