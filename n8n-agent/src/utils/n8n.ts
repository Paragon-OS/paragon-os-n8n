import { spawn } from "child_process";

export function runN8n(args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("n8n", args, {
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.on("close", (code) => {
      resolve(code ?? 1);
    });
  });
}

export function runN8nCapture(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("n8n", args, {
      stdio: ["inherit", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

/**
 * Run n8n command quietly, filtering out noisy warnings (webhook errors, etc.)
 * Only shows meaningful output and errors.
 */
export function runN8nQuiet(args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("n8n", args, {
      stdio: ["inherit", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

    // Patterns to filter out (noisy but harmless warnings)
    const filterPatterns = [
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

    const shouldFilter = (line: string): boolean => {
      return filterPatterns.some(pattern => pattern.test(line));
    };

    child.stdout?.on("data", (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.trim() && !shouldFilter(line)) {
          console.log(line);
        }
      }
    });

    child.stderr?.on("data", (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.trim() && !shouldFilter(line)) {
          console.error(line);
        }
      }
    });

    child.on("close", (code) => {
      resolve(code ?? 1);
    });
  });
}

