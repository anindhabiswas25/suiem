/**
 * Integration-test infrastructure (Testcontainers): Postgres 16 with the production role model,
 * plus Redis. Migrations and the seed run once. Each test file gets fresh data via unique users.
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { join } from "node:path";
import type { TestProject } from "vitest/node";
import { migrate } from "../../../packages/db/src/migrate";
import { seed } from "../../../packages/db/src/seed";


let pg: StartedPostgreSqlContainer | undefined;
let redis: StartedRedisContainer | undefined;

export async function setup(project: TestProject) {
  [pg, redis] = await Promise.all([
    new PostgreSqlContainer("postgres:16.11-alpine")
      .withDatabase("suiem")
      .withUsername("suiem_owner")
      .withPassword("test_owner")
      .withEnvironment({ SUIEM_APP_PASSWORD: "test_app", SUIEM_SYSTEM_PASSWORD: "test_system" })
      .withCopyFilesToContainer([
        {
          source: join(import.meta.dirname, "..", "..", "..", "infra", "postgres", "init-roles.sh"),
          target: "/docker-entrypoint-initdb.d/10-init-roles.sh",
          mode: 0o755,
        },
      ])
      .start(),
    new RedisContainer("redis:7.4.6-alpine").start(),
  ]);
  const host = pg.getHost();
  const port = pg.getPort();
  const ownerUrl = `postgres://suiem_owner:test_owner@${host}:${port}/suiem`;
  await migrate(ownerUrl);
  await seed(ownerUrl, { devAdmins: true, nodeEnv: "test" });
  project.provide("pgOwnerUrl", ownerUrl);
  project.provide("pgAppUrl", `postgres://suiem_app:test_app@${host}:${port}/suiem`);
  project.provide("pgSystemUrl", `postgres://suiem_system:test_system@${host}:${port}/suiem`);
  project.provide("redisUrl", redis.getConnectionUrl());
}

export async function teardown() {
  await Promise.all([pg?.stop(), redis?.stop()]);
}
