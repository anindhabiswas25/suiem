import { seed } from "../seed";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required to seed");
const r = await seed(url);
console.log(
  `seed complete: ${r.entities} entities, ${r.instruments} testnet instruments (unverified addresses)`,
);
