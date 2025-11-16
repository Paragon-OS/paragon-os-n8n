import { spawn } from "child_process";
import path from "path";

type Command = "backup" | "restore";

interface ParsedArgs {
  command: Command;
  flags: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const [, , commandArg, ...rest] = argv;

  if (commandArg !== "backup" && commandArg !== "restore") {
    printUsage();
    process.exit(1);
  }

  return {
    command: commandArg,
    flags: rest,
  };
}

function printUsage() {
  console.log(
    [
      "Usage:",
      "  ts-node src/n8n-workflows-cli.ts backup [--output <dir>] [--all]",
      "  ts-node src/n8n-workflows-cli.ts restore [--input <dir>]",
      "",
      "Examples:",
      "  Backup all workflows (pretty, separate files) into ./workflows:",
      "    ts-node src/n8n-workflows-cli.ts backup",
      "  Backup to a custom directory:",
      "    ts-node src/n8n-workflows-cli.ts backup --output ./backups/latest",
      "  Restore from ./workflows:",
      "    ts-node src/n8n-workflows-cli.ts restore",
      "  Restore from a custom directory:",
      "    ts-node src/n8n-workflows-cli.ts restore --input ./backups/latest",
    ].join("\n")
  );
}

function resolveDir(flagName: "--output" | "--input", argv: string[], fallback: string): string {
  const index = argv.indexOf(flagName);

  if (index !== -1 && argv[index + 1]) {
    return path.resolve(argv[index + 1]);
  }

  return path.resolve(fallback);
}

function runN8n(args: string[]): Promise<number> {
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

async function main() {
  const { command, flags } = parseArgs(process.argv);

  if (command === "backup") {
    const outputDir = resolveDir("--output", flags, "./workflows");

    // Mirrors: n8n export:workflow --backup --output=./workflows/
    const args = ["export:workflow", "--backup", `--output=${outputDir}`];

    // Allow extra flags like --all to be forwarded.
    const passthroughFlags = flags.filter(
      (f) => !["--output"].includes(f) && !["backup", "restore"].includes(f)
    );

    const exitCode = await runN8n([...args, ...passthroughFlags]);
    process.exit(exitCode);
  }

  if (command === "restore") {
    const inputDir = resolveDir("--input", flags, "./workflows");

    // For directory-based restore we use --separate.
    // Equivalent to: n8n import:workflow --separate --input=./workflows/
    const args = ["import:workflow", "--separate", `--input=${inputDir}`];

    const passthroughFlags = flags.filter(
      (f) => !["--input"].includes(f) && !["backup", "restore"].includes(f)
    );

    const exitCode = await runN8n([...args, ...passthroughFlags]);
    process.exit(exitCode);
  }
}

main().catch((err) => {
  console.error("Error running n8n workflows CLI:", err);
  process.exit(1);
});


