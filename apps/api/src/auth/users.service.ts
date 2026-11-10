import { Inject, Injectable } from "@nestjs/common";
import { type DbHandle, schema, type Tx } from "@suiem/db";
import { newId } from "@suiem/shared/ids";
import { randomBytes } from "node:crypto";
import { DB } from "../tokens";

/** Account provisioning: user + empty preferences + private-by-default profile, atomically. */
@Injectable()
export class UsersService {
  constructor(@Inject(DB) private readonly db: DbHandle) {}

  newHandle(): string {
    return `user_${randomBytes(4).toString("hex")}`;
  }

  async createInTx(
    tx: Tx,
    id: string = newId(),
    handle: string = this.newHandle(),
  ): Promise<string> {
    await tx.insert(schema.users).values({ id, handle });
    await tx.insert(schema.userPreferences).values({ userId: id });
    await tx.insert(schema.profiles).values({ userId: id });
    return id;
  }
}
