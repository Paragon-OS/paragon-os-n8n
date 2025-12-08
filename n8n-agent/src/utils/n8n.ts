import { execa } from "execa";
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { logger } from "./logger";

/**
 * Error type for execa timeout errors
 */
interface ExecaTimeoutError extends Error {
  timedOut?: boolean;
  isCanceled?: boolean;
}

/**
 * Type guard to check if error is an execa timeout error
 */
function isExecaTimeoutError(error: unknown): error is ExecaTimeoutError {
  return (
    typeof error === "object" &&
    error !== null &&
    ("timedOut" in error || "isCanceled" in error)
  );
}

/**
 * Run n8n command with output inherited (visible to user)
 */
export async function runN8n(args: string[]): Promise<number> {
  try {
    const result = await execa("n8n", args, {
      stdio: "inherit",
      reject: false,
    });
    return result.exitCode ?? 1;
  } catch (error: unknown) {
    logger.error("Failed to execute n8n command", error, { args });
    return 1;
  }
}

/**
 * Run n8n command and capture stdout/stderr
 * @param args Command arguments
 * @param timeoutMs Optional timeout in milliseconds (default: 2 minutes for execute, no timeout for others)
 */
export async function runN8nCapture(
  args: string[],
  timeoutMs?: number
): Promise<{ code: number; stdout: string; stderr: string }> {
  // Default timeout for execute commands (2 minutes), no timeout for others
  const defaultTimeout = args.includes('execute') ? 2 * 60 * 1000 : undefined;
  const timeout = timeoutMs ?? defaultTimeout;

  // Check if we're in test environment (vitest or other test runners)
  // More robust detection to handle various test runner scenarios
  // Vitest sets VITEST env var, and we also set it explicitly in vitest.config.ts
  const isTestEnv = 
    process.env.NODE_ENV === 'test' || 
    process.env.VITEST === 'true' || 
    (typeof process.env.VITEST !== 'undefined' && process.env.VITEST !== 'false') ||
    // Fallback: check if vitest is in process args (e.g., when running via npm test)
    (process.argv.some(arg => /vitest/i.test(arg)) && process.argv.some(arg => /test/i.test(arg)));
  
  // For execute commands, use non-streaming execa which properly buffers output
  // The streaming version has issues with data events not firing
  // execa's built-in buffering works better for n8n execute commands
  if (args.includes('execute')) {
    // Use execa's built-in buffering instead of streaming
    // This is more reliable for n8n execute commands
    const env = { 
      ...process.env,
      FORCE_COLOR: '0',
      NO_COLOR: '1',
      CI: 'true',
    };
    
    logger.debug(`[EXECA] Executing n8n with args: ${args.join(' ')}`);
    
    return execa("n8n", args, {
      stdio: ["ignore", "pipe", "pipe"],
      reject: false,
      timeout,
      env,
      all: false, // Keep stdout and stderr separate
      stripFinalNewline: false,
    }).then(result => {
      logger.debug(`[EXECA] Captured: code=${result.exitCode}, stdout=${result.stdout?.length || 0}, stderr=${result.stderr?.length || 0}`);
      return {
        code: result.exitCode ?? 1,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
      };
    }).catch(error => {
      logger.debug(`[EXECA] Error: ${error instanceof Error ? error.message : String(error)}`);
      if (error.signal === 'SIGTERM' && timeout) {
        return {
          code: 124,
          stdout: "",
          stderr: `Command timed out after ${timeout}ms`,
        };
      }
      return {
        code: 1,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
      };
    });
  }
  

  try {
    // In test environments, use "ignore" for stdin to avoid interference
    // from vitest's test runner stdin handling
    const stdinMode = isTestEnv ? "ignore" : "inherit";
    
    // Use 'pipe' for stdout/stderr to capture all output
    // execa will automatically buffer all output when using 'pipe'
    // For execute commands, ensure output is not suppressed by setting env vars
    const env = { ...process.env };
    if (args.includes('execute')) {
      // Force n8n to output JSON even when not in TTY
      // Some n8n versions suppress output when stdout is not a TTY
      env.FORCE_COLOR = '0'; // Disable color codes that might interfere
      env.NO_COLOR = '1';
    }
    
    const result = await execa("n8n", args, {
      stdio: [stdinMode, "pipe", "pipe"],
      reject: false,
      timeout,
      env,
      // These are execa defaults but being explicit
      all: false, // Keep stdout and stderr separate
      stripFinalNewline: false, // Keep newlines as-is
    });

    // Check if process was killed due to timeout
    // When execa times out with reject: false, it may return with a signal
    if (result.signal === 'SIGTERM' && timeout) {
      return {
        code: 124, // Standard timeout exit code
        stdout: result.stdout ?? "",
        stderr: `Command timed out after ${timeout}ms`,
      };
    }

    return {
      code: result.exitCode ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
    } catch (error: unknown) {
    // Handle timeout errors (when reject: true or other errors)
    if (isExecaTimeoutError(error)) {
      return {
        code: 124, // Standard timeout exit code
        stdout: "",
        stderr: `Command timed out after ${timeout ?? 'default'}ms`,
      };
    }
    logger.error("Failed to execute n8n command", error, { args, timeout });
    return {
      code: 1,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Run n8n execute command with streaming to detect completion early
 * This prevents hanging when the workflow completes but the CLI doesn't exit
 */
async function runN8nExecuteWithStreaming(
  args: string[],
  timeoutMs?: number
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    // For execute commands, ensure we capture output properly
    // Use 'pipe' for both stdout and stderr to capture all output
    // Force output by setting environment variables
    const env = { 
      ...process.env,
      FORCE_COLOR: '0',
      NO_COLOR: '1',
      // Force n8n to output even when not in TTY
      CI: 'true',
    };
    
    logger.debug(`[STREAM] Starting n8n with args: ${args.join(' ')}, env: ${JSON.stringify({ FORCE_COLOR: env.FORCE_COLOR, NO_COLOR: env.NO_COLOR, CI: env.CI })}`);
    
    const child = execa("n8n", args, {
      stdio: ["ignore", "pipe", "pipe"], // Use ignore for stdin to avoid blocking
      reject: false,
      env,
    });

    let stdout = "";
    let stderr = "";
    let completed = false;
    let timeoutId: NodeJS.Timeout | undefined;
    let exitCode: number | null = null;
    let exitSignal: string | null = null;
    let stdoutEnded = false;
    let stderrEnded = false;

    // Helper to resolve when everything is done
    const tryResolve = () => {
      if (completed) return;
      
      // Wait for both process exit AND streams to close
      if (exitCode !== null && stdoutEnded && stderrEnded) {
        completed = true;
        
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        if (exitSignal === 'SIGTERM' && timeoutMs) {
          resolve({
            code: 124,
            stdout,
            stderr: stderr || `Command timed out after ${timeoutMs}ms`,
          });
        } else {
          resolve({
            code: exitCode ?? 1,
            stdout,
            stderr,
          });
        }
      }
    };

    // Set up timeout
    if (timeoutMs) {
      timeoutId = setTimeout(() => {
        if (!completed) {
          completed = true;
          child.kill('SIGTERM');
          resolve({
            code: 124,
            stdout,
            stderr: stderr || `Command timed out after ${timeoutMs}ms`,
          });
        }
      }, timeoutMs);
    }

    // Stream stdout - wait for 'end' event
    if (child.stdout) {
      child.stdout.on("data", (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;
        logger.debug(`[STREAM] stdout data chunk: ${chunk.length} chars, total: ${stdout.length}`);
      });
      
      child.stdout.on("end", () => {
        logger.debug(`[STREAM] stdout ended, total captured: ${stdout.length} chars`);
        stdoutEnded = true;
        tryResolve();
      });
      
      child.stdout.on("error", (err) => {
        logger.debug(`[STREAM] stdout error: ${err instanceof Error ? err.message : String(err)}`);
        stdoutEnded = true;
        tryResolve();
      });
    } else {
      logger.debug(`[STREAM] No stdout stream available`);
      stdoutEnded = true;
    }

    // Stream stderr - wait for 'end' event
    if (child.stderr) {
      child.stderr.on("data", (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;
        logger.debug(`[STREAM] stderr data chunk: ${chunk.length} chars, total: ${stderr.length}`);
      });
      
      child.stderr.on("end", () => {
        logger.debug(`[STREAM] stderr ended, total captured: ${stderr.length} chars`);
        stderrEnded = true;
        tryResolve();
      });
      
      child.stderr.on("error", (err) => {
        logger.debug(`[STREAM] stderr error: ${err instanceof Error ? err.message : String(err)}`);
        stderrEnded = true;
        tryResolve();
      });
    } else {
      logger.debug(`[STREAM] No stderr stream available`);
      stderrEnded = true;
    }

    // Wait for process to complete (but don't resolve until streams close)
    child.on("exit", (code, signal) => {
      exitCode = code ?? 1;
      exitSignal = signal;
      logger.debug(`[STREAM] Process exited with code=${exitCode}, signal=${signal}, stdout=${stdout.length}, stderr=${stderr.length}`);
      
      // For execute commands, wait longer for output to flush
      // Sometimes output is written asynchronously after process exit
      const waitTime = args.includes('execute') ? 2000 : 1000;
      
      // Give streams a chance to finish, but don't wait forever
      // If streams don't close within waitTime, resolve anyway with what we have
      setTimeout(() => {
        if (!completed) {
          // Log what we captured before forcing resolution
          logger.debug(`[STREAM] Forcing resolution after ${waitTime}ms. Captured: stdout=${stdout.length} chars, stderr=${stderr.length} chars`);
          if (stdout) {
            logger.debug(`[STREAM] stdout content (first 200): ${stdout.substring(0, 200)}`);
          }
          if (stderr) {
            logger.debug(`[STREAM] stderr content (first 200): ${stderr.substring(0, 200)}`);
          }
          stdoutEnded = true;
          stderrEnded = true;
          tryResolve();
        }
      }, waitTime);
      
      tryResolve();
    });

    child.on("error", (error) => {
      if (completed) return;
      completed = true;

      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      resolve({
        code: 1,
        stdout,
        stderr: stderr || String(error),
      });
    });
  });
}

/**
 * Patterns to filter out (noisy but harmless warnings)
 */
const FILTER_PATTERNS = [
  /Active version not found for workflow/,
  /Could not remove webhooks/,
  /Could not find workflow/,
  /Error: Active version not found/,
  /Error: Could not find workflow/,
  /at ActiveWorkflowManager/,
  /at ImportService/,
  /at ImportWorkflowsCommand/,
  /at CommandRegistry/,
  /at \/Users\/.*\/n8n/,
  // Version compatibility warnings
  /Client version .* is incompatible with server version/,
  /Major versions should match/,
  /checkCompatibility=false/,
];

function shouldFilter(line: string): boolean {
  return FILTER_PATTERNS.some((pattern) => pattern.test(line));
}

/**
 * Run n8n command quietly, filtering out noisy warnings (webhook errors, etc.)
 * Only shows meaningful output and errors.
 */
export async function runN8nQuiet(args: string[]): Promise<number> {
  try {
    const child = execa("n8n", args, {
      stdio: ["inherit", "pipe", "pipe"],
      reject: false,
    });

    // Filter stdout line by line (execa returns streams when using pipe)
    const stdout = child.stdout as NodeJS.ReadableStream | undefined;
    const stderr = child.stderr as NodeJS.ReadableStream | undefined;

    if (stdout) {
      stdout.on("data", (data: Buffer) => {
        const lines = data.toString().split("\n");
        for (const line of lines) {
          if (line.trim() && !shouldFilter(line)) {
            // User-facing output - use info level but output directly
            // pino-pretty will format this nicely
            logger.info(line);
          }
        }
      });
    }

    if (stderr) {
      stderr.on("data", (data: Buffer) => {
        const lines = data.toString().split("\n");
        for (const line of lines) {
          if (line.trim() && !shouldFilter(line)) {
            // User-facing error output
            logger.warn(line);
          }
        }
      });
    }

    const result = await child;
    return result.exitCode ?? 1;
  } catch (error: unknown) {
    logger.error("Failed to execute n8n command", error, { args });
    return 1;
  }
}

