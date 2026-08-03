# Wrapper PowerShell cho bộ script backup — dùng với Windows Task Scheduler.
#
# CHƯA KÍCH HOẠT: file này chỉ là công cụ. Không có tác vụ nào được đăng ký sẵn;
# xem `scheduler-examples.md` §3 để biết lệnh đăng ký.
#
# Vì sao cần wrapper: bộ script viết bằng bash (POSIX), còn Task Scheduler chạy
# PowerShell. Wrapper lo ba việc mà Task Scheduler không làm: nạp file env, ghi
# log ra file, và xoay vòng log cũ.
#
# DÙNG:
#   .\scheduler-windows.ps1              # backup thật
#   .\scheduler-windows.ps1 -DryRun      # diễn tập, không dump và không upload
#   .\scheduler-windows.ps1 -Prune       # dọn bản cũ (có --apply)
[CmdletBinding()]
param(
    # Diễn tập: chuyển --dry-run xuống backup.sh, không tạo dump, không upload.
    [switch]$DryRun,
    # Chạy prune.sh --apply thay vì backup.sh.
    [switch]$Prune,
    # File env (theo mẫu backup.env.example). Mặc định cạnh script này.
    [string]$EnvFile,
    # Số ngày giữ log của chính wrapper.
    [int]$LogKeepDays = 30
)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $EnvFile) { $EnvFile = Join-Path $ScriptDir 'backup.env' }

# --- Tìm bash (Git Bash) ---------------------------------------------------
$bash = (Get-Command bash.exe -ErrorAction SilentlyContinue).Source
if (-not $bash) {
    foreach ($p in @("$env:ProgramFiles\Git\bin\bash.exe", "${env:ProgramFiles(x86)}\Git\bin\bash.exe")) {
        if (Test-Path $p) { $bash = $p; break }
    }
}
if (-not $bash) {
    # Mã 4 = thiếu công cụ, khớp bảng mã thoát của lib.sh.
    Write-Error 'Khong tim thay bash.exe (can Git for Windows). Xem backup-and-restore.md.'
    exit 4
}

# --- Log + xoay vòng -------------------------------------------------------
$LogDir = Join-Path $ScriptDir 'logs'
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$LogFile = Join-Path $LogDir ("backup-{0}.log" -f (Get-Date -Format 'yyyyMMdd'))

# Task Scheduler khong tu xoay log — tu don o day.
Get-ChildItem -Path $LogDir -Filter 'backup-*.log' -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$LogKeepDays) } |
    Remove-Item -Force -ErrorAction SilentlyContinue

function Write-Log([string]$Message) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -Path $LogFile -Value $line -Encoding utf8
    Write-Output $line
}

# --- Chon script + tham so -------------------------------------------------
if ($Prune) {
    $target = './scripts/backup/prune.sh'
    $args   = '--apply'
} else {
    $target = './scripts/backup/backup.sh'
    $args   = $(if ($DryRun) { '--dry-run' } else { '' })
}

# Nap env roi chay, tat ca trong MOT phien bash: `set -a` khien moi bien duoc
# export ma KHONG hien tren dong lenh (`ps`/Task Scheduler khong thay gia tri).
# CO Y khong noi gia tri env vao chuoi lenh — do la duong ro ri credential.
$envFileBash = $EnvFile -replace '\\', '/'
$command = if (Test-Path $EnvFile) {
    "set -a && . '$envFileBash' && set +a && $target $args"
} else {
    Write-Log "CANH BAO: khong thay file env '$EnvFile' — dua vao bien moi truong san co."
    "$target $args"
}

$repoRoot = (Resolve-Path (Join-Path $ScriptDir '..\..')).Path

Write-Log "bat dau: $target $args"
Push-Location $repoRoot
try {
    # stderr cua script da la kenh log chinh; gop vao file log.
    & $bash -lc $command 2>&1 | ForEach-Object { Write-Log $_ }
    $code = $LASTEXITCODE
} finally {
    Pop-Location
}

Write-Log "ket thuc voi ma thoat $code"

# Lan truyen ma thoat de Task Scheduler bao dung/sai. Moi ma khac 0 PHAI duoc
# canh bao — backup hong am tham la tinh huong te nhat.
exit $code
