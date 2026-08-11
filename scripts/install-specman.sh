#!/usr/bin/env bash
set -euo pipefail

readonly specman_repo="${SPECMAN_REPO:-https://github.com/marad/specman.git}"
readonly specman_ref="${SPECMAN_REF:-8c9b5fc}"
readonly workspace="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/brulion-specman-${specman_ref}"
readonly source_dir="$workspace/source"
readonly bin_dir="$workspace/bin"
readonly archive_url="${specman_repo%.git}/archive/${specman_ref}.tar.gz"
readonly archive_path="$workspace/specman.tar.gz"

rm -rf "$workspace"
mkdir -p "$bin_dir" "$source_dir"
curl --fail --silent --show-error --location --retry 3 "$archive_url" --output "$archive_path"
tar --extract --gzip --file "$archive_path" --strip-components=1 --directory "$source_dir"

deno_compile_args=(
  compile
  --allow-read
  --allow-write
  --allow-run
  --allow-env
  --include templates
  --output "$bin_dir/specman"
  "$source_dir/cli.ts"
)
# Keep the command explicit rather than relying on a global SpecMan install.
(
  cd "$source_dir"
  deno "${deno_compile_args[@]}"
)

if [[ -n "${GITHUB_PATH:-}" ]]; then
  printf '%s\n' "$bin_dir" >> "$GITHUB_PATH"
else
  printf 'SpecMan installed at %s\n' "$bin_dir/specman"
fi
