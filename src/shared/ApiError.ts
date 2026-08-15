export interface ErrorDetail {
  path: string;
  message: string;
}

/**
 * Every deliberate failure in the app is one of these. The central errorHandler
 * turns it into the response envelope; nothing else formats errors.
 */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: ErrorDetail[];

  constructor(statusCode: number, code: string, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, ApiError);
  }

  static badRequest(message: string, code = 'BAD_REQUEST', details?: ErrorDetail[]) {
    return new ApiError(400, code, message, details);
  }

  static unauthorized(message = 'Authentication required', code = 'UNAUTHORIZED') {
    return new ApiError(401, code, message);
  }

  static forbidden(message = 'Insufficient permissions', code = 'FORBIDDEN') {
    return new ApiError(403, code, message);
  }

  static notFound(resource = 'Resource', code = 'NOT_FOUND') {
    return new ApiError(404, code, `${resource} not found`);
  }

  static conflict(message: string, code = 'CONFLICT', details?: ErrorDetail[]) {
    return new ApiError(409, code, message, details);
  }

  static unprocessable(message: string, details?: ErrorDetail[], code = 'VALIDATION_ERROR') {
    return new ApiError(422, code, message, details);
  }

  static tooManyRequests(message = 'Too many requests') {
    return new ApiError(429, 'RATE_LIMITED', message);
  }

  static internal(message = 'Internal server error') {
    return new ApiError(500, 'INTERNAL_ERROR', message);
  }
}
