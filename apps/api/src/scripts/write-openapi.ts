import { writeFileSync } from "node:fs";
import { join } from "node:path";
import "../auth/auth.controller";
import "../me/me.controller";
import "../flags/config.controller";
import "../extension/extension.controller";
import "../research/entities.controller";
import { buildOpenApiDocument } from "../http/openapi";

const out = join(import.meta.dirname, "..", "..", "openapi.json");
writeFileSync(out, `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`);
console.log(`wrote ${out}`);
