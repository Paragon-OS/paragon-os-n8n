import { confirm } from "../cli";
import { exportWorkflows, deleteWorkflow } from "../utils/n8n-api";
import { logger } from "../utils/logger";

interface DeleteAllOptions {
  yes?: boolean;
}

export async function executeDeleteAll(options: DeleteAllOptions): Promise<void> {
  logger.info("🗑️  Delete All Workflows");
  logger.info("   This will permanently delete ALL workflows from your n8n instance.\n");

  const confirmed = await confirm(
    "⚠️  WARNING: This will delete ALL workflows. This action cannot be undone. Continue?",
    options.yes || false
  );

  if (!confirmed) {
    logger.info("Delete operation cancelled.");
    process.exit(0);
  }

  logger.info(""); // Empty line after confirmation

  try {
    // Get all workflows
    logger.info("Fetching workflows from n8n...");
    const workflows = await exportWorkflows();

    if (workflows.length === 0) {
      logger.info("No workflows found. Nothing to delete.");
      process.exit(0);
    }

    logger.info(`Found ${workflows.length} workflow(s) to delete.\n`);

    // Skip test deletion - proceed directly with bulk deletion
    // 404 errors will be treated as success (workflow already deleted)

    // Delete workflows in batches to avoid overwhelming the API
    const batchSize = 50;
    let deletedCount = 0;
    let failedCount = 0;
    const failedWorkflows: Array<{ id: string; name: string; error: string }> = [];

    for (let i = 0; i < workflows.length; i += batchSize) {
      const batch = workflows.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(workflows.length / batchSize);
      
      logger.info(`Processing batch ${batchNum}/${totalBatches} (${batch.length} workflows)...`);

      for (const workflow of batch) {
        // Handle different possible ID field names (id, workflowId, etc.)
        const workflowId = workflow.id || (workflow as { workflowId?: string }).workflowId || (workflow as { _id?: string })._id;
        const workflowName = workflow.name || workflowId || "unnamed-workflow";

        if (!workflowId || typeof workflowId !== 'string') {
          failedCount++;
          const errorMessage = "Workflow missing ID";
          failedWorkflows.push({
            id: "unknown",
            name: workflowName,
            error: errorMessage,
          });
          // Log the workflow structure for debugging (first 500 chars)
          const workflowStr = JSON.stringify(workflow, null, 2);
          logger.debug(`Workflow structure (first 500 chars): ${workflowStr.substring(0, 500)}`);
          logger.error(`✗ Skipping workflow without ID: ${workflowName}`, undefined, { 
            workflowKeys: Object.keys(workflow).join(', '),
            hasId: 'id' in workflow,
            hasWorkflowId: 'workflowId' in workflow,
          });
          continue;
        }

        try {
          logger.info(`Deleting: ${workflowName} (${workflowId})...`);
          await deleteWorkflow(workflowId);
          deletedCount++;
          logger.info(`✓ Deleted: ${workflowName}`);
        } catch (error) {
          failedCount++;
          const errorMessage = error instanceof Error ? error.message : String(error);
          failedWorkflows.push({
            id: workflowId,
            name: workflowName,
            error: errorMessage,
          });
          logger.error(`✗ Failed to delete: ${workflowName} - ${errorMessage}`);
        }
      }

      // Small delay between batches to avoid rate limiting
      if (i + batchSize < workflows.length) {
        logger.debug(`Waiting 500ms before next batch...`);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Wait a bit for deletions to propagate
    if (deletedCount > 0) {
      logger.info(`\nWaiting 2 seconds for deletions to propagate...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Verify deletions by fetching workflows again
    logger.info("Verifying deletions...");
    let remainingWorkflows: number;
    try {
      const remaining = await exportWorkflows();
      remainingWorkflows = remaining.length;
    } catch (error) {
      logger.warn("Could not verify deletions", error instanceof Error ? error : undefined, {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      remainingWorkflows = -1; // Unknown
    }

    // Summary
    logger.info("\n" + "=".repeat(50));
    logger.info("Delete Summary:");
    logger.info(`  Total workflows found: ${workflows.length}`);
    logger.info(`  Delete requests sent: ${deletedCount}`);
    logger.info(`  Failed requests: ${failedCount}`);
    if (remainingWorkflows >= 0) {
      logger.info(`  Remaining workflows: ${remainingWorkflows}`);
      if (remainingWorkflows > 0 && deletedCount > 0) {
        logger.warn(`⚠️  Warning: ${remainingWorkflows} workflow(s) still exist after deletion.`);
        logger.warn(`   This may indicate the delete operations did not complete successfully.`);
      } else if (remainingWorkflows === 0 && deletedCount > 0) {
        logger.info(`✓ All workflows successfully deleted.`);
      }
    }

    if (failedWorkflows.length > 0) {
      logger.info("\nFailed workflows:");
      for (const failed of failedWorkflows) {
        logger.info(`  - ${failed.name} (${failed.id}): ${failed.error}`);
      }
    }

    // Exit with error if there are remaining workflows or failed deletions
    const exitCode = (failedCount > 0 || (remainingWorkflows > 0 && deletedCount > 0)) ? 1 : 0;
    process.exit(exitCode);
  } catch (error) {
    logger.error("Failed to delete workflows", error instanceof Error ? error : undefined, { 
      errorMessage: error instanceof Error ? error.message : String(error) 
    });
    process.exit(1);
  }
}

