import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import type { Observable } from "rxjs";
import { ApiError, zodDetails } from "./errors";
import { ROUTE_META, type RouteDef } from "./route";

/** Validates body and query against the route's Zod schemas and replaces them with parsed data. */
@Injectable()
export class ValidationInterceptor implements NestInterceptor {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const route = this.reflector.get<RouteDef | undefined>(ROUTE_META, context.getHandler());
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    if (route?.body) {
      const r = route.body.safeParse(req.body ?? {});
      if (!r.success)
        throw new ApiError("VALIDATION_FAILED", "Invalid request body", zodDetails(r.error));
      req.body = r.data;
    }
    if (route?.query) {
      const r = route.query.safeParse(req.query ?? {});
      if (!r.success) throw new ApiError("VALIDATION_FAILED", "Invalid query", zodDetails(r.error));
      (req as { query: unknown }).query = r.data;
    }
    return next.handle();
  }
}
