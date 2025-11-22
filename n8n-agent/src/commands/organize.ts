import path from "path";
import fs from "fs";
import { resolveDir } from "../utils/args";
import { parseTagFromName } from "../utils/workflow";

export async function executeOrganize(flags: string[]): Promise<void> {
  const inputDir = resolveDir("--input", flags, "./workflows");
  await organizeWorkflows(inputDir);
  process.exit(0);
}

async function organizeWorkflows(baseDir: string): Promise<void> {
  let entries: string[];

  try {
    entries = await fs.promises.readdir(baseDir);
  } catch (err) {
    console.error(`Failed to read workflows directory "${baseDir}":`, err);
    process.exit(1);
  }

  const jsonFiles = entries.filter((file) => file.toLowerCase().endsWith(".json"));

  for (const file of jsonFiles) {
    const fullPath = path.join(baseDir, file);
    const nameWithoutExt = file.replace(/\.json$/i, "");
    const { tag } = parseTagFromName(nameWithoutExt);

    if (!tag) {
      continue;
    }

    const targetDir = path.join(baseDir, tag);

    try {
      await fs.promises.mkdir(targetDir, { recursive: true });
    } catch (err) {
      console.warn(`Warning: Failed to create directory "${targetDir}":`, err);
      continue;
    }

    const targetPath = path.join(targetDir, file);

    if (targetPath === fullPath) {
      continue;
    }

    try {
      // If a file already exists at the target path, skip to avoid overwriting.
      const existingStat = await fs.promises
        .stat(targetPath)
        .catch(() => undefined as unknown as fs.Stats | undefined);

      if (existingStat && existingStat.isFile()) {
        console.warn(
          `Warning: Skipping move of "${fullPath}" to "${targetPath}" because the target file already exists.`
        );
        continue;
      }
    } catch {
      // Ignore stat errors; we'll attempt to move below.
    }

    try {
      await fs.promises.rename(fullPath, targetPath);
      console.log(`Moved "${fullPath}" -> "${targetPath}"`);
    } catch (err) {
      console.warn(`Warning: Failed to move "${fullPath}" to "${targetPath}":`, err);
    }
  }
}

