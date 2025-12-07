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
      if (context) {
        const merged = args.length > 0 ? { ...context, args } : context;
        logger.trace(merged, message);
      } else if (args.length > 0) {
        logger.trace({ args }, message);
      } else {
        logger.trace(message);
      }
    },
    debug: (message: string, context?: Record<string, unknown>, ...args: unknown[]) => {
      if (context) {
        const merged = args.length > 0 ? { ...context, args } : context;
        logger.debug(merged, message);
      } else if (args.length > 0) {
        logger.debug({ args }, message);
      } else {
        logger.debug(message);
      }
    },
    info: (message: string, context?: Record<string, unknown>, ...args: unknown[]) => {
      if (context) {
        const merged = args.length > 0 ? { ...context, args } : context;
        logger.info(merged, message);
      } else if (args.length > 0) {
        logger.info({ args }, message);
      } else {
        logger.info(message);
      }
    },
    warn: (message: string, contextOrError?: Record<string, unknown> | Error | unknown, error?: Error | unknown, ...args: unknown[]) => {
      // Handle case where context is actually an error (backward compatibility)
      if (contextOrError instanceof Error) {
        const merged = args.length > 0 ? { err: contextOrError, args } : { err: contextOrError };
        logger.warn(merged, message);
      } else if (contextOrError && typeof contextOrError === 'object' && !Array.isArray(contextOrError)) {
        // It's a context object
        const baseMerged = error instanceof Error 
          ? { ...contextOrError as Record<string, unknown>, err: error }
          : { ...contextOrError as Record<string, unknown>, error };
        const merged = args.length > 0 ? { ...baseMerged, args } : baseMerged;
        logger.warn(merged, message);
      } else {
        // No context, just error or args
        const allArgs = contextOrError !== undefined ? [contextOrError, ...args] : args;
        if (error instanceof Error) {
          const merged = allArgs.length > 0 ? { err: error, args: allArgs } : { err: error };
          logger.warn(merged, message);
        } else if (contextOrError !== undefined || error !== undefined || args.length > 0) {
          const merged = allArgs.length > 0 ? { error: contextOrError || error, args: allArgs } : { error: contextOrError || error };
          logger.warn(merged, message);
        } else {
          logger.warn(message);
        }
      }
    },
    error: (message: string, contextOrError?: Record<string, unknown> | Error | unknown, error?: Error | unknown, ...args: unknown[]) => {
      // Handle case where context is actually an error (backward compatibility)
      if (contextOrError instanceof Error) {
        const merged = args.length > 0 ? { err: contextOrError, args } : { err: contextOrError };
        logger.error(merged, message);
      } else if (contextOrError && typeof contextOrError === 'object' && !Array.isArray(contextOrError)) {
        // It's a context object
        const baseMerged = error instanceof Error 
          ? { ...contextOrError as Record<string, unknown>, err: error }
          : { ...contextOrError as Record<string, unknown>, error };
        const merged = args.length > 0 ? { ...baseMerged, args } : baseMerged;
        logger.error(merged, message);
      } else {
        // No context, just error or args
        const allArgs = contextOrError !== undefined ? [contextOrError, ...args] : args;
        if (error instanceof Error) {
          const merged = allArgs.length > 0 ? { err: error, args: allArgs } : { err: error };
          logger.error(merged, message);
        } else if (contextOrError !== undefined || error !== undefined || args.length > 0) {
          const merged = allArgs.length > 0 ? { error: contextOrError || error, args: allArgs } : { error: contextOrError || error };
          logger.error(merged, message);
        } else {
          logger.error(message);
        }
      }
    },
    fatal: (message: string, contextOrError?: Record<string, unknown> | Error | unknown, error?: Error | unknown, ...args: unknown[]) => {
      // Handle case where context is actually an error (backward compatibility)
      if (contextOrError instanceof Error) {
        const merged = args.length > 0 ? { err: contextOrError, args } : { err: contextOrError };
        logger.fatal(merged, message);
      } else if (contextOrError && typeof contextOrError === 'object' && !Array.isArray(contextOrError)) {
        // It's a context object
        const baseMerged = error instanceof Error 
          ? { ...contextOrError as Record<string, unknown>, err: error }
          : { ...contextOrError as Record<string, unknown>, error };
        const merged = args.length > 0 ? { ...baseMerged, args } : baseMerged;
        logger.fatal(merged, message);
      } else {
        // No context, just error or args
        const allArgs = contextOrError !== undefined ? [contextOrError, ...args] : args;
        if (error instanceof Error) {
          const merged = allArgs.length > 0 ? { err: error, args: allArgs } : { err: error };
          logger.fatal(merged, message);
        } else if (contextOrError !== undefined || error !== undefined || args.length > 0) {
          const merged = allArgs.length > 0 ? { error: contextOrError || error, args: allArgs } : { error: contextOrError || error };
          logger.fatal(merged, message);
        } else {
          logger.fatal(message);
        }
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

