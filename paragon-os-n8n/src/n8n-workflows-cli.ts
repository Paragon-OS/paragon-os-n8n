import { parseArgs } from "./utils/args";
import { executeBackup } from "./commands/backup";
import { executeRestore } from "./commands/restore";
import { executeTree } from "./commands/tree";
import { executeOrganize } from "./commands/organize";

async function main() {
  const { command, flags } = parseArgs(process.argv);

  switch (command) {
    case "backup":
      await executeBackup(flags);
      break;
    case "restore":
      await executeRestore(flags);
      break;
    case "tree":
      await executeTree(flags);
      break;
    case "organize":
      await executeOrganize(flags);
      break;
  }
}

main().catch((err) => {
  console.error("Error running n8n workflows CLI:", err);
  process.exit(1);
});
