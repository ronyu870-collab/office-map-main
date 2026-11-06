#!/usr/bin/env bash
set -euo pipefail
# Official PGDG repository, dedicated keyring; never curl a script into a shell.
sudo install -d -m 0755 /usr/share/keyrings
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  -o "$RUNNER_TEMP/backup-pgdg.asc"
gpg --batch --yes --dearmor -o "$RUNNER_TEMP/backup-pgdg.gpg" "$RUNNER_TEMP/backup-pgdg.asc"
sudo install -m 0644 "$RUNNER_TEMP/backup-pgdg.gpg" /usr/share/keyrings/colliers-backup-pgdg.gpg
echo 'deb [signed-by=/usr/share/keyrings/colliers-backup-pgdg.gpg] https://apt.postgresql.org/pub/repos/apt noble-pgdg main' | sudo tee /etc/apt/sources.list.d/colliers-backup-pgdg.list >/dev/null
sudo apt-get update -qq
packages=(postgresql-client-17 age)
case "${1:-client}" in
  client) ;;
  server) packages+=(postgresql-17) ;;
  *) exit 2 ;;
esac
sudo apt-get install -y "${packages[@]}"
