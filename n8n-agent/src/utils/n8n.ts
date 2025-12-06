import { execa } from "execa";

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
  } catch (error) {
    console.error("Failed to execute n8n command:", error);
    return 1;
  }
}

/**
 * Run n8n command and capture stdout/stderr
 * @param args Command arguments
 * @param timeoutMs Optional timeout in milliseconds (default: 5 minutes for execute, no timeout for others)
 */
export async function runN8nCapture(
  args: string[],
  timeoutMs?: number
): Promise<{ code: number; stdout: string; stderr: string }> {
  // Default timeout for execute commands (30 seconds), no timeout for others
  const defaultTimeout = args.includes('execute') ? 30 * 1000 : undefined;
  const timeout = timeoutMs ?? defaultTimeout;

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
  } catch (error: any) {
    // Handle timeout errors (when reject: true or other errors)
    if (error?.timedOut || error?.isCanceled) {
      return {
        code: 124, // Standard timeout exit code
        stdout: "",
        stderr: `Command timed out after ${timeout ?? 'default'}ms`,
      };
    }
    console.error("Failed to execute n8n command:", error);
    return { code: 1, stdout: "", stderr: String(error) };
  }
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
            console.log(line);
          }
        }
      });
    }

    if (stderr) {
      stderr.on("data", (data: Buffer) => {
        const lines = data.toString().split("\n");
        for (const line of lines) {
          if (line.trim() && !shouldFilter(line)) {
            console.error(line);
          }
        }
      });
    }

    const result = await child;
    return result.exitCode ?? 1;
  } catch (error) {
    console.error("Failed to execute n8n command:", error);
    return 1;
  }
}

