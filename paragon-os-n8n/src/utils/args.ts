import type { Command, ParsedArgs } from "../types/index";

export function parseArgs(argv: string[]): ParsedArgs {
  const [, , commandArg, ...rest] = argv;

  if (
    commandArg !== "backup" &&
    commandArg !== "restore" &&
    commandArg !== "tree" &&
    commandArg !== "organize"
  ) {
    printUsage();
    process.exit(1);
  }

  return {
    command: commandArg as Command,
    flags: rest,
  };
}

export function printUsage() {
  console.log(
    [
      "Usage:",
      "  ts-node src/n8n-workflows-cli.ts backup [--output <dir>] [--all]",
      "  ts-node src/n8n-workflows-cli.ts restore [--input <dir>]",
      "  ts-node src/n8n-workflows-cli.ts organize [--input <dir>]",
      "  ts-node src/n8n-workflows-cli.ts tree [--all] [extra n8n flags]",
      "",
      "Examples:",
      "  Backup all workflows (pretty, separate files) into ./workflows (excluding archived workflows):",
      "    ts-node src/n8n-workflows-cli.ts backup",
      "  Backup to a custom directory:",
      "    ts-node src/n8n-workflows-cli.ts backup --output ./backups/latest",
      "  Restore from ./workflows (selective restore; only new/changed workflows are imported):",
      "    ts-node src/n8n-workflows-cli.ts restore",
      "  Restore from a custom directory:",
      "    ts-node src/n8n-workflows-cli.ts restore --input ./backups/latest",
      "",
      "  Organize workflows in ./workflows/ into tag-based subdirectories based on filenames:",
      "    ts-node src/n8n-workflows-cli.ts organize",
      "  Organize a different directory:",
      "    ts-node src/n8n-workflows-cli.ts organize --input ./backups/latest",
      "",
      "  Print logical n8n workflow folders and workflows (uses local n8n CLI):",
      "    ts-node src/n8n-workflows-cli.ts tree --all",
      "    ts-node src/n8n-workflows-cli.ts tree --all --active",
    ].join("\n")
  );
}

export function resolveDir(flagName: "--output" | "--input", argv: string[], fallback: string): string {
  const index = argv.indexOf(flagName);

  if (index !== -1 && argv[index + 1]) {
    return require("path").resolve(argv[index + 1]);
  }

  return require("path").resolve(fallback);
}

