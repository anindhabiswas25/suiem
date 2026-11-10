import { Inject, Injectable } from "@nestjs/common";
import { type DbHandle, schema } from "@suiem/db";
import { newId } from "@suiem/shared/ids";
import { redact } from "../observability/redact";
import { DB } from "../tokens";

export interface AuditEntry {
  actorType: "user" | "admin" | "system" | "anonymous";
  actorUserId?: string | null;
  action: string;
  outcome: "success" | "denied" | "error";
  targetType?: string;
  targetId?: string;
  requestId?: string;
  details?: Record<string, unknown>;
}

/** Append-only audit trail. Details use the same allowlist redaction as logs. */
@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: DbHandle) {}

  async write(entry: AuditEntry): Promise<void> {
    await this.db.db.insert(schema.auditLogs).values({
      id: newId(),
      actorType: entry.actorType,
      actorUserId: entry.actorUserId ?? null,
      action: entry.action,
      outcome: entry.outcome,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      requestId: entry.requestId ?? null,
      details: (redact(entry.details ?? {}) as Record<string, unknown>) ?? {},
    });
  }
}
