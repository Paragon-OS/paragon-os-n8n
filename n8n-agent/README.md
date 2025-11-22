## paragon-os-n8n

This repository contains **n8n workflows** for ParagonOS and a small **TypeScript CLI wrapper** around the `n8n` CLI to make backing up and restoring workflows easy and repeatable.

The goal is to treat your n8n workflows as code: export them into version-controlled JSON files and re-import them reliably into any n8n instance.

---

## Project layout

- `archived/`  
  Archived / legacy workflow exports (JSON) that you may want to keep for reference but not necessarily import by default.

- `workflows/`  
  Current canonical workflow exports. Running the backup command regenerates these JSON files from your n8n instance.

- `src/n8n-workflows-cli.ts`  
  TypeScript wrapper around `n8n export:workflow` and `n8n import:workflow` with `backup` and `restore` subcommands.

- `package.json`  
  npm scripts and dev dependencies (`typescript`, `ts-node`, `@types/node`) used to drive the wrapper.

- `tsconfig.json`  
  Minimal TypeScript configuration for running the CLI via `ts-node`.

---

## Prerequisites

- `n8n` is available on your `PATH` (e.g. globally installed `n8n`, Docker exec into the n8n container, or adapt commands to `npx n8n`).
- Node.js and npm installed.
- Install dependencies:

```bash
npm install
```

---

## CLI wrapper overview

The wrapper exposes four high-level commands:

- **backup**: Export workflows from the connected n8n instance into JSON files (one file per workflow) under a chosen directory.
- **restore**: Import workflows from a directory tree of JSON files into the n8n instance.
- **organize**: Organize existing workflow JSON files into tag-based subdirectories under the workflows directory.
- **tree**: Print a logical folder structure of workflows from the connected n8n instance (using the local n8n CLI).

Internally it shells out to the official n8n CLI:

- **Backup**: `n8n export:workflow --backup --output=<resolvedOutputDir> [extra flags]`
- **Restore**: `n8n import:workflow --separate --input=<filePath> [extra flags]` (called once per JSON file discovered recursively)

Any extra flags you pass (for example `--all`) are forwarded directly to `n8n`.

---

## Backup workflows

Back up all workflows, pretty-printed into separate files under `./workflows`:

```bash
npm run n8n:workflows:backup
```

This is equivalent to running:

```bash
n8n export:workflow --backup --output=./workflows
```

You can choose a different output directory:

```bash
npm run n8n:workflows:backup -- --output ./backups/latest
```

You can also forward any supported n8n flags:

```bash
npm run n8n:workflows:backup -- --output ./workflows --all
```

The JSON files written into `workflows/` (or your chosen directory) are intended to be committed to git so you have a versioned history of your automations.

---

## Restore workflows

Restore from the default `./workflows` directory:

```bash
npm run n8n:workflows:restore
```

Restore from a custom directory:

```bash
npm run n8n:workflows:restore -- --input ./backups/latest
```

Under the hood, the restore command recursively discovers all `.json` files under the chosen directory (for example, `./workflows`, including subdirectories). It then:

- Exports the current workflows from the connected n8n instance.
- Compares each backup workflow (by `id`, when available) against the current instance, ignoring obviously volatile metadata such as timestamps.
- Imports only workflows that are new or have actually changed compared to what is currently running in n8n.

Each selected workflow is imported individually with:

```bash
n8n import:workflow --input=<filePath>
```

Just like backup, any additional flags are forwarded to `n8n import:workflow`. Workflows that exist in n8n but are missing from the backup are left untouched by the restore command.

---

## Tag-based workflow layout

If a workflow name in n8n starts with `[SOME_TAG]`, the backup command will:

- Export it into a JSON file whose name is derived from the full workflow name (including the tag).
- Place that file under a `SOME_TAG/` subdirectory of the chosen output directory (for example, `[LAB] Demo` becomes `workflows/LAB/[LAB] Demo.json`).

Workflows without a leading `[TAG]` prefix continue to be written directly into the root of the output directory (for example, `workflows/My workflow.json`).

The restore command recursively discovers all JSON files, so it will import both tagged and untagged workflows regardless of their folder layout.

To retrofit an existing flat `workflows/` directory into tag-based subdirectories based on filename prefixes, you can run:

```bash
npm run n8n:workflows:restore -- organize
```

This will look for filenames that start with `[TAG]` and move them into corresponding `TAG/` subdirectories (for example, `[LAB] Foo.json` → `workflows/LAB/[LAB] Foo.json`).

---

## Existing scripts

In addition to the new backup/restore commands, `package.json` also defines:

- **sync:n8n:workflows**: `node src/sync-workflows.js`  
  Custom sync logic (not implemented in TypeScript here) that you may already be using to push/pull workflows.

- **sync:n8n:workflows:dry**: `node src/sync-workflows.js --dry-run`  
  Dry-run variant of the sync script.

These scripts can coexist with the new backup/restore wrapper; you can choose whichever best fits your workflow.

