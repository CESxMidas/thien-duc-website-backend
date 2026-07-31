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

# sha256 khả chuyển (Linux: sha256sum, macOS: shasum -a 256)
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}';
  elif command -v shasum   >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}';
  else fail $EXIT_TOOL_MISSING "cần sha256sum hoặc shasum."; fi
}
