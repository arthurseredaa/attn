import { HttpException } from '@nestjs/common';

/** An HttpException whose `error` field is a stable app code instead of the one derived from the status. */
export class CodedHttpException extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    message: string,
  ) {
    super(message, status);
  }
}
