import * as readline from "readline";

/**
 * Prompt user for confirmation. Returns true if user confirms, false otherwise.
 * Supports yes option from commander to skip prompt and auto-confirm.
 */
export async function confirm(
  message: string,
  yes: boolean = false
): Promise<boolean> {
  if (yes) {
    return true;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${message} (y/N): `, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === "y" || normalized === "yes");
    });
  });
}

