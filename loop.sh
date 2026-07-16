#!/usr/bin/env bash

set -euo pipefail

prompt_file="${1:?usage: ./loop.sh <prompt-file> [stop-string] [max-iterations]}"
stop="${2:-DONE}"
max_iterations="${3:-0}"

num_iteration=0

while true; do
  if [ "$max_iterations" -gt 0 ] && [ "$num_iteration" -ge "$max_iterations" ]; then
    break
  fi

  output=$(claude -p "$(cat "$prompt_file")" --permission-mode bypassPermissions 2>&1 | tee /dev/stderr)

  git push origin main || git push -u origin main

  echo "$output" | grep -q "$stop" && break

  num_iteration=$((num_iteration + 1))
done
