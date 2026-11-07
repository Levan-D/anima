export const ERROR_CODES = [
  'unexpected',
  'invalid_input',
  'invalid_eq_file',
  'eq_file_not_written',
  'not_found',
  'no_library',
  'library_folder_missing',
  'library_not_writable',
  'db_corrupt',
  'db_too_new',
  'no_backup',
  'scan_running',
  'file_missing',
  'file_unreadable',
  'engine_unavailable',
  'device_busy',
  'name_taken',
  'cue_invalid',
  'network',
  'rate_limited',
  'service_off',
  'waveform_failed',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** `message` is written for the person using the app, never a stack trace. */
export type AppError = {
  code: ErrorCode;
  message: string;
};

export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError };

export function ok(): Result<void>;
export function ok<T>(value: T): Result<T>;
export function ok<T>(value?: T): Result<T | undefined> {
  return { ok: true, value };
}

export function err(code: ErrorCode, message: string): { ok: false; error: AppError } {
  return { ok: false, error: { code, message } };
}

/** For logs and scan reports. What a thrown value says, whatever it is. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
