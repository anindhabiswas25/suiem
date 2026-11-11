import { seed } from "../seed";

const url = process.env.DATABASE_OWNER_URL;
if (!url) throw new Error("DATABASE_OWNER_URL is required to seed");
const r = await seed(url);
console.log(
  `seed complete: ${r.entities} entities, ${r.instruments} registry instruments (faucet tokens verified; demo tokens active once deployed)`,
);
