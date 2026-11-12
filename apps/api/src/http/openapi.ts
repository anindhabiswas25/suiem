import { errorEnvelopeSchema } from "@suiem/shared/errors";
import { z } from "zod";
import { ROUTE_REGISTRY } from "./route";

const toSchema = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { target: "openapi-3.0", unrepresentable: "any", io: "input" });

/** OpenAPI 3 document generated from the Zod schemas attached to each @Route. */
export function buildOpenApiDocument(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of ROUTE_REGISTRY) {
    const path = `/api/v1${r.path.replace(/:([A-Za-z]+)/g, "{$1}")}`;
    const params = [...r.path.matchAll(/:([A-Za-z]+)/g)].map((m) => ({
      name: m[1],
      in: "path",
      required: true,
      schema: { type: "string" },
    }));
    const headers =
      r.method !== "GET"
        ? [{ name: "X-CSRF-Token", in: "header", required: true, schema: { type: "string" } }]
        : [];
    const queryParams =
      r.query === undefined
        ? []
        : Object.entries(
            (toSchema(r.query) as { properties?: Record<string, unknown> }).properties ?? {},
          ).map(([name, schema]) => ({
            name,
            in: "query",
            required: false,
            schema,
          }));
    paths[path] ??= {};
    paths[path][r.method.toLowerCase()] = {
      summary: r.summary,
      tags: r.tags,
      "x-suiem-auth": r.auth,
      ...(r.auth === "public" ? { security: [] } : {}),
      parameters: [...params, ...headers, ...queryParams],
      ...(r.body
        ? {
            requestBody: {
              required: true,
              content: { "application/json": { schema: toSchema(r.body) } },
            },
          }
        : {}),
      responses: {
        [String(r.status ?? 200)]: {
          description: "OK",
          ...(r.response
            ? { content: { "application/json": { schema: toSchema(r.response) } } }
            : {}),
        },
        default: {
          description: "Error envelope",
          content: { "application/json": { schema: toSchema(errorEnvelopeSchema) } },
        },
      },
    };
  }
  return {
    openapi: "3.0.3",
    info: {
      title: "Suiem API",
      version: "v1",
      description: "Suiem API. Not affiliated with Robinhood Markets, Inc.",
    },
    servers: [{ url: "/" }],
    components: {
      securitySchemes: { session: { type: "apiKey", in: "cookie", name: "suiem_sid" } },
    },
    security: [{ session: [] }],
    paths,
  };
}
