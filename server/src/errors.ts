import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

/** Same envelope as the Python backend: {error:{code,message,details},request_id}. */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function envelope(code: string, message: string, requestId: string, details: unknown = {}) {
  return { error: { code, message, details: details ?? {} }, request_id: requestId };
}

export function zodDetails(err: ZodError) {
  return {
    errors: err.issues.map((i) => ({ loc: ['body', ...i.path.map(String)], msg: i.message })),
  };
}

/** Parse with zod; any failure becomes a 422 validation_error. */
export function parse<T>(schema: { parse(x: unknown): T }, data: unknown, where = 'body'): T {
  try {
    return schema.parse(data);
  } catch (e) {
    if (e instanceof ZodError) {
      throw new AppError('validation_error', 'Request validation failed', 422, {
        errors: e.issues.map((i) => ({ loc: [where, ...i.path.map(String)], msg: i.message })),
      });
    }
    throw e;
  }
}

export function errorHandler(err: FastifyError | Error, req: FastifyRequest, reply: FastifyReply) {
  const rid = req.id;
  if (err instanceof AppError) {
    return reply.status(err.status).send(envelope(err.code, err.message, rid, err.details));
  }
  if (err instanceof ZodError) {
    return reply.status(422).send(envelope('validation_error', 'Request validation failed', rid, zodDetails(err)));
  }
  const fe = err as FastifyError;
  const status = fe.statusCode ?? 500;
  if (fe.code === 'FST_ERR_CTP_INVALID_JSON_BODY' || fe.code === 'FST_ERR_CTP_EMPTY_JSON_BODY' || fe.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
    return reply
      .status(422)
      .send(envelope('validation_error', 'Request validation failed', rid, { errors: [{ loc: ['body'], msg: 'JSON decode error' }] }));
  }
  if (status >= 400 && status < 500) {
    return reply.status(status).send(envelope(`http_${status}`, fe.message, rid));
  }
  req.log.error({ err }, 'unhandled error');
  return reply.status(500).send(envelope('internal_error', 'Internal server error', rid));
}
