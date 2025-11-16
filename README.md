## n8n workflows backup/restore wrapper

This project includes a small TypeScript CLI wrapper around the `n8n` CLI to make backing up and restoring workflows easy and repeatable.

### Prerequisites

- `n8n` must be available on your `PATH` (globally installed or via `npx n8n` with appropriate adjustment).
- Dependencies installed:

```bash
npm install
```

### Backup workflows

Back up all workflows, pretty-printed into separate files under `./workflows`:

```bash
npm run n8n:workflows:backup
```

You can choose a different output directory:

```bash
npm run n8n:workflows:backup -- --output ./backups/latest
```

This wraps:

```bash
n8n export:workflow --backup --output=<resolvedOutputDir>
```

Any extra flags (for example `--all`) are forwarded to the `n8n` CLI.

### Restore workflows

Restore from `./workflows`:

```bash
npm run n8n:workflows:restore
```

Restore from a custom directory:

```bash
npm run n8n:workflows:restore -- --input ./backups/latest
```

This wraps:

```bash
n8n import:workflow --separate --input=<resolvedInputDir>
```


