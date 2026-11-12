#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$project_dir/logs" "$HOME/.config/systemd/user"
cp "$project_dir/deploy/nickyoung.service" "$HOME/.config/systemd/user/nickyoung.service"
systemctl --user daemon-reload
systemctl --user enable --now nickyoung.service
systemctl --user status nickyoung.service --no-pager
