import { seed } from "../seed";

const url = process.env.DATABASE_OWNER_URL;
if (!url) throw new Error("DATABASE_OWNER_URL is required to seed");
const nodeEnv = process.env.NODE_ENV ?? "development";
await seed(url, { devAdmins: nodeEnv !== "production", nodeEnv });
console.log(`seed complete (dev admins: ${nodeEnv !== "production"})`);
