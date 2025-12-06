import path from "path";

/**
 * Resolve directory path from commander option or use fallback
 */
export function resolveDir(optionValue: string | undefined, fallback: string): string {
  if (optionValue) {
    return path.resolve(optionValue);
  }
  return path.resolve(fallback);
}

/**
 * Get passthrough args for n8n CLI (filters out our custom flags)
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

