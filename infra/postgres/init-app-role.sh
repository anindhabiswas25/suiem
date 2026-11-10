#!/bin/sh
# Local only: give the least-privilege API role a login. Migration 0002 grants its privileges.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE suiem_app LOGIN PASSWORD '${SUIEM_APP_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
SQL
