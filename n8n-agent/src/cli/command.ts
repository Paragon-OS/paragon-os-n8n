import type { Command } from "commander";

/**
 * Extract remaining arguments after commander parsing.
 * Useful for commands that allow unknown options to pass through to sub-commands.
 * 
 * @param command - The commander command object from the action callback
 * @returns Array of remaining unparsed arguments
 */
export function getRemainingArgs(command: Command): string[] {
  // commander stores unknown options in command.args
  // For commands with allowUnknownOption, these are the unparsed arguments
  return (command as any).args || [];
}

