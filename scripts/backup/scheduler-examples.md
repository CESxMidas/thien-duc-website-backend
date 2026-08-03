# Mẫu lịch chạy backup — **CHƯA KÍCH HOẠT**

Các mẫu dưới đây cố ý **không** được cài đặt ở đâu cả. Kích hoạt cần credential
kho lưu trữ và một quyết định của chủ dự án (chọn nhà cung cấp, chi phí, vùng
lưu trữ). Xem `backup-and-restore.md` §7 để biết các bước thủ công còn lại.

## 1. cron (máy chủ tự quản / VPS)

```cron
# 02:15 UTC mỗi ngày — backup + kiểm chứng + dọn bản cũ.
15 2 * * *  cd /srv/thien-duc/backend && set -a && . ./scripts/backup/backup.env && set +a && ./scripts/backup/backup.sh >> /var/log/td-backup.log 2>&1
45 2 * * 0  cd /srv/thien-duc/backend && set -a && . ./scripts/backup/backup.env && set +a && ./scripts/backup/prune.sh --apply >> /var/log/td-backup.log 2>&1
```

`set -a` + `.` để nạp file env mà không lộ giá trị ra dòng lệnh (`ps` không
thấy). Log ghi ra file riêng, và script không in credential.

## 2. GitHub Actions (theo lịch)

```yaml
# .github/workflows/backup.yml — CHƯA TẠO. Cần secret trước khi bật.
name: Backup cơ sở dữ liệu
on:
  schedule:
    - cron: "15 2 * * *"
  workflow_dispatch:

jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Cài client PostgreSQL 17
        run: |
          sudo sh -c 'echo "deb https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
          curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/pgdg.gpg
          sudo apt-get update && sudo apt-get install -y postgresql-client-17
      - name: Chạy backup
        env:
          DATABASE_URL:       ${{ secrets.BACKUP_DATABASE_URL }}
          BACKUP_DEST:        s3
          BACKUP_DEST_URI:    ${{ secrets.BACKUP_DEST_URI }}
          BACKUP_ENCRYPT_KEY: ${{ secrets.BACKUP_ENCRYPT_KEY }}
          AWS_ACCESS_KEY_ID:  ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        run: ./scripts/backup/backup.sh
```

**Lưu ý phiên bản**: client `pg_dump` phải **bằng hoặc mới hơn** server
(production là PostgreSQL 17), nếu không `pg_dump` từ chối chạy.

## 2b. Biến trung lập nhà cung cấp (khuyến nghị cho cấu hình mới)

Mẫu §2 dùng `BACKUP_DEST: s3` — đường **cũ**, ràng vào AWS. Cấu hình mới nên
dùng adapter trung lập, không cam kết nhà cung cấp nào:

```yaml
        env:
          DATABASE_URL:          ${{ secrets.BACKUP_DATABASE_URL }}
          BACKUP_UPLOAD_COMMAND: ${{ vars.BACKUP_UPLOAD_COMMAND }}   # vd: 'rclone copyto {file} {remote}'
          BACKUP_REMOTE_PREFIX:  ${{ vars.BACKUP_REMOTE_PREFIX }}
          BACKUP_ENCRYPT_KEY:    ${{ secrets.BACKUP_ENCRYPT_KEY }}
```

Diễn tập trước khi bật thật: đặt `BACKUP_UPLOAD_DRY_RUN=1` — script in ra đúng
lệnh sẽ chạy rồi dừng, **không** gửi gì đi.

## 3. Windows — Task Scheduler + wrapper PowerShell

Máy vận hành của dự án là Windows, nên có sẵn wrapper:
[`scheduler-windows.ps1`](scheduler-windows.ps1).

```powershell
# Chạy tay một lần để kiểm tra (diễn tập, không upload):
powershell -ExecutionPolicy Bypass -File .\scripts\backup\scheduler-windows.ps1 -DryRun

# Đăng ký chạy 02:15 mỗi ngày (chạy trong PowerShell có quyền Administrator):
$action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument '-ExecutionPolicy Bypass -File "C:\srv\thien-duc\backend\scripts\backup\scheduler-windows.ps1"'
$trigger = New-ScheduledTaskTrigger -Daily -At 2:15am
Register-ScheduledTask -TaskName 'ThienDuc-Backup' -Action $action -Trigger $trigger `
  -Description 'Backup PostgreSQL Thiên Đức (xem scripts/backup/)'
```

Wrapper cần **Git Bash** (`bash.exe`) vì bộ script viết bằng bash — đây là môi
trường được hỗ trợ, xem §"Yêu cầu môi trường" trong `backup-and-restore.md`.

**Xoay vòng log trên Windows**: Task Scheduler không tự xoay log. Wrapper tự ghi
ra `logs/backup-YYYYMMDD.log` và tự xoá log cũ hơn `-LogKeepDays` (mặc định 30).

## 4. Scheduler ngoài (Render Cron Job / hosted scheduler)

Cùng một lệnh như cron ở §1. Ưu điểm: chạy gần DB nên nhanh và không lộ DB ra
Internet. Nhược điểm: tốn thêm một service trả phí.

## Cảnh báo khi hỏng

`backup.sh` thoát bằng mã lỗi riêng để scheduler phân biệt được nguyên nhân:

| Mã | Nghĩa |
|---|---|
| 0 | thành công |
| 2 | thiếu tham số / biến môi trường |
| 3 | đích không an toàn (đã chặn) |
| 4 | thiếu `pg_dump`/`pg_restore`/`sha256sum` |
| 5 | `pg_dump` thất bại |
| 6 | kiểm chứng khôi phục thất bại |
| 7 | upload lên kho ngoài thất bại |

Mọi mã khác 0 **phải** kích hoạt cảnh báo. Backup hỏng âm thầm là tình huống tệ
nhất: tưởng có backup mà thật ra không.
