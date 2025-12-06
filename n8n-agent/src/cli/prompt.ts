import prompts from "prompts";

/**
 * Prompt user for confirmation. Returns true if user confirms, false otherwise.
 * Supports yes option from commander to skip prompt and auto-confirm.
 * 
 * @param message - The confirmation message to display
 * @param yes - If true, skip prompt and auto-confirm
 * @returns Promise resolving to true if confirmed, false otherwise
 */
export async function confirm(
  message: string,
  yes: boolean = false
): Promise<boolean> {
  if (yes) {
    return true;
  }

  const { value } = await prompts({
    type: "confirm",
    name: "value",
    message: `${message} (y/N)`,
    initial: false,
  });

  // Handle Ctrl+C cancellation
  if (value === undefined) {
    return false;
  }

  return value === true;
}

