import fs from "fs";
import path from "path";

export async function collectJsonFilesRecursive(dir: string): Promise<string[]> {
  let entries: fs.Dirent[];

  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (err) {
    console.warn(`Warning: Failed to read directory "${dir}":`, err);
    return [];
  }

  const results: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectJsonFilesRecursive(fullPath);
      results.push(...nested);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
      results.push(fullPath);
    }
  }

  return results;
}

export async function removeEmptyDirectoriesUnder(rootDir: string): Promise<void> {
  async function removeEmptyRecursive(dir: string, isRoot: boolean): Promise<boolean> {
    let entries: fs.Dirent[];

    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      // If we cannot read the directory, treat it as non-empty to avoid
      // accidental deletions.
      return false;
    }

    let hasFiles = false;

    for (const entry of entries) {
      const childPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        const childEmpty = await removeEmptyRecursive(childPath, false);

        // If the child directory is now empty, attempt to remove it.
        if (childEmpty) {
          try {
            await fs.promises.rmdir(childPath);
          } catch {
            // Ignore failures and continue.
          }
        }
      } else {
        // Any file means the directory is not empty.
        hasFiles = true;
      }
    }

    if (hasFiles) {
      return false;
    }

    // Re-read to see if any children remain (e.g. directories we could not remove).
    try {
      const remaining = await fs.promises.readdir(dir);
      if (remaining.length === 0 && !isRoot) {
        return true;
      }
    } catch {
      // If we fail to re-read, err on the side of not deleting.
    }

    return false;
  }

  await removeEmptyRecursive(rootDir, true);
}

