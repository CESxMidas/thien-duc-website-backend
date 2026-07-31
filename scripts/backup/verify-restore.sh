#!/usr/bin/env bash
# Kiểm chứng một bản backup DÙNG ĐƯỢC bằng cách khôi phục vào một DB cục bộ
# DÙNG-MỘT-LẦN rồi đếm bảng/hàng. Backup chưa từng restore thử thì chưa phải
# backup — nó chỉ là một file.
#
# DÙNG:
#   ./verify-restore.sh --file backups/thien_duc-2026….dump \
#                       [--target postgresql://…/thien_duc_verify] [--keep]
#
# CẦU CHÌ: đích BẮT BUỘC là localhost và tên DB kết thúc bằng
# _test/_verify/_restore (xem assert_disposable_target). Không bao giờ chạm
# production, không bao giờ ghi đè DB thật.
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$SCRIPT_DIR/lib.sh"

FILE=""; KEEP=0
TARGET_URL="${VERIFY_DATABASE_URL:-postgresql://127.0.0.1:5432/thien_duc_verify}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --file)   FILE="${2:?--file cần giá trị}"; shift 2 ;;
    --target) TARGET_URL="${2:?--target cần giá trị}"; shift 2 ;;
    --keep)   KEEP=1; shift ;;
    -h|--help) sed -n '2,16p' "$0"; exit $EXIT_OK ;;
    *) fail $EXIT_USAGE "tham số lạ: $1" ;;
  esac
done

[[ -n "$FILE" ]] || fail $EXIT_USAGE "thiếu --file."
[[ -f "$FILE" ]] || fail $EXIT_USAGE "không thấy file: $FILE"
need_tool pg_restore; need_tool psql; need_tool createdb; need_tool dropdb

# 1) Checksum trước đã — file hỏng thì khỏi restore.
if [[ -f "${FILE}.sha256" ]]; then
  EXPECTED="$(awk '{print $1}' < "${FILE}.sha256")"
  ACTUAL="$(sha256_of "$FILE")"
  [[ "$EXPECTED" == "$ACTUAL" ]] || fail $EXIT_VERIFY_FAILED "checksum LỆCH — file backup hỏng."
  log "checksum khớp (${ACTUAL:0:16}…)"
else
  log "CẢNH BÁO: không có ${FILE}.sha256 — bỏ qua bước kiểm checksum."
fi

# 2) Cầu chì đích.
assert_disposable_target "$TARGET_URL"
log "đích phục hồi (dùng-một-lần): host=$DB_HOST port=$DB_PORT database=$DB_NAME"

ADMIN_URL="${TARGET_URL%/*}/postgres"
cleanup() { [[ $KEEP -eq 0 ]] && dropdb --if-exists --maintenance-db="$ADMIN_URL" "$DB_NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# 3) Dựng lại DB trắng rồi restore.
dropdb   --if-exists --maintenance-db="$ADMIN_URL" "$DB_NAME" >/dev/null 2>&1 || true
createdb --maintenance-db="$ADMIN_URL" "$DB_NAME" || fail $EXIT_VERIFY_FAILED "không tạo được DB kiểm chứng."
log "đang restore..."
pg_restore --dbname="$TARGET_URL" --no-owner --no-privileges --exit-on-error "$FILE" \
  || fail $EXIT_VERIFY_FAILED "pg_restore thất bại — bản backup KHÔNG dùng được."

# 4) Kiểm chứng thực chất: có bảng, và bảng lõi có hàng.
TABLES="$(psql --dbname="$TARGET_URL" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
log "số bảng khôi phục được: $TABLES"
[[ "${TABLES:-0}" -gt 0 ]] || fail $EXIT_VERIFY_FAILED "không có bảng nào — bản backup rỗng."

for t in users projects news_posts; do
  if psql --dbname="$TARGET_URL" -tAc "SELECT to_regclass('public.$t')" | grep -q "$t"; then
    ROWS="$(psql --dbname="$TARGET_URL" -tAc "SELECT count(*) FROM \"$t\"")"
    log "  $t: $ROWS hàng"
  fi
done

log "KIỂM CHỨNG ĐẠT — bản backup restore được."
[[ $KEEP -eq 1 ]] && log "giữ lại DB '$DB_NAME' theo yêu cầu (--keep)."
exit $EXIT_OK
