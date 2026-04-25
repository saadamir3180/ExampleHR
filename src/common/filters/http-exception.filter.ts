import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

interface ErrorBody {
  message?: string | string[];
  error?: string;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();

    const parsedError = this.parseException(exception);

    response.status(parsedError.statusCode).json({
      statusCode: parsedError.statusCode,
      message: parsedError.message,
      error: parsedError.error,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }

  private parseException(exception: unknown): {
    statusCode: number;
    message: string;
    error: string;
  } {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const response = exception.getResponse();

      if (typeof response === 'string') {
        return {
          statusCode,
          message: response,
          error: HttpStatus[statusCode] ?? 'Error',
        };
      }

      if (this.isErrorBody(response)) {
        const extractedMessage = Array.isArray(response.message)
          ? response.message[0]
          : response.message;
        return {
          statusCode,
          message: extractedMessage ?? exception.message,
          error: response.error ?? HttpStatus[statusCode] ?? 'Error',
        };
      }

      return {
        statusCode,
        message: exception.message,
        error: HttpStatus[statusCode] ?? 'Error',
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      error: HttpStatus[HttpStatus.INTERNAL_SERVER_ERROR],
    };
  }

  private isErrorBody(response: unknown): response is ErrorBody {
    return typeof response === 'object' && response !== null;
  }
}
