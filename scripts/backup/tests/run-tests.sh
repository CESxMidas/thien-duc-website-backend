#!/usr/bin/env bash
# Test an toàn cho bộ script backup — CHẠY ĐƯỢC MÀ KHÔNG CẦN POSTGRESQL.
#
# Vì sao không cần DB: mọi thứ được kiểm ở đây là **cầu chì** — thứ phải chặn
# TRƯỚC khi script kịp chạm vào bất kỳ database nào. Nếu một cầu chì chỉ hỏng
# lúc có DB thật thì nó đã hỏng quá muộn.
#
# KHÔNG kiểm ở đây (cần PostgreSQL, xem tài liệu backup-and-restore §diễn tập):
#   * dump thật / restore thật / đếm bảng sau restore.
#
# DÙNG:  ./scripts/backup/tests/run-tests.sh
# THOÁT: 0 = tất cả đạt, 1 = có test hỏng.
set -Eeuo pipefail

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="$(cd "$TESTS_DIR/.." && pwd)"

PASS=0; FAIL=0
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

ok()   { PASS=$((PASS+1)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  \033[31m✗\033[0m %s\n     %s\n' "$1" "$2"; }

# Chạy một script, bắt mã thoát + output (stdout+stderr gộp).
# KHÔNG dùng `set -e` ở đây để còn đọc được mã thoát.
run() {
  set +e
  OUT="$("$@" 2>&1)"; CODE=$?
  set -e
}

# Khẳng định mã thoát.
expect_code() {
  local want=$1 name=$2
  if [[ $CODE -eq $want ]]; then ok "$name"
  else bad "$name" "mong mã thoát $want, nhận $CODE. Output: ${OUT:0:200}"; fi
}

expect_contains() {
  local needle=$1 name=$2
  if [[ "$OUT" == *"$needle"* ]]; then ok "$name"
  else bad "$name" "không thấy '$needle' trong output: ${OUT:0:200}"; fi
}

expect_not_contains() {
  local needle=$1 name=$2
  if [[ "$OUT" != *"$needle"* ]]; then ok "$name"
  else bad "$name" "KHÔNG được lộ '$needle' nhưng output có: ${OUT:0:200}"; fi
}

echo "== 1. Thiếu biến môi trường bắt buộc → fail closed (mã 2) =="

run env -u DATABASE_URL bash "$BACKUP_DIR/backup.sh" --dry-run
expect_code 2 "backup.sh không có DATABASE_URL → EXIT_USAGE"

run bash "$BACKUP_DIR/verify-restore.sh"
expect_code 2 "verify-restore.sh không có --file → EXIT_USAGE"

run bash "$BACKUP_DIR/verify-restore.sh" --file "$WORK/khong-ton-tai.dump"
expect_code 2 "verify-restore.sh file không tồn tại → EXIT_USAGE"

echo "== 2. Cầu chì đích không an toàn (mã 3) =="
# Các test này phải chặn TRƯỚC khi cần pg_restore, nên chạy được không cần DB.

FAKE_DUMP="$WORK/fake.dump"
printf 'khong-phai-dump-that' > "$FAKE_DUMP"

run bash "$BACKUP_DIR/verify-restore.sh" --file "$FAKE_DUMP" \
    --target "postgresql://db.example.com:5432/thien_duc_verify"
expect_code 3 "host không phải localhost → EXIT_UNSAFE_TARGET"

run bash "$BACKUP_DIR/verify-restore.sh" --file "$FAKE_DUMP" \
    --target "postgresql://127.0.0.1:5432/thien_duc_production"
expect_code 3 "tên DB giống production → EXIT_UNSAFE_TARGET"

run bash "$BACKUP_DIR/verify-restore.sh" --file "$FAKE_DUMP" \
    --target "postgresql://user:pw@dpg-abc.oregon-postgres.render.com:5432/thien_duc_verify"
expect_code 3 "host render.com → EXIT_UNSAFE_TARGET"

run bash "$BACKUP_DIR/verify-restore.sh" --file "$FAKE_DUMP" \
    --target "postgresql://127.0.0.1:5432/thien_duc"
expect_code 3 "tên DB không có đuôi _test/_verify/_restore → EXIT_UNSAFE_TARGET"

echo "== 3. Không bao giờ lộ credential ra log =="

SECRET="sieu-mat-khau-khong-duoc-lo"
run bash "$BACKUP_DIR/verify-restore.sh" --file "$FAKE_DUMP" \
    --target "postgresql://admin:${SECRET}@evil.example.com:5432/thien_duc_verify"
expect_not_contains "$SECRET" "mật khẩu KHÔNG xuất hiện trong thông báo lỗi"

run env DATABASE_URL="postgresql://admin:${SECRET}@127.0.0.1:5432/thien_duc_test" \
    bash "$BACKUP_DIR/backup.sh" --dry-run --out-dir "$WORK/out"
expect_not_contains "$SECRET" "backup.sh --dry-run KHÔNG in mật khẩu"
expect_code 0 "backup.sh --dry-run thoát 0 mà không chạm DB"

echo "== 4. Checksum lệch → từ chối restore (mã 6) =="

printf 'noi-dung-gia' > "$WORK/co-checksum.dump"
printf 'deadbeef  co-checksum.dump\n' > "$WORK/co-checksum.dump.sha256"
run bash "$BACKUP_DIR/verify-restore.sh" --file "$WORK/co-checksum.dump" \
    --target "postgresql://127.0.0.1:5432/thien_duc_verify"
expect_code 6 "checksum LỆCH → EXIT_VERIFY_FAILED, dừng trước khi restore"

echo "== 5. Adapter upload trung lập nhà cung cấp =="

# shellcheck source=../lib.sh
source "$BACKUP_DIR/lib.sh"
UP_FILE="$WORK/upload-me.txt"; printf 'noi-dung' > "$UP_FILE"

run_upload_adapter_capture() {
  set +e
  OUT="$(run_upload_adapter "$1" 2>&1)"; CODE=$?
  set -e
}

# 5a. Tắt: không đặt BACKUP_UPLOAD_COMMAND → bỏ qua, KHÔNG lỗi.
( unset BACKUP_UPLOAD_COMMAND BACKUP_REMOTE_PREFIX
  run_upload_adapter_capture "$UP_FILE"
  [[ $CODE -eq 0 && "$OUT" == *"giữ cục bộ"* ]] ) \
  && ok "adapter TẮT → bỏ qua, thoát 0" \
  || bad "adapter TẮT" "phải bỏ qua êm và thoát 0"

# 5b. Dry-run: in lệnh, KHÔNG thực thi.
MARKER="$WORK/khong-duoc-tao"
( export BACKUP_UPLOAD_COMMAND="touch $MARKER # {file} {remote}"
  export BACKUP_REMOTE_PREFIX="s3://khong-co-that/thien-duc/"
  export BACKUP_UPLOAD_DRY_RUN=1
  run_upload_adapter_capture "$UP_FILE"
  [[ $CODE -eq 0 && "$OUT" == *"DRY-RUN upload"* && ! -f "$MARKER" ]] ) \
  && ok "adapter DRY-RUN → chỉ in lệnh, KHÔNG thực thi" \
  || bad "adapter DRY-RUN" "phải in lệnh mà không chạy (marker không được tạo)"

# 5c. Thiếu prefix nhưng có command → fail closed.
( export BACKUP_UPLOAD_COMMAND="true"
  unset BACKUP_REMOTE_PREFIX
  run_upload_adapter_capture "$UP_FILE"
  [[ $CODE -eq 2 ]] ) \
  && ok "có COMMAND mà thiếu REMOTE_PREFIX → EXIT_USAGE" \
  || bad "thiếu REMOTE_PREFIX" "phải thoát 2"

# 5d. Lệnh upload hỏng → LAN TRUYỀN lỗi (không nuốt).
( export BACKUP_UPLOAD_COMMAND="false"
  export BACKUP_REMOTE_PREFIX="s3://khong-co-that/"
  export BACKUP_UPLOAD_DRY_RUN=0
  run_upload_adapter_capture "$UP_FILE"
  [[ $CODE -ne 0 ]] ) \
  && ok "lệnh upload hỏng → trả mã khác 0 (lan truyền)" \
  || bad "upload hỏng" "phải trả mã khác 0"

# 5e. Thành công cục bộ (cp sang thư mục khác — KHÔNG ra mạng).
( export BACKUP_UPLOAD_COMMAND="cp {file} $WORK/da-upload.txt"
  export BACKUP_REMOTE_PREFIX="file://$WORK/"
  export BACKUP_UPLOAD_DRY_RUN=0
  run_upload_adapter_capture "$UP_FILE"
  [[ $CODE -eq 0 && -f "$WORK/da-upload.txt" ]] ) \
  && ok "adapter chạy thật (cục bộ) → thoát 0, file tới đích" \
  || bad "adapter thành công" "phải copy được file và thoát 0"

echo "== 6. Tên DB dùng-một-lần là DUY NHẤT =="

N1="$(unique_disposable_db_name thien_duc)"
sleep 1
N2="$(unique_disposable_db_name thien_duc)"
[[ "$N1" != "$N2" ]] && ok "hai lần gọi sinh hai tên khác nhau" \
                     || bad "tên DB duy nhất" "hai lần gọi trùng nhau: $N1"
[[ "$N1" == *_verify ]] && ok "tên vẫn giữ đuôi _verify (cầu chì còn tác dụng)" \
                        || bad "đuôi tên DB" "phải kết thúc _verify, nhận $N1"

URL_MOI="$(replace_db_name_in_url "postgresql://127.0.0.1:5432/thien_duc_verify" "$N1")"
[[ "$URL_MOI" == "postgresql://127.0.0.1:5432/$N1" ]] \
  && ok "replace_db_name_in_url giữ nguyên host/port" \
  || bad "replace_db_name_in_url" "nhận $URL_MOI"

echo "== 7. Retention dry-run KHÔNG xoá gì =="

KEEP_DIR="$WORK/retention"; mkdir -p "$KEEP_DIR"
for i in 1 2 3; do printf 'x' > "$KEEP_DIR/thien_duc-2020010${i}T000000Z.dump"; done
BEFORE="$(find "$KEEP_DIR" -name '*.dump' | wc -l)"
run env BACKUP_OUT_DIR="$KEEP_DIR" BACKUP_KEEP_DAYS=0 BACKUP_KEEP_MIN=0 \
    bash "$BACKUP_DIR/prune.sh"
AFTER="$(find "$KEEP_DIR" -name '*.dump' | wc -l)"
if [[ "$BEFORE" -eq "$AFTER" ]]; then ok "prune.sh mặc định chỉ LIỆT KÊ, không xoá ($AFTER/$BEFORE còn nguyên)"
else bad "prune dry-run" "đã xoá file khi chưa có --apply: $BEFORE -> $AFTER"; fi

echo
printf 'Kết quả: \033[32m%d đạt\033[0m, \033[31m%d hỏng\033[0m\n' "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
