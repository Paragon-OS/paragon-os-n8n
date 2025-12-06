import path from "path";
import fs from "fs";
import { resolveDir } from "../cli";
import { parseTagFromName } from "../utils/workflow";
import { logger } from "../utils/logger";

interface OrganizeOptions {
  input?: string;
}

export async function executeOrganize(options: OrganizeOptions): Promise<void> {
  const inputDir = resolveDir(options.input, "./workflows");
  await organizeWorkflows(inputDir);
  process.exit(0);
}

async function organizeWorkflows(baseDir: string): Promise<void> {
  let entries: string[];

  try {
    entries = await fs.promises.readdir(baseDir);
  } catch (err) {
    logger.error(`Failed to read workflows directory "${baseDir}"`, err, { baseDir });
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
      logger.warn("Failed to create directory", { targetDir }, err);
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
        logger.warn("Skipping move because target file already exists", { from: fullPath, to: targetPath });
        continue;
      }
    } catch {
      // Ignore stat errors; we'll attempt to move below.
    }

    try {
      await fs.promises.rename(fullPath, targetPath);
      logger.info(`Moved "${fullPath}" -> "${targetPath}"`, { from: fullPath, to: targetPath });
    } catch (err) {
      logger.warn("Failed to move file", { from: fullPath, to: targetPath }, err);
    }
  }
}

