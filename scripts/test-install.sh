#!/usr/bin/env bash
# shellcheck disable=SC2016,SC2329
set -euo pipefail
umask 077
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
distros=ubuntu:24.04,debian:12,fedora:41,archlinux:latest
keep=0 with_model=0
while (($#)); do
  case $1 in
    --distros) (($# >= 2)) && [[ -n $2 ]] || exit 2; distros=$2; shift;;
    --keep) keep=1;;
    --with-model) with_model=1;;
    --help) echo 'Usage: scripts/test-install.sh [--distros ubuntu:24.04,debian:12,fedora:41,archlinux:latest] [--keep] [--with-model]'; exit 0;;
    *) echo "Unknown option: $1" >&2; exit 2;;
  esac
  shift
done
IFS=, read -r -a bases <<< "$distros"
steps=(image source install doctor start health smoke stop upgrade restart persist model)
printf '%-22s' Distro; printf ' %8s' "${steps[@]}"; echo
failed=0 container='' image=''
nonce=$(date +%s)-$RANDOM-$RANDOM
cleanup() {
  if [[ $keep == 0 ]]; then
    if [[ -n $container ]]; then docker rm -f "$container" >/dev/null 2>&1 || true; fi
    if [[ -n $image ]]; then docker image rm "$image" >/dev/null 2>&1 || true; fi
  elif [[ -n $container ]]; then printf 'Kept container %s (%s)\n' "$container" "$image" >&2; fi
  container='' image=''
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
run_step() {
  local name=$1 status=0 output
  shift
  if [[ $blocked == 1 ]]; then row+=(SKIP); return; fi
  output=$("$@" 2>&1) || status=$?
  if [[ $status == 0 && $output == *'SKIPPED: cli not built'* && ( $name == doctor || $name == model ) ]]; then
    printf '[%s] %s: SKIPPED: cli not built\n' "$base" "$name" >&2; row+=(SKIP)
  elif [[ $status == 0 && $output == *SKIPPED:* && $name == model ]]; then
    printf '[%s] %s: %s\n' "$base" "$name" "$output" >&2; row+=(SKIP)
  elif [[ $status == 0 ]]; then row+=(PASS)
  else
    printf '[%s] %s failed (exit %s); last 150 lines:\n' "$base" "$name" "$status" >&2
    printf '%s\n' "$output" | tail -n 150 >&2
    if [[ -n $container ]]; then docker exec "$container" sh -c 'tail -n 150 "$HOME/.factory/logs/host.log" 2>/dev/null' >&2 || true; fi
    row+=(FAIL); blocked=1; failed=1
  fi
}
build_image() {
  docker build --build-arg "BASE=$base" --build-arg "UBUNTU_MIRROR=${FACTORY_TEST_UBUNTU_MIRROR:-}" \
    --build-arg "ARCH_MIRROR=${FACTORY_TEST_ARCH_MIRROR:-}" -t "$image" - < scripts/test-install/Dockerfile
}
copy_source() {
  docker run -d --name "$container" "$image" >/dev/null || return
  {
    git ls-files -z --cached -- apps/factory-host apps/factory-ui packages/factory-contracts design/factory-v2 packs
    printf '%s\0' scripts/factory scripts/install.sh scripts/lib/node-toolchain.json scripts/service/factory.service scripts/service/com.factory.host.plist scripts/test-install/smoke.mjs
    git ls-files -z --others --exclude-standard -- apps/factory-host/src/cli apps/factory-host/config/factory.env.example
  } | sort -zu | tar --null -T - -cf - | docker exec -i "$container" tar -xf -
}
inside() { docker exec "$container" "$@"; }
cli_check() {
  inside bash -e -o pipefail -c '
    prefix=$HOME/.factory
    if [[ ! -f $prefix/app/apps/factory-host/dist/cli/factory.js ]]; then echo "SKIPPED: cli not built"; exit; fi
    read -r node_dir < "$prefix/node-path"
    factory doctor --json | "$node_dir/node" scripts/test-install/smoke.mjs doctor
  '
}
smoke() { inside bash -ec 'read -r node_dir < "$HOME/.factory/node-path"; exec "$node_dir/node" scripts/test-install/smoke.mjs "$1"' bash "$1"; }
wait_health() {
  inside bash -ec 'for ((deadline=SECONDS+60; SECONDS<deadline;)); do curl --max-time 1 -fsS http://127.0.0.1:8787/health 2>/dev/null && exit 0; sleep 1; done; exit 1'
}
test_model() {
  if [[ $with_model == 0 ]]; then echo 'SKIPPED: --with-model not requested'; return; fi
  if [[ -z ${FACTORY_TEST_MODEL_BASE_URL:-} || -z ${FACTORY_TEST_MODEL_API_KEY:-} || -z ${FACTORY_TEST_MODEL:-} ]]; then
    echo 'SKIPPED: model environment incomplete'; return
  fi
  docker exec --env FACTORY_TEST_MODEL_BASE_URL --env FACTORY_TEST_MODEL_API_KEY --env FACTORY_TEST_MODEL "$container" bash -ec '
    prefix=$HOME/.factory
    if [[ ! -f $prefix/app/apps/factory-host/dist/cli/factory.js ]]; then echo "SKIPPED: cli not built"; exit; fi
    if ! factory setup --non-interactive --base-url "$FACTORY_TEST_MODEL_BASE_URL" --api-key-env FACTORY_TEST_MODEL_API_KEY \
      --lead-model "$FACTORY_TEST_MODEL" --agent-models "$FACTORY_TEST_MODEL" --port 8787 --listen 127.0.0.1 >/dev/null 2>&1; then
      echo "factory setup failed" >&2; exit 1
    fi
    factory stop
    chmod 600 "$prefix/config/factory.env"
    printf "\nFACTORY_OPEN_LOGIN=1\n" >> "$prefix/config/factory.env"
    factory start
    read -r node_dir < "$prefix/node-path"
    exec "$node_dir/node" scripts/test-install/smoke.mjs model
  '
}
for index in "${!bases[@]}"; do
  base=${bases[$index]}; row=(); blocked=0
  image=factory-install-test:$nonce-$index
  run_step image build_image
  if [[ $blocked == 0 ]]; then container=factory-install-test-$nonce-$index; fi
  run_step source copy_source
  run_step install inside scripts/install.sh --yes --no-service
  run_step doctor cli_check
  run_step start inside bash -ec 'printf "\nFACTORY_OPEN_LOGIN=1\n" >> "$HOME/.factory/config/factory.env"; factory start'
  run_step health wait_health
  run_step smoke smoke create
  run_step stop inside factory stop
  run_step upgrade inside factory upgrade
  run_step restart inside factory start
  run_step persist smoke persist
  run_step model test_model
  printf '%-22s' "$base"; printf ' %8s' "${row[@]}"; echo
  cleanup
done
exit "$failed"
