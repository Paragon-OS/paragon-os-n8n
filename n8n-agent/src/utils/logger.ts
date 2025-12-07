import pino from "pino";

/**
 * Log levels supported by the logger
 */
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

/**
 * Get log level from environment variable or default to 'info'
 */
function getLogLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase();
  const validLevels: LogLevel[] = ["trace", "debug", "info", "warn", "error", "fatal"];
  
  if (envLevel && validLevels.includes(envLevel as LogLevel)) {
    return envLevel as LogLevel;
  }
  
  // Default to info in production, debug in development
  return process.env.NODE_ENV === "production" ? "info" : "info";
}

/**
 * Determine if we should use pretty printing (for development)
 */
function shouldUsePretty(): boolean {
  // Use pretty printing if:
  // 1. LOG_PRETTY is explicitly set to true
  // 2. Or we're not in production and LOG_PRETTY is not explicitly false
  if (process.env.LOG_PRETTY === "false") {
    return false;
  }
  if (process.env.LOG_PRETTY === "true") {
    return true;
  }
  // Default: pretty in non-production, JSON in production
  return process.env.NODE_ENV !== "production";
}

/**
 * Create the base logger instance
 */
const baseLogger = pino({
  level: getLogLevel(),
  transport: shouldUsePretty()
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss",
          ignore: "pid,hostname",
          singleLine: false,
        },
      }
    : undefined,
  base: {
    pid: process.pid,
  },
});

/**
 * Logger interface that provides structured logging with context
 */
export interface Logger {
  trace(message: string, context?: Record<string, unknown>, ...args: unknown[]): void;
  debug(message: string, context?: Record<string, unknown>, ...args: unknown[]): void;
  info(message: string, context?: Record<string, unknown>, ...args: unknown[]): void;
  warn(message: string, context?: Record<string, unknown> | Error | unknown, error?: Error | unknown, ...args: unknown[]): void;
  error(message: string, context?: Record<string, unknown> | Error | unknown, error?: Error | unknown, ...args: unknown[]): void;
  fatal(message: string, context?: Record<string, unknown> | Error | unknown, error?: Error | unknown, ...args: unknown[]): void;
  
  // Child loggers with context
  child(bindings: Record<string, unknown>): Logger;
}

/**
 * Create a logger instance
 */
function createLogger(context?: Record<string, unknown>): Logger {
  const logger = context ? baseLogger.child(context) : baseLogger;
  
  return {
    trace: (message: string, context?: Record<string, unknown>, ...args: unknown[]) => {
      const merged = context ? { ...context, args } : { args };
      logger.trace(merged, message);
    },
    debug: (message: string, context?: Record<string, unknown>, ...args: unknown[]) => {
      const merged = context ? { ...context, args } : { args };
      logger.debug(merged, message);
    },
    info: (message: string, context?: Record<string, unknown>, ...args: unknown[]) => {
      const merged = context ? { ...context, args } : { args };
      logger.info(merged, message);
    },
    warn: (message: string, contextOrError?: Record<string, unknown> | Error | unknown, error?: Error | unknown, ...args: unknown[]) => {
      // Handle case where context is actually an error (backward compatibility)
      if (contextOrError instanceof Error) {
        logger.warn({ err: contextOrError, args }, message);
      } else if (contextOrError && typeof contextOrError === 'object' && !Array.isArray(contextOrError)) {
        // It's a context object
        const merged = error instanceof Error 
          ? { ...contextOrError as Record<string, unknown>, err: error, args }
          : { ...contextOrError as Record<string, unknown>, error, args };
        logger.warn(merged, message);
      } else {
        // No context, just error or args
        const merged = error instanceof Error 
          ? { err: error, args: [contextOrError, ...args] }
          : { error: contextOrError, args };
        logger.warn(merged, message);
      }
    },
    error: (message: string, contextOrError?: Record<string, unknown> | Error | unknown, error?: Error | unknown, ...args: unknown[]) => {
      // Handle case where context is actually an error (backward compatibility)
      if (contextOrError instanceof Error) {
        logger.error({ err: contextOrError, args }, message);
      } else if (contextOrError && typeof contextOrError === 'object' && !Array.isArray(contextOrError)) {
        // It's a context object
        const merged = error instanceof Error 
          ? { ...contextOrError as Record<string, unknown>, err: error, args }
          : { ...contextOrError as Record<string, unknown>, error, args };
        logger.error(merged, message);
      } else {
        // No context, just error or args
        const merged = error instanceof Error 
          ? { err: error, args: [contextOrError, ...args] }
          : { error: contextOrError, args };
        logger.error(merged, message);
      }
    },
    fatal: (message: string, contextOrError?: Record<string, unknown> | Error | unknown, error?: Error | unknown, ...args: unknown[]) => {
      // Handle case where context is actually an error (backward compatibility)
      if (contextOrError instanceof Error) {
        logger.fatal({ err: contextOrError, args }, message);
      } else if (contextOrError && typeof contextOrError === 'object' && !Array.isArray(contextOrError)) {
        // It's a context object
        const merged = error instanceof Error 
          ? { ...contextOrError as Record<string, unknown>, err: error, args }
          : { ...contextOrError as Record<string, unknown>, error, args };
        logger.fatal(merged, message);
      } else {
        // No context, just error or args
        const merged = error instanceof Error 
          ? { err: error, args: [contextOrError, ...args] }
          : { error: contextOrError, args };
        logger.fatal(merged, message);
      }
    },
    child: (bindings: Record<string, unknown>) => {
      return createLogger({ ...context, ...bindings });
    },
  };
}

/**
 * Default logger instance (use this for most cases)
 */
export const logger = createLogger();

/**
 * Create a logger with context (e.g., for a specific command or operation)
 */
export function createContextLogger(context: Record<string, unknown>): Logger {
  return createLogger(context);
}

/**
 * Progress logger for long-running operations
 * Provides a simple way to log progress updates
 */
export class ProgressLogger {
  private logger: Logger;
  private operation: string;
  
  constructor(operation: string, context?: Record<string, unknown>) {
    this.operation = operation;
    this.logger = context ? createLogger(context) : logger;
  }
  
  start(message?: string): void {
    this.logger.info(message || `Starting ${this.operation}`);
  }
  
  step(step: string, details?: Record<string, unknown>): void {
    const message = `[${this.operation}] ${step}`;
    if (details && Object.keys(details).length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.logger.info as any)({ step, ...details }, message);
    } else {
      this.logger.info(message);
    }
  }
  
  success(message?: string): void {
    this.logger.info(message || `Completed ${this.operation} successfully`);
  }
  
  error(message: string, error?: Error | unknown): void {
    const errorMessage = `[${this.operation}] ${message}`;
    if (error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.logger.error as any)(error, errorMessage);
    } else {
      this.logger.error(errorMessage);
    }
  }
  
  warn(message: string, details?: Record<string, unknown>): void {
    const warnMessage = `[${this.operation}] ${message}`;
    if (details && Object.keys(details).length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.logger.warn as any)({ ...details }, warnMessage);
    } else {
      this.logger.warn(warnMessage);
    }
  }
}

