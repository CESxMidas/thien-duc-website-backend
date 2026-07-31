#!/usr/bin/env bash
# Tạo một bản backup PostgreSQL: pg_dump định dạng `custom` (nén sẵn, dùng được
# với pg_restore chọn lọc) + file checksum + (tùy chọn) đẩy lên kho ngoài.
#
# DÙNG:
#   DATABASE_URL=... ./backup.sh [--out-dir DIR] [--dry-run]
#
# BIẾN MÔI TRƯỜNG:
#   DATABASE_URL        (bắt buộc) nguồn để dump — CHỈ ĐỌC, script không ghi gì.
#   BACKUP_OUT_DIR      thư mục đích cục bộ (mặc định ./backups)
#   BACKUP_DEST         adapter kho ngoài: none|s3|b2|gcs  (mặc định none)
#   BACKUP_DEST_URI     ví dụ s3://bucket/thien-duc/  — BẮT BUỘC nếu DEST != none
#   BACKUP_ENCRYPT_KEY  (tùy chọn) khóa đối xứng cho gpg; xem ghi chú mã hóa
#
# KHÔNG có credential nào hardcode. Adapter dùng CLI của nhà cung cấp
# (aws/b2/gcloud), vốn tự đọc credential từ môi trường của máy chạy.
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$SCRIPT_DIR/lib.sh"

OUT_DIR="${BACKUP_OUT_DIR:-$SCRIPT_DIR/../../backups}"
DRY_RUN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --out-dir) OUT_DIR="${2:?--out-dir cần giá trị}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit $EXIT_OK ;;
    *) fail $EXIT_USAGE "tham số lạ: $1" ;;
  esac
done

need_tool pg_dump
parse_database_url "${DATABASE_URL:-}"
log "nguồn: host=$DB_HOST port=$DB_PORT database=$DB_NAME"   # KHÔNG in URL đầy đủ

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BASENAME="${DB_NAME}-${STAMP}.dump"
mkdir -p "$OUT_DIR"
TARGET="$OUT_DIR/$BASENAME"
TMP="$(mktemp "${TARGET}.partial.XXXXXX")"
# Dọn file dở kể cả khi lỗi — không để lại bản backup cụt trông như thật.
trap '[[ -f "$TMP" ]] && rm -f "$TMP"' EXIT

if [[ $DRY_RUN -eq 1 ]]; then
  log "DRY-RUN: sẽ chạy pg_dump -Fc -Z6 --no-owner --no-privileges -> $TARGET"
  log "DRY-RUN: sẽ ghi checksum   -> ${TARGET}.sha256"
  [[ "${BACKUP_DEST:-none}" != "none" ]] && log "DRY-RUN: sẽ upload tới ${BACKUP_DEST_URI:-<chưa đặt>} qua adapter ${BACKUP_DEST}"
  log "DRY-RUN: không thực hiện gì cả."
  trap - EXIT; rm -f "$TMP"; exit $EXIT_OK
fi

log "đang dump..."
# -Fc: custom (nén + pg_restore chọn lọc được). -Z6: mức nén cân bằng.
# --no-owner/--no-privileges: khôi phục được sang cluster có role khác.
if ! pg_dump --dbname="$DATABASE_URL" -Fc -Z6 --no-owner --no-privileges --file="$TMP"; then
  fail $EXIT_DUMP_FAILED "pg_dump thất bại."
fi
[[ -s "$TMP" ]] || fail $EXIT_DUMP_FAILED "file dump rỗng."

mv "$TMP" "$TARGET"
trap - EXIT

CHECKSUM="$(sha256_of "$TARGET")"
printf '%s  %s\n' "$CHECKSUM" "$BASENAME" > "${TARGET}.sha256"
SIZE="$(wc -c < "$TARGET" | tr -d ' ')"
log "xong: $BASENAME (${SIZE} byte) sha256=${CHECKSUM:0:16}…"

# --- Mã hóa (tùy chọn) ------------------------------------------------------
# Kho ngoài nằm ngoài tầm kiểm soát của dự án ⇒ backup chứa dữ liệu cá nhân
# (email liên hệ) NÊN được mã hóa trước khi rời máy. Nếu không đặt
# BACKUP_ENCRYPT_KEY thì script vẫn chạy nhưng CẢNH BÁO rõ ràng.
if [[ -n "${BACKUP_ENCRYPT_KEY:-}" ]]; then
  need_tool gpg
  log "đang mã hóa (gpg AES256)..."
  printf '%s' "$BACKUP_ENCRYPT_KEY" | gpg --batch --yes --passphrase-fd 0 \
      --symmetric --cipher-algo AES256 --output "${TARGET}.gpg" "$TARGET"
  rm -f "$TARGET"                       # chỉ giữ bản đã mã hóa
  TARGET="${TARGET}.gpg"
  CHECKSUM="$(sha256_of "$TARGET")"
  printf '%s  %s\n' "$CHECKSUM" "$(basename "$TARGET")" > "${TARGET}.sha256"
  log "đã mã hóa: $(basename "$TARGET")"
else
  log "CẢNH BÁO: chưa đặt BACKUP_ENCRYPT_KEY — bản backup KHÔNG được mã hóa."
  log "CẢNH BÁO: chỉ chấp nhận điều này khi đích lưu trữ là ổ đĩa riêng tư cục bộ."
fi

# --- Đẩy lên kho ngoài (adapter) -------------------------------------------
DEST="${BACKUP_DEST:-none}"
if [[ "$DEST" == "none" ]]; then
  log "BACKUP_DEST=none — giữ cục bộ, không upload."
  exit $EXIT_OK
fi
[[ -n "${BACKUP_DEST_URI:-}" ]] || fail $EXIT_USAGE "BACKUP_DEST=$DEST nhưng thiếu BACKUP_DEST_URI."

upload() {
  case "$DEST" in
    s3)  need_tool aws;    aws s3 cp "$1" "${BACKUP_DEST_URI%/}/$(basename "$1")" ;;
    b2)  need_tool b2;     b2 file upload "${BACKUP_DEST_URI}" "$1" "$(basename "$1")" ;;
    gcs) need_tool gcloud; gcloud storage cp "$1" "${BACKUP_DEST_URI%/}/$(basename "$1")" ;;
    *)   fail $EXIT_USAGE "adapter không hỗ trợ: $DEST (dùng none|s3|b2|gcs)" ;;
  esac
}

log "đang upload qua adapter '$DEST'..."
upload "$TARGET"          || fail $EXIT_UPLOAD_FAILED "upload file backup thất bại."
upload "${TARGET}.sha256" || fail $EXIT_UPLOAD_FAILED "upload file checksum thất bại."
log "upload xong."
