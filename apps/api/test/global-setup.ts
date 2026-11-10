/**
 * Integration-test infrastructure (Testcontainers): Postgres 16 and Redis. Migrations and the
 * seed run once; tests create their own users so they never depend on each other.
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import type { TestProject } from "vitest/node";
import { migrate } from "../../../packages/db/src/migrate";
import { seed } from "../../../packages/db/src/seed";

let pg: StartedPostgreSqlContainer | undefined;
let redis: StartedRedisContainer | undefined;

export async function setup(project: TestProject) {
  [pg, redis] = await Promise.all([
    new PostgreSqlContainer("postgres:16.11-alpine")
      .withDatabase("suiem")
      .withUsername("suiem")
      .withPassword("test")
      .start(),
    new RedisContainer("redis:7.4.6-alpine").start(),
  ]);
  const url = pg.getConnectionUri();
  await migrate(url);
  await seed(url);
  project.provide("pgUrl", url);
  project.provide("redisUrl", redis.getConnectionUrl());
}

export async function teardown() {
  await Promise.all([pg?.stop(), redis?.stop()]);
}
