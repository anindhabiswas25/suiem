import { Inject, Injectable } from "@nestjs/common";
import { schema } from "@suiem/db";
import { newId } from "@suiem/shared/ids";
import type { SystemDb } from "../infra/system-db";
import { redact } from "../observability/redact";
import { SYSTEM_DB } from "../tokens";

export interface AuditEntry {
  actorType: "user" | "admin" | "system" | "anonymous";
  actorUserId?: string | null;
  action: string;
  outcome: "success" | "denied" | "error";
  targetType?: string;
  targetId?: string;
  reasonCode?: string;
  requestId?: string;
  details?: Record<string, unknown>;
}

/** Immutable audit trail (append-only table). Details are redacted with the same allowlist as logs. */
@Injectable()
export class AuditService {
  constructor(@Inject(SYSTEM_DB) private readonly db: SystemDb) {}

  async write(entry: AuditEntry): Promise<void> {
    await this.db.db.insert(schema.auditLogs).values({
      id: newId(),
      actorType: entry.actorType,
      actorUserId: entry.actorUserId ?? null,
      action: entry.action,
      outcome: entry.outcome,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      reasonCode: entry.reasonCode ?? null,
      requestId: entry.requestId ?? null,
      details: (redact(entry.details ?? {}) as Record<string, unknown>) ?? {},
    });
  }
}
