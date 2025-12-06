import path from "path";

/**
 * Resolve directory path from commander option or use fallback.
 * 
 * @param optionValue - The value from a commander option (may be undefined)
 * @param fallback - Fallback path to use if optionValue is not provided
 * @returns Resolved absolute path
 */
export function resolveDir(optionValue: string | undefined, fallback: string): string {
  if (optionValue) {
    return path.resolve(optionValue);
  }
  return path.resolve(fallback);
}

/**
 * Get passthrough args for n8n CLI (filters out our custom flags).
 * 
 * @param args - Array of command-line arguments
 * @param excludeFlags - Additional flags to exclude from passthrough
 * @returns Filtered array of arguments to pass through to n8n
 */
export function getPassthroughArgs(args: string[], excludeFlags: string[] = []): string[] {
  const excludeSet = new Set([
    "--output",
    "--input",
    "--workflow",
    "--test",
    "--list",
    "-w",
    "-t",
    "-l",
    "-y",
    "--yes",
    ...excludeFlags,
  ]);

  return args.filter((arg) => {
    // Exclude our custom flags and their values
    if (excludeSet.has(arg)) {
      return false;
    }
    // Exclude values that follow our flags (handled by commander)
    return true;
  });
}

