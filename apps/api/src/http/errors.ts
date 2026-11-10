import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Inject } from "@nestjs/common";
import { type ErrorCode, type ErrorEnvelope, HTTP_STATUS_BY_CODE } from "@suiem/shared/errors";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { errorFields } from "../observability/redact";
import { type AppLogger } from "../observability/logger";
import { LOGGER } from "../tokens";

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: { path: string; message: string }[],
    readonly extraHeaders?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
  get status(): number {
    return HTTP_STATUS_BY_CODE[this.code];
  }
}

export function zodDetails(error: ZodError): { path: string; message: string }[] {
  return error.issues.slice(0, 20).map((i) => ({ path: i.path.join(".") || "(root)", message: i.message }));
}

function fromHttpException(e: HttpException): ApiError {
  const status = e.getStatus();
  if (status === 404) return new ApiError("NOT_FOUND", "Not found");
  if (status === 413) return new ApiError("VALIDATION_FAILED", "Request body too large");
  if (status === 415 || status === 400) return new ApiError("VALIDATION_FAILED", "Malformed request");
  if (status === 401) return new ApiError("UNAUTHENTICATED", "Sign in required");
  if (status === 403) return new ApiError("FORBIDDEN", "Forbidden");
  return new ApiError("INTERNAL", "Something went wrong");
}

/** Every error leaves the API as the structured envelope from @suiem/shared/errors. */
@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  constructor(@Inject(LOGGER) private readonly logger: AppLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    let err: ApiError;
    if (exception instanceof ApiError) err = exception;
    else if (exception instanceof ZodError) err = new ApiError("VALIDATION_FAILED", "Invalid request", zodDetails(exception));
    else if (exception instanceof HttpException) err = fromHttpException(exception);
    else if ((exception as { statusCode?: number })?.statusCode === 400 || (exception as { code?: string })?.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") {
      err = new ApiError("VALIDATION_FAILED", "Malformed request");
    } else err = new ApiError("INTERNAL", "Something went wrong");

    if (err.code === "INTERNAL") {
      this.logger.error({ requestId: req.suiem?.requestId, route: req.routeOptions?.url, ...errorFields(exception) }, "unhandled error");
    }
    const body: ErrorEnvelope = {
      error: {
        code: err.code,
        message: err.message,
        requestId: req.suiem?.requestId ?? "unknown",
        ...(err.details ? { details: err.details } : {}),
      },
    };
    for (const [k, v] of Object.entries(err.extraHeaders ?? {})) void reply.header(k, v);
    void reply.status(err.status).header("content-type", "application/json; charset=utf-8").send(body);
  }
}
