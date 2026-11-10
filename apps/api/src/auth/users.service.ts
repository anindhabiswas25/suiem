import { Inject, Injectable } from "@nestjs/common";
import { schema } from "@suiem/db";
import { newId } from "@suiem/shared/ids";
import { eq } from "drizzle-orm";
import type { SystemDb } from "../infra/system-db";
import { SYSTEM_DB } from "../tokens";

/** Account provisioning happens before a user context exists, so it uses the system role. */
@Injectable()
export class UsersService {
  constructor(@Inject(SYSTEM_DB) private readonly db: SystemDb) {}

  async findByEmail(email: string): Promise<{ id: string; status: string } | undefined> {
    const rows = await this.db.db.select({ id: schema.users.id, status: schema.users.status }).from(schema.users).where(eq(schema.users.email, email)).limit(1);
    return rows[0];
  }

  /** Creates the user, email auth method, empty profile and preferences atomically. */
  async create(email: string): Promise<string> {
    const id = newId();
    await this.db.db.transaction(async (tx) => {
      await tx.insert(schema.users).values({ id, email });
      await tx.insert(schema.userAuthMethods).values({ id: newId(), userId: id, kind: "email_otp" });
      await tx.insert(schema.profiles).values({ userId: id });
      await tx.insert(schema.userPreferences).values({ userId: id });
    });
    return id;
  }

  async touchEmailMethod(userId: string): Promise<void> {
    await this.db.db.update(schema.userAuthMethods).set({ lastUsedAt: new Date() }).where(eq(schema.userAuthMethods.userId, userId));
  }
}
