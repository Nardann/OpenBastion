import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

/**
 * Global exception filter to sanitize error responses
 * - Hides internal 500 error details from clients
 * - Preserves useful 4xx error messages for debugging/UI
 * - Logs full errors server-side
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: any, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: any = 'Internal Server Error';

    // Log the full error server-side for debugging
    this.logger.error({
      message: exception.message,
      stack: exception.stack,
      path: request.url,
      method: request.method,
      timestamp: new Date().toISOString(),
    });

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse: any = exception.getResponse();

      if (typeof exceptionResponse === 'object') {
        if (exceptionResponse.errors) {
          // Join all validation errors into a single string for easy reading
          const errorList = Object.values(exceptionResponse.errors).flat();
          message = errorList.join(', ');
        } else if (Array.isArray(exceptionResponse.message)) {
          message = exceptionResponse.message.join(', ');
        } else {
          message =
            exceptionResponse.message ||
            exception.message ||
            'An error occurred';
        }
      } else {
        message = exception.message || 'An error occurred';
      }
    }

    // For 500 errors, we still sanitize for security
    if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
      message = 'An unexpected internal error occurred';
    }

    // Return the response
    response.status(status).json({
      statusCode: status,
      message: message,
      error:
        status >= 400 && status < 500
          ? exception.name || 'Request Error'
          : 'Internal Server Error',
      timestamp: new Date().toISOString(),
    });
  }
}
