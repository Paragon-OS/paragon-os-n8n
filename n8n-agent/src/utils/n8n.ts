import { execa } from "execa";
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

  // For execute commands, use streaming to detect completion early
  if (args.includes('execute')) {
    return runN8nExecuteWithStreaming(args, timeout);
  }

  try {
    const result = await execa("n8n", args, {
      stdio: ["inherit", "pipe", "pipe"],
      reject: false,
      timeout,
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
    const child = execa("n8n", args, {
      stdio: ["inherit", "pipe", "pipe"],
      reject: false,
    });

    let stdout = "";
    let stderr = "";
    let completed = false;
    let timeoutId: NodeJS.Timeout | undefined;

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

    // Stream stdout
    if (child.stdout) {
      child.stdout.on("data", (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;

        // Try to detect if we have complete JSON output
        // Look for valid JSON objects/arrays that might indicate completion
        if (chunk.includes('}') || chunk.includes(']')) {
          // Check if we have a complete JSON structure
          try {
            // Try to parse the accumulated stdout as JSON
            const trimmed = stdout.trim();
            if (trimmed) {
              // Look for JSON after separator or at the end
              const jsonMatch = trimmed.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
              if (jsonMatch) {
                try {
                  JSON.parse(jsonMatch[0]);
                  // If we successfully parsed JSON and haven't seen new output in a bit,
                  // the workflow might be done. But we'll still wait for the process to exit
                  // to be safe, unless it's taking too long.
                } catch {
                  // Not complete JSON yet, continue
                }
              }
            }
          } catch {
            // Continue streaming
          }
        }
      });
    }

    // Stream stderr
    if (child.stderr) {
      child.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });
    }

    // Wait for process to complete
    child.on("exit", (exitCode, signal) => {
      if (completed) return;
      completed = true;

      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      if (signal === 'SIGTERM' && timeoutMs) {
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

