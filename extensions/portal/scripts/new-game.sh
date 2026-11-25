#!/usr/bin/env bash
set -euo pipefail

if [[ $# != 1 || ! $1 =~ ^[a-z0-9-]{2,40}$ ]]; then
  printf '%s\n' 'Cách dùng: new-game.sh <tên gồm 2–40 ký tự a-z, 0-9 hoặc dấu gạch ngang>' >&2
  exit 2
fi

root=${FACTORY_PROJECTS_ROOT:?Đặt FACTORY_PROJECTS_ROOT tới thư mục dự án.}
[[ $root == /* && -d $root ]] || { printf '%s\n' 'Thư mục dự án phải tồn tại và có đường dẫn tuyệt đối.' >&2; exit 2; }
starter=${FACTORY_GAME_STARTER:-"$HOME/factory-v2/game-starter"}
destination=${root%/}/$1
mkdir -- "$destination" || exit 1
trap 'rm -rf -- "$destination"' EXIT

# The starter may be a git repository/URL (cloned) or a plain directory (copied without build output and dependencies).
if [[ -d $starter && ! -e $starter/.git ]]; then
  if ! tar -C "$starter" --exclude=./node_modules --exclude=./dist --exclude=./.dev -cf - . | tar -C "$destination" -xf -; then
    printf '%s\n' 'Không sao chép được game starter.' >&2
    exit 1
  fi
elif ! git -c core.hooksPath=/dev/null clone --quiet -- "$starter" "$destination" </dev/null 2>/dev/null; then
  printf '%s\n' 'Không sao chép được game starter.' >&2
  exit 1
fi
rm -rf -- "$destination/.git"
git -C "$destination" init --quiet --initial-branch=main
git -C "$destination" add --all
git -C "$destination" -c core.hooksPath=/dev/null -c commit.gpgsign=false -c user.name=Factory \
  -c user.email=factory@localhost commit --quiet --allow-empty -m 'Initial game starter'
trap - EXIT
printf '%s\n' "$destination"
