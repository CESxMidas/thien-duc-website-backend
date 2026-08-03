#!/usr/bin/env bash
# Hàm dùng chung cho bộ script backup off-site (backlog §6).
#
# NGUYÊN TẮC AN TOÀN, áp cho MỌI script trong thư mục này:
#   * KHÔNG BAO GIỜ in `DATABASE_URL` đầy đủ (có mật khẩu) hay bất kỳ credential
#     nào. Chỉ in metadata an toàn: host / port / tên DB.
#   * Thoát bằng mã lỗi rõ ràng (xem bảng EXIT_* bên dưới) để scheduler phân
#     biệt được "không có gì để làm" với "hỏng thật".
#   * Dọn file tạm kể cả khi lỗi (trap EXIT).
#   * KHÔNG tự ghi đè production.

set -Eeuo pipefail

# --- Mã thoát (scheduler/CI dựa vào đây để cảnh báo đúng mức) ---------------
readonly EXIT_OK=0
readonly EXIT_USAGE=2          # thiếu tham số / biến môi trường
readonly EXIT_UNSAFE_TARGET=3  # DB đích không được phép
readonly EXIT_TOOL_MISSING=4   # thiếu pg_dump/pg_restore/sha256sum
readonly EXIT_DUMP_FAILED=5
readonly EXIT_VERIFY_FAILED=6
readonly EXIT_UPLOAD_FAILED=7

log()  { printf '[backup] %s\n' "$*" >&2; }
fail() { local code=$1; shift; printf '[backup][LỖI] %s\n' "$*" >&2; exit "$code"; }

# Che mật khẩu trong URL trước khi in. `postgres://u:p@h:5432/db` -> `postgres://***@h:5432/db`
redact_url() { printf '%s' "$1" | sed -E 's#://[^@/]*@#://***@#'; }

# --- Phân tích DATABASE_URL thành metadata an toàn --------------------------
# Đặt: DB_HOST, DB_PORT, DB_NAME. KHÔNG export mật khẩu ra biến toàn cục.
parse_database_url() {
  local url="${1:-}"
  [[ -n "$url" ]] || fail $EXIT_USAGE "thiếu DATABASE_URL."
  local rest="${url#*://}"
  local hostpart="${rest#*@}"
  DB_HOST="${hostpart%%:*}"
  local portdb="${hostpart#*:}"
  DB_PORT="${portdb%%/*}"
  local namepart="${portdb#*/}"
  DB_NAME="${namepart%%\?*}"
  [[ -n "$DB_HOST" && -n "$DB_NAME" ]] || fail $EXIT_USAGE "DATABASE_URL không phân tích được."
  : "${DB_PORT:=5432}"
}

# --- Cầu chì: chặn thao tác GHI lên đích không an toàn ----------------------
# Dùng cho restore/verify. Chỉ cho phép localhost + tên DB kết thúc bằng
# `_test`/`_verify`/`_restore` — tuyệt đối không cho trỏ vào production.
assert_disposable_target() {
  parse_database_url "$1"
  case "$DB_HOST" in
    localhost|127.0.0.1) ;;
    *) fail $EXIT_UNSAFE_TARGET "đích phục hồi phải là localhost/127.0.0.1, nhận '$DB_HOST'." ;;
  esac
  case "$DB_NAME" in
    *_test|*_verify|*_restore) ;;
    *) fail $EXIT_UNSAFE_TARGET "tên DB phục hồi phải kết thúc bằng _test/_verify/_restore, nhận '$DB_NAME'." ;;
  esac
  if [[ "$1" == *render.com* ]]; then
    fail $EXIT_UNSAFE_TARGET "đích trỏ tới render.com — HỦY, không bao giờ ghi đè production."
  fi
}

need_tool() { command -v "$1" >/dev/null 2>&1 || fail $EXIT_TOOL_MISSING "thiếu lệnh '$1' trong PATH."; }

# --- Tên DB dùng-một-lần, DUY NHẤT mỗi lần chạy ----------------------------
# Tên cố định (`thien_duc_verify`) làm hai lần chạy song song giẫm lên nhau: lần
# sau `dropdb` mất DB lần trước đang restore dở → cả hai cùng sai một cách khó
# hiểu. Thêm hậu tố pid + timestamp để mỗi lần chạy có DB riêng.
#
# Hậu tố GIỮ NGUYÊN đuôi `_verify` để `assert_disposable_target` vẫn chặn được.
unique_disposable_db_name() {
  local base="${1:-thien_duc}"
  printf '%s_%s_%s_verify' "$base" "$(date -u +%Y%m%d%H%M%S)" "$$"
}

# Thay tên database trong một URL, giữ nguyên phần còn lại (host/port/query).
replace_db_name_in_url() {
  local url="$1" newname="$2"
  local prefix="${url%/*}"          # tới trước tên DB
  local tail="${url##*/}"           # tên DB (+ query nếu có)
  local query=""
  [[ "$tail" == *\?* ]] && query="?${tail#*\?}"
  printf '%s/%s%s' "$prefix" "$newname" "$query"
}

# --- Adapter upload TRUNG LẬP NHÀ CUNG CẤP ---------------------------------
# Dự án CHƯA chọn nhà cung cấp kho lưu trữ. Vì vậy đường đi mặc định là một
# lệnh do người vận hành tự khai, không ràng buộc vào AWS/B2/GCS/R2:
#
#   BACKUP_UPLOAD_COMMAND  mẫu lệnh; `{file}` = đường dẫn file cục bộ,
#                          `{remote}` = đích đầy đủ (prefix + tên file).
#   BACKUP_REMOTE_PREFIX   tiền tố đích, ví dụ `s3://bucket/thien-duc/`.
#   BACKUP_UPLOAD_DRY_RUN=1  in ra lệnh SẼ chạy rồi thôi — không upload thật.
#
# Ví dụ (không kích hoạt sẵn):
#   BACKUP_UPLOAD_COMMAND='aws s3 cp {file} {remote}'
#   BACKUP_UPLOAD_COMMAND='rclone copyto {file} {remote}'
#
# Trả 0 khi thành công/bỏ qua, khác 0 khi lệnh upload hỏng — GỌI PHẢI kiểm.
run_upload_adapter() {
  local file="$1"
  [[ -f "$file" ]] || fail $EXIT_USAGE "không thấy file cần upload: $file"

  local cmd="${BACKUP_UPLOAD_COMMAND:-}"
  if [[ -z "$cmd" ]]; then
    log "BACKUP_UPLOAD_COMMAND chưa đặt — giữ cục bộ, KHÔNG upload."
    return 0
  fi
  local prefix="${BACKUP_REMOTE_PREFIX:-}"
  [[ -n "$prefix" ]] || fail $EXIT_USAGE "có BACKUP_UPLOAD_COMMAND nhưng thiếu BACKUP_REMOTE_PREFIX."

  local remote="${prefix%/}/$(basename "$file")"
  # Thay chỗ giữ chỗ. Dùng bash string replace (không eval chuỗi người dùng qua
  # sed) để tránh chèn lệnh qua ký tự đặc biệt trong tên file.
  local rendered="${cmd//\{file\}/$file}"
  rendered="${rendered//\{remote\}/$remote}"

  if [[ "${BACKUP_UPLOAD_DRY_RUN:-0}" == "1" ]]; then
    log "DRY-RUN upload: $rendered"
    return 0
  fi

  log "đang upload: $(basename "$file") -> $remote"
  # `bash -c` vì mẫu lệnh là một dòng shell do người vận hành khai.
  if ! bash -c "$rendered"; then
    return 1     # người gọi quyết định fail — KHÔNG nuốt lỗi.
  fi
  log "upload xong: $(basename "$file")"
  return 0
}

# sha256 khả chuyển (Linux: sha256sum, macOS: shasum -a 256)
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}';
  elif command -v shasum   >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}';
  else fail $EXIT_TOOL_MISSING "cần sha256sum hoặc shasum."; fi
}
