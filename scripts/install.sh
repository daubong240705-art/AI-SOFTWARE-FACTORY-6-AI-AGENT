#!/usr/bin/env bash
# shellcheck disable=SC2016,SC2329
set -euo pipefail
umask 077

fail() { printf '%s\n' "$2" >&2; exit "$1"; }
step() { printf '\n[%s/8] %s\n' "$1" "$2"; }
plan() { printf '  %s\n' "$*"; }
swap_app() {
  python3 - "$1" "$2" <<'PY'
import ctypes, os, sys
from pathlib import Path

root = Path(sys.argv[1])
current, other = root / 'app', root / sys.argv[2]
if any(path.is_symlink() or (path.exists() and not path.is_dir()) for path in (current, other)):
    sys.exit('Invalid app directory')
if not other.is_dir():
    sys.exit('No staged or previous app')
if not current.exists():
    other.rename(current)
    sys.exit(0)
libc = ctypes.CDLL(None, use_errno=True)
def exchange(first, second):
    left, right = map(os.fsencode, (first, second))
    if sys.platform == 'darwin':
        result = libc.renamex_np(left, right, 2)
    else:
        result = libc.renameat2(-100, left, -100, right, 2)
    if result != 0:
        raise OSError(ctypes.get_errno(), 'Cannot atomically exchange app directories')

previous = root / 'app.prev'
if previous.is_symlink() or (previous.exists() and not previous.is_dir()):
    sys.exit('Invalid previous app directory')
exchange(current, other)
if other.name == 'app.new':
    try:
        if previous.exists():
            exchange(other, previous)
        else:
            other.rename(previous)
    except OSError:
        exchange(current, other)
        raise
PY
}

if [[ ${1:-} == --internal-rollback && $# == 2 ]]; then
  swap_app "$2" app.prev
  exit
fi

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
prefix=${FACTORY_HOME:-$HOME/.factory}
source_dir=$(dirname -- "$script_dir")
git_url='' ref='' cli=none dry=0 yes=0 no_service=0 start=0 upgrade=0
while (($#)); do
  case $1 in
    --prefix|--source|--git-url|--ref|--with-cli)
      (($# >= 2)) && [[ -n $2 ]] || fail 2 "Thiếu giá trị cho $1"
      case $1 in
        --prefix) prefix=$2;; --source) source_dir=$2;; --git-url) git_url=$2;;
        --ref) ref=$2;; --with-cli) cli=$2;;
      esac
      shift;;
    --no-service) no_service=1;; --start) start=1;; --dry-run) dry=1;; --yes) yes=1;;
    --internal-upgrade) upgrade=1;;
    --help|-h) echo 'Usage: install.sh [--prefix DIR] [--source DIR | --git-url URL] [--ref REF] [--no-service] [--start] [--dry-run] [--yes] [--with-cli codex|claude|none]'; exit 0;;
    *) fail 2 "Tùy chọn không hợp lệ: $1";;
  esac
  shift
done
case $cli in codex|claude|none) ;; *) fail 2 '--with-cli: codex, claude hoặc none';; esac
[[ $ref != -* && $ref != *$'\n'* && $git_url != *$'\n'* ]] || fail 2 'URL hoặc ref không hợp lệ.'
case $git_url in http://*|https://*)
  authority=${git_url#*://}; authority=${authority%%/*}
  [[ $authority != *@* && $git_url != *\?* && $git_url != *\#* ]] || fail 2 'Dùng URL Git không chứa thông tin xác thực.';;
esac

step 1 'Nhận diện nền tảng'
case $(uname -s) in Linux) os=linux;; Darwin) os=darwin;; *) fail 2 'Hệ điều hành không được hỗ trợ.';; esac
case $(uname -m) in x86_64|amd64) arch=x64;; aarch64|arm64) arch=arm64;; *) fail 2 'Kiến trúc không được hỗ trợ.';; esac
if [[ $os == linux ]] && grep -qi microsoft /proc/version; then
  grep -Eqi 'wsl2|microsoft-standard' /proc/sys/kernel/osrelease || fail 2 'WSL1 không được hỗ trợ; hãy chuyển bản phân phối sang WSL2.'
  plan 'WSL2'
fi
if [[ $prefix != /* ]]; then prefix=$PWD/$prefix; fi
if command -v python3 >/dev/null; then
  prefix=$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$prefix")
fi
[[ $prefix != / && $prefix != "$HOME" && $prefix != *$'\n'* && $prefix != *$'\r'* ]] || fail 2 'Thư mục cài đặt không hợp lệ.'
case $prefix in /mnt|/mnt/*|"$HOME/factory-v2"|"$HOME/factory-v2/"*) fail 2 'Không cài dưới /mnt hoặc vào bản cài ~/factory-v2 hiện có.';; esac
[[ $dry == 1 || $(id -u) != 0 ]] || fail 2 'Chạy bộ cài bằng tài khoản thường, không dùng sudo.'
if [[ $os == darwin ]]; then
  manager=brew
  for brew_dir in /opt/homebrew/bin /usr/local/bin; do
    if [[ -x $brew_dir/brew ]]; then export PATH="$brew_dir:$PATH"; break; fi
  done
else
  distro=$(awk -F= '$1=="ID" || $1=="ID_LIKE" {gsub(/"/,"",$2); print $2}' /etc/os-release)
  case " $distro " in
    *ubuntu*|*debian*) manager=apt;; *fedora*|*rhel*|*centos*) manager=dnf;;
    *arch*) manager=pacman;; *suse*) manager=zypper;; *) fail 2 'Bản phân phối Linux không được hỗ trợ.';;
  esac
fi
plan "$os/$arch · $manager · $prefix"

packages() {
  case $manager in
    apt) sudo apt-get update && sudo apt-get install -y "$@";;
    dnf) sudo dnf install -y "$@";;
    pacman) sudo pacman -Syu --noconfirm --needed "$@";;
    zypper) sudo zypper --non-interactive install "$@";;
    brew) brew install "$@";;
  esac
}
installed() {
  case $manager in
    apt) [[ $(dpkg-query -W -f='${Status}' "$1" 2>/dev/null) == 'install ok installed' ]];;
    dnf|zypper) rpm -q "$1" >/dev/null 2>&1;;
    pacman) pacman -Q "$1" >/dev/null 2>&1;;
    brew) brew list --versions "$1" >/dev/null 2>&1;;
  esac
}

if [[ $upgrade == 0 ]]; then
  step 2 'Kiểm tra và cài gói hệ thống'
  case $manager in
    apt) required=(git curl ca-certificates python3 tar xz-utils make g++ procps);;
    dnf) required=(git curl ca-certificates python3 tar xz make gcc-c++ procps-ng);;
    pacman) required=(git curl ca-certificates python tar xz make gcc procps-ng);;
    zypper) required=(git curl ca-certificates python3 tar xz make gcc-c++ procps);;
    brew) required=(git curl ca-certificates python gnu-tar xz);;
  esac
  if [[ $dry == 1 ]]; then
    plan "Dùng $manager cài các gói còn thiếu: ${required[*]} (Linux: thử bubblewrap)."
    [[ $manager != brew ]] || plan 'Nếu chưa có Homebrew, xem https://brew.sh/; cần Xcode Command Line Tools.'
  elif [[ $manager == brew ]] && ! command -v brew >/dev/null; then
    plan 'Không có Homebrew: bỏ qua cài gói; xem https://brew.sh/ nếu thiếu công cụ.'
  else
    missing=()
    for package in "${required[@]}"; do
      if [[ $package == curl ]] && command -v curl >/dev/null; then continue; fi
      installed "$package" || missing+=("$package")
    done
    if ((${#missing[@]})); then
      if [[ $yes == 0 ]]; then
        printf 'Cài gói còn thiếu (%s)? [y/N] ' "${missing[*]}"
        read -r answer && [[ $answer == [yY] ]] || fail 3 'Đã hủy cài gói.'
      fi
      packages "${missing[@]}" || fail 3 'Không cài được gói hệ thống.'
    fi
    if [[ $os == linux ]] && ! command -v bwrap >/dev/null; then
      packages bubblewrap || plan 'Cảnh báo: không cài được bubblewrap; tiếp tục.'
    fi
  fi
  step 3 'Chọn Node.js 22 hoặc tải bản đã ghim và xác minh SHA-256'
fi

valid_node() { [[ -x $1 ]] && "$1" -e 'const [major,minor]=process.versions.node.split(".").map(Number); process.exit(major === 22 && minor >= 20 ? 0 : 1)' && [[ -x $(dirname -- "$1")/npm ]]; }
if [[ $dry == 0 ]]; then
  for tool in git curl python3 tar make; do command -v "$tool" >/dev/null || fail 3 "Thiếu $tool"; done
  if [[ $os == darwin ]]; then xcode-select -p >/dev/null 2>&1 || fail 3 'Cài công cụ biên dịch bằng xcode-select --install.'; fi
  prefix=$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$prefix")
  case $prefix in /|"$HOME"|/mnt|/mnt/*|"$HOME/factory-v2"|"$HOME/factory-v2/"*) fail 2 'Thư mục cài đặt không an toàn.';; esac
  mkdir -p -- "$prefix" || fail 3 'Không tạo được thư mục cài đặt.'
  mkdir -- "$prefix/.install-lock" 2>/dev/null || fail 4 'Đang cài hoặc còn khóa .install-lock từ lần cài trước.'
  work=
  cleanup() { if [[ -n $work ]]; then rm -rf -- "$work"; fi; rmdir -- "$prefix/.install-lock"; }
  trap cleanup EXIT
  trap 'exit 4' HUP INT TERM
  work=$(mktemp -d "$prefix/.install.XXXXXXXX") || fail 3 'Không tạo được thư mục tạm.'
  if [[ $upgrade == 1 ]]; then
    IFS= read -r node_dir < "$prefix/node-path" || fail 3 'Không tìm thấy Node của bản cài.'
    valid_node "$node_dir/node" || fail 3 'Node của bản cài không còn dùng được; chạy lại bộ cài.'
  elif valid_node "$prefix/node/bin/node"; then
    node_dir=$prefix/node/bin
  elif valid_node "$(command -v node || true)"; then
    node_dir=$(cd -- "$(dirname -- "$(command -v node)")" && pwd -P)
  else
    node_pin() {
      local version digest archive
      read -r version digest < <(python3 -c 'import json,sys; lock=json.load(open(sys.argv[1])); print(lock["version"],lock["sha256"][sys.argv[2]])' "$script_dir/lib/node-toolchain.json" "$os-$arch") || return 1
      archive=node-v$version-$os-$arch.tar.xz
      curl -fsSL --retry 2 -o "$work/$archive" "https://nodejs.org/dist/v$version/$archive" || return 1
      python3 -c 'import hashlib,sys; sys.exit(hashlib.sha256(open(sys.argv[1], "rb").read()).hexdigest() != sys.argv[2])' "$work/$archive" "$digest" || return 1
      mkdir "$work/node" && tar -xJf "$work/$archive" -C "$work/node" --strip-components=1 &&
        valid_node "$work/node/bin/node" && rm -rf -- "$prefix/node" && mv -- "$work/node" "$prefix/node"
    }
    node_pin || fail 3 'Không tải, xác minh hoặc giải nén được Node.js đã ghim.'
    node_dir=$prefix/node/bin
  fi
  export PATH="$node_dir:$PATH"
  plan "Node.js $(node --version) ($node_dir)"
else
  if valid_node "$(command -v node || true)"; then plan "Dùng Node.js $(node --version) sẵn có (ưu tiên Node đã cài trong prefix)."
  else plan 'Tải Node theo scripts/lib/node-toolchain.json, xác minh SHA-256, giải nén vào node/.'; fi
fi

step 4 'Chuẩn bị mã nguồn; cài phụ thuộc và build contracts → Host → UI'
if [[ $dry == 1 ]]; then
  if [[ -n $git_url ]]; then plan 'Clone URL Git vào thư mục tạm (không in URL).'; else plan "Dùng checkout $source_dir (không sửa checkout)."; fi
  [[ -z $ref ]] || plan "Chọn ref $ref trong checkout tạm."
  plan 'npm ci --no-audit --no-fund và npm run build cho từng gói; chạy install scripts của Host.'
else
  checkout=$source_dir
  if [[ -n $git_url || -n $ref ]]; then
    checkout=$work/checkout
    git clone --quiet --no-checkout -- "${git_url:-$source_dir}" "$checkout" || fail 4 'Không clone được mã nguồn.'
    git -C "$checkout" checkout --quiet --detach "${ref:-HEAD}" || fail 4 'Không checkout được ref.'
  fi
  checkout=$(cd -- "$checkout" && pwd -P) || fail 4 'Không tìm thấy mã nguồn.'
  if [[ -z $git_url ]]; then source_dir=$(cd -- "$source_dir" && pwd -P) || fail 4 'Không tìm thấy checkout.'; fi
  build=$work/build
  stage_source() {
    mkdir "$build" && (cd "$checkout" && tar cf - --exclude=node_modules --exclude=dist --exclude=dist-test --exclude='*.env' --exclude='.env.*' \
      packages/factory-contracts apps/factory-host apps/factory-ui design/factory-v2 packs extensions) | tar xf - -C "$build"
  }
  stage_source || fail 4 'Không chép được mã nguồn vào thư mục build.'
  for package in packages/factory-contracts apps/factory-host apps/factory-ui; do
    flags=()
    [[ $package == apps/factory-host ]] || flags+=(--ignore-scripts)
    (cd "$build/$package" && npm ci --no-audit --no-fund ${flags[@]+"${flags[@]}"} && npm run build) || fail 4 "Build thất bại: $package"
  done
fi

step 5 'Cài phụ thuộc production, ghi VERSION và đổi app nguyên tử (giữ app.prev)'
if [[ $dry == 1 ]]; then
  plan "Chép dist, migrations, workers, config mẫu, packs và extensions vào $prefix/app.new; npm ci --omit=dev; đổi vào app/."
else
  stage_app() {
    local dest=$prefix/app.new
    rm -rf -- "$dest" && mkdir -p "$dest/apps/factory-host" "$dest/apps/factory-ui" "$dest/packages/factory-contracts" || return 1
    (cd "$build/packages/factory-contracts" && cp -R package.json package-lock.json dist "$dest/packages/factory-contracts/") &&
      (cd "$build/apps/factory-host" && cp -R package.json package-lock.json dist migrations workers "$dest/apps/factory-host/") &&
      cp -R "$build/apps/factory-ui/dist" "$dest/apps/factory-ui/" && cp -R "$build/packs" "$build/extensions" "$dest/" || return 1
    if [[ -d $build/apps/factory-host/config ]]; then
      cp -R "$build/apps/factory-host/config" "$dest/apps/factory-host/" || return 1
    fi
    (cd "$dest/packages/factory-contracts" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund) &&
      (cd "$dest/apps/factory-host" && npm ci --omit=dev --no-audit --no-fund) || return 1
    {
      printf 'commit=%s\n' "$(git -C "$checkout" rev-parse HEAD 2>/dev/null || echo unknown)"
      printf 'ref=%s\n' "${ref:-$(git -C "$checkout" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)}"
      printf 'time=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    } > "$dest/VERSION" && printf '%s\n%s\n%s\n' "$source_dir" "$git_url" "$ref" > "$dest/.source" || return 1
    swap_app "$prefix" app.new || return 1
    rm -rf -- "$prefix/app.new"
  }
  stage_app || fail 4 'Không cài được app mới.'
fi
[[ $upgrade == 0 ]] || exit 0

step 6 'Chuẩn bị cấu hình riêng, không ghi đè'
example=$prefix/app/apps/factory-host/config/factory.env.example
config=$prefix/config/factory.env
if [[ $dry == 1 ]]; then plan "Tạo $config (600) nếu chưa có, và các thư mục state/projects/worktrees."; else
  mkdir -p -- "$prefix/config" "$prefix/state" "$prefix/projects" "$prefix/worktrees" "$prefix/logs" "$prefix/run"
  if [[ ! -e $config && ! -L $config ]]; then
    if [[ -f $example ]]; then
      (set -C; cat "$example" > "$config") || fail 4 'Không tạo được cấu hình.'
    else
      printf -v legacy 'FACTORY_STATE_DIR=%s/state\nFACTORY_PROJECTS_ROOT=%s/projects\nFACTORY_WORKTREES_ROOT=%s/worktrees\n' "$prefix" "$prefix" "$prefix"
      (set -C; printf '%s' "$legacy" > "$config") || fail 4 'Không tạo được cấu hình tương thích.'
      plan 'Cảnh báo: checkout chưa có mẫu cấu hình Host; dùng cấu hình tương thích tối thiểu.'
    fi
    plan 'Chạy factory setup để chọn nhà cung cấp model.'
  fi
fi

step 7 'Cài lệnh factory và đăng ký dịch vụ người dùng'
wrapper=$HOME/.local/bin/factory
case $cli in
  codex) plan 'Codex CLI: npm install -g @openai/codex · https://developers.openai.com/codex/cli/';;
  claude) plan 'Claude Code: brew install --cask claude-code (macOS) · https://code.claude.com/docs/en/setup';;
esac
if [[ $dry == 1 ]]; then
  plan "Cài $wrapper, lưu đường dẫn Node và bộ cài để nâng cấp/rollback."
  if [[ $no_service == 0 ]]; then plan 'Render systemd user unit hoặc LaunchAgent; chỉ khởi động với provider hoặc --start.'; fi
else
  mkdir -p -- "$(dirname -- "$wrapper")" "$prefix/installer/lib" "$prefix/installer/service"
  install -m 755 "$script_dir/factory" "$wrapper"
  install -m 755 "$script_dir/install.sh" "$prefix/installer/install.sh"
  cp -- "$script_dir/lib/node-toolchain.json" "$prefix/installer/lib/"
  cp -- "$script_dir/service/"* "$prefix/installer/service/"
  printf '%s\n' "$node_dir" > "$prefix/node-path"
  printf '%s\n' "$prefix" > "$wrapper.home"
  case :$PATH: in *:"${wrapper%/*}":*) ;; *) plan 'Thêm PATH: export PATH="$HOME/.local/bin:$PATH"';; esac
  if FACTORY_HOME=$prefix "$wrapper" __has-provider; then start=1; fi
  if [[ $no_service == 0 ]]; then
    FACTORY_HOME=$prefix "$wrapper" __install-service "$script_dir/service" "$start" || fail 4 'Không đăng ký hoặc khởi động được dịch vụ.'
  fi
fi

step 8 'Chạy doctor và in hướng dẫn tiếp theo'
doctor=0
if [[ $dry == 1 ]]; then plan 'Chạy factory doctor; in hướng dẫn setup và URL.'
elif [[ ! -f $prefix/app/apps/factory-host/dist/cli/factory.js ]]; then echo 'SKIPPED: cli not built'
else FACTORY_HOME=$prefix "$wrapper" doctor || doctor=5
fi
if [[ $dry == 1 ]]; then url=http://127.0.0.1:8787; else url=$(FACTORY_HOME=$prefix "$wrapper" __url); fi
plan "Tiếp theo: factory setup; factory start; mở $url/"
exit "$doctor"
