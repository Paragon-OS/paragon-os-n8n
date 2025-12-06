import * as readline from "readline";

/**
 * Prompt user for confirmation. Returns true if user confirms, false otherwise.
 * Supports -y/--yes flag to skip prompt and auto-confirm.
 */
export async function confirm(
  message: string,
  flags: string[] = []
): Promise<boolean> {
  // Check for -y or --yes flag to skip confirmation
  const hasYesFlag = flags.some(
    (flag) => flag === "-y" || flag === "--yes" || flag === "-Y" || flag === "--Yes"
  );

  if (hasYesFlag) {
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

