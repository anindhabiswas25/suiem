// Sets a user's role. The ONLY way to make a moderator: the API role cannot update
// users.role (column privilege, migration 0006) and no endpoint exposes it.
// Usage: pnpm user:role <handle> <user|moderator>
import { newId } from "@suiem/shared/ids";
import pg from "pg";

const [handle, role] = process.argv.slice(2);
if (!handle || (role !== "user" && role !== "moderator")) {
  console.error("Usage: pnpm user:role <handle> <user|moderator>");
  process.exit(2);
}
const url = process.env.DATABASE_OWNER_URL;
if (!url) throw new Error("DATABASE_OWNER_URL is required (owner connection)");
const client = new pg.Client({ connectionString: url, application_name: "suiem-user-role" });
await client.connect();
try {
  const r = await client.query<{ id: string }>(
    "UPDATE users SET role = $2 WHERE handle = $1 RETURNING id",
    [handle, role],
  );
  if (!r.rows[0]) {
    console.error(`No user with handle ${handle}`);
    process.exitCode = 1;
  } else {
    await client.query(
      `INSERT INTO audit_logs (id, actor_type, action, target_type, target_id, outcome, details)
       VALUES ($1, 'admin', 'user.role_changed', 'user', $2, 'success', $3)`,
      [newId(), r.rows[0].id, JSON.stringify({ role })],
    );
    console.log(`${handle} is now ${role}`);
  }
} finally {
  await client.end();
}
