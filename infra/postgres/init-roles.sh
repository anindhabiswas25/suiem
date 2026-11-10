#!/bin/sh
# Creates the least-privilege roles (ARCHITECTURE §6, TM-17). Runs once on first container start.
#   suiem_owner  : schema owner, migrations only (the superuser created by the image).
#   suiem_app    : request-path role; RLS is enforced (NOBYPASSRLS).
#   suiem_system : privileged modules only (auth, admin, flags); BYPASSRLS, no DDL.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE suiem_app LOGIN PASSWORD '${SUIEM_APP_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE suiem_system LOGIN PASSWORD '${SUIEM_SYSTEM_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
REVOKE ALL ON DATABASE ${POSTGRES_DB} FROM PUBLIC;
GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO suiem_app, suiem_system;
SQL
