#!/usr/bin/env bash
# Dọn backup cũ theo chính sách giữ (retention). Mặc định CHỈ liệt kê; phải
# truyền --apply mới thực sự xóa — xóa nhầm backup là mất dữ liệu vĩnh viễn.
#
# DÙNG:  ./prune.sh [--dir DIR] [--keep-days N] [--keep-min N] [--apply]
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$SCRIPT_DIR/lib.sh"

DIR="${BACKUP_OUT_DIR:-$SCRIPT_DIR/../../backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
KEEP_MIN="${BACKUP_KEEP_MIN:-7}"     # luôn giữ ít nhất N bản mới nhất
APPLY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir)       DIR="${2:?}"; shift 2 ;;
    --keep-days) KEEP_DAYS="${2:?}"; shift 2 ;;
    --keep-min)  KEEP_MIN="${2:?}"; shift 2 ;;
    --apply)     APPLY=1; shift ;;
    -h|--help)   sed -n '2,8p' "$0"; exit $EXIT_OK ;;
    *) fail $EXIT_USAGE "tham số lạ: $1" ;;
  esac
done

[[ -d "$DIR" ]] || { log "chưa có thư mục backup ($DIR) — không có gì để dọn."; exit $EXIT_OK; }

mapfile -t ALL < <(find "$DIR" -maxdepth 1 -type f \( -name '*.dump' -o -name '*.dump.gpg' \) -printf '%T@ %p\n' 2>/dev/null | sort -rn | awk '{print $2}')
TOTAL=${#ALL[@]}
log "tìm thấy $TOTAL bản backup ở $DIR (giữ ≥ $KEEP_MIN bản mới nhất, xóa bản cũ hơn $KEEP_DAYS ngày)"
(( TOTAL == 0 )) && exit $EXIT_OK

REMOVED=0
for i in "${!ALL[@]}"; do
  f="${ALL[$i]}"
  # Luôn giữ KEEP_MIN bản mới nhất bất kể tuổi — thà thừa còn hơn trắng tay.
  (( i < KEEP_MIN )) && continue
  if [[ -n "$(find "$f" -mtime "+$KEEP_DAYS" 2>/dev/null)" ]]; then
    if (( APPLY )); then
      rm -f "$f" "${f}.sha256"; log "đã xóa: $(basename "$f")"
    else
      log "SẼ XÓA (chạy lại với --apply): $(basename "$f")"
    fi
    (( REMOVED++ )) || true
  fi
done
if (( APPLY )); then
  log "tổng cộng $REMOVED bản đã xóa."
else
  log "tổng cộng $REMOVED bản thuộc diện xóa — CHƯA áp dụng (thiếu --apply)."
fi
exit $EXIT_OK
