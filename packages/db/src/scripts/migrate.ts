import { migrate } from "../migrate";

const url = process.env.DATABASE_OWNER_URL;
if (!url) throw new Error("DATABASE_OWNER_URL is required to run migrations");
const result = await migrate(url);
console.log(
  `migrations applied: ${result.applied.join(", ") || "none"}; already applied: ${result.skipped.length}`,
);
