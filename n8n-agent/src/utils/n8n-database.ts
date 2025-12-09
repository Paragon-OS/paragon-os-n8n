/**
 * Direct n8n Database Access Utility
 * 
 * Allows importing workflows directly into the SQLite database with ID preservation.
 * This bypasses the n8n API limitation where IDs are auto-generated.
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as os from 'os';
import { logger } from './logger';
import type { Workflow } from './n8n-api';

export interface DatabaseConfig {
  dbPath?: string;
}

export interface WorkflowEntity {
  id: string;
  name: string;
  active: boolean;
  nodes: string; // JSON string
  connections: string; // JSON string
  settings: string | null; // JSON string
  staticData: string | null; // JSON string
  pinData: string | null; // JSON string
  versionId: string;
  triggerCount: number;
  meta: string | null; // JSON string
  parentFolderId: string | null;
  createdAt: string;
  updatedAt: string;
  isArchived: boolean;
  versionCounter: number;
  description: string | null;
  activeVersionId: string | null;
}

/**
 * Get the default n8n database path
 */
function getDefaultDbPath(): string {
  return path.join(os.homedir(), '.n8n', 'database.sqlite');
}

/**
 * Create a database connection
 */
export function createDatabaseConnection(config?: DatabaseConfig): Database.Database {
  const dbPath = config?.dbPath || getDefaultDbPath();
  
  try {
    const db = new Database(dbPath);
    // Enable foreign key constraints
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    return db;
  } catch (error) {
    throw new Error(`Failed to connect to n8n database at ${dbPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Check if a workflow with the given ID exists
 */
export function workflowExists(db: Database.Database, workflowId: string): boolean {
  const stmt = db.prepare('SELECT id FROM workflow_entity WHERE id = ?');
  const result = stmt.get(workflowId) as { id: string } | undefined;
  return !!result;
}

/**
 * Get workflow by ID
 */
export function getWorkflowById(db: Database.Database, workflowId: string): WorkflowEntity | null {
  const stmt = db.prepare('SELECT * FROM workflow_entity WHERE id = ?');
  return (stmt.get(workflowId) as WorkflowEntity | undefined) || null;
}

/**
 * Get workflow by name
 */
export function getWorkflowByName(db: Database.Database, name: string): WorkflowEntity | null {
  const stmt = db.prepare('SELECT * FROM workflow_entity WHERE name = ?');
  return (stmt.get(name) as WorkflowEntity | undefined) || null;
}

/**
 * Delete a workflow by ID, handling foreign key constraints
 */
export function deleteWorkflowById(db: Database.Database, workflowId: string): void {
  // Delete related records first (if any)
  // Note: workflow_history has a foreign key with ON DELETE RESTRICT, so we need to check
  
  // Delete workflow tags (if workflow_tags table exists)
  try {
    const deleteTags = db.prepare('DELETE FROM workflow_tags WHERE workflowId = ?');
    deleteTags.run(workflowId);
  } catch (error) {
    // Table might not exist or have different name - that's okay
    logger.debug(`Could not delete workflow tags: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  // Delete workflow executions (if they exist)
  try {
    const deleteExecutions = db.prepare('DELETE FROM execution_entity WHERE workflowId = ?');
    deleteExecutions.run(workflowId);
  } catch (error) {
    // That's okay - executions might be in a different table or not exist
    logger.debug(`Could not delete workflow executions: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  // Delete workflow history entries (handle RESTRICT constraint)
  try {
    // First, set activeVersionId to NULL if it references this workflow's history
    const updateActiveVersion = db.prepare('UPDATE workflow_entity SET activeVersionId = NULL WHERE activeVersionId IN (SELECT versionId FROM workflow_history WHERE workflowId = ?)');
    updateActiveVersion.run(workflowId);
    
    // Then delete history entries
    const deleteHistory = db.prepare('DELETE FROM workflow_history WHERE workflowId = ?');
    deleteHistory.run(workflowId);
  } catch (error) {
    logger.warn(`Could not delete workflow history: ${error instanceof Error ? error.message : String(error)}`);
    // Continue anyway
  }
  
  // Finally, delete the workflow itself
  const deleteWorkflow = db.prepare('DELETE FROM workflow_entity WHERE id = ?');
  const result = deleteWorkflow.run(workflowId);
  
  if (result.changes === 0) {
    logger.warn(`Workflow ${workflowId} not found in database (may have already been deleted)`);
  }
}

/**
 * Generate a new version ID (UUID v4 format)
 */
function generateVersionId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Convert workflow to database entity format
 */
function workflowToEntity(workflow: Workflow, preserveId: boolean = true): Partial<WorkflowEntity> {
  const now = new Date().toISOString().replace('T', ' ').substring(0, 23);
  const versionId = generateVersionId();
  
  return {
    name: workflow.name,
    active: workflow.active ?? false,
    nodes: JSON.stringify(workflow.nodes || []),
    connections: JSON.stringify(workflow.connections || {}),
    settings: workflow.settings ? JSON.stringify(workflow.settings) : null,
    staticData: workflow.staticData ? JSON.stringify(workflow.staticData) : null,
    pinData: workflow.pinData ? JSON.stringify(workflow.pinData) : null,
    versionId,
    triggerCount: 0,
    meta: (workflow as any).meta ? JSON.stringify((workflow as any).meta) : null,
    parentFolderId: null, // Can be set later if needed
    createdAt: (workflow as any).createdAt || now,
    updatedAt: now,
    isArchived: (workflow as any).isArchived ?? false,
    versionCounter: 1,
    description: (workflow as any).description || null,
    activeVersionId: null,
  };
}

/**
 * Import workflow directly into database with ID preservation
 * 
 * @param db Database connection
 * @param workflow Workflow to import
 * @param preserveId If true, use the workflow's ID (will delete existing workflow with that ID if name differs)
 * @returns The imported workflow entity
 */
export function importWorkflowToDatabase(
  db: Database.Database,
  workflow: Workflow,
  preserveId: boolean = true
): WorkflowEntity {
  if (!workflow.id && preserveId) {
    throw new Error('Cannot preserve ID: workflow has no ID');
  }
  
  const workflowId = workflow.id!;
  const entity = workflowToEntity(workflow, preserveId);
  
  // Start transaction
  const transaction = db.transaction(() => {
    // Check if workflow with this ID exists
    const existingById = getWorkflowById(db, workflowId);
    
    if (existingById) {
      // Workflow with this ID exists
      if (existingById.name === workflow.name) {
        // Same name - update it
        logger.debug(`Updating existing workflow "${workflow.name}" with ID ${workflowId}`);
        
        const update = db.prepare(`
          UPDATE workflow_entity 
          SET 
            name = ?,
            active = ?,
            nodes = ?,
            connections = ?,
            settings = ?,
            staticData = ?,
            pinData = ?,
            versionId = ?,
            meta = ?,
            updatedAt = ?,
            isArchived = ?,
            description = ?
          WHERE id = ?
        `);
        
        update.run(
          entity.name,
          entity.active,
          entity.nodes,
          entity.connections ?? null,
          entity.settings ?? null,
          entity.staticData ?? null,
          entity.pinData ?? null,
          entity.versionId,
          entity.meta ?? null,
          entity.updatedAt,
          entity.isArchived ?? false,
          entity.description ?? null,
          workflowId
        );
        
        return getWorkflowById(db, workflowId)!;
      } else {
        // Different name - delete and recreate
        logger.info(`Workflow ID ${workflowId} exists with different name "${existingById.name}". Deleting and recreating as "${workflow.name}"`);
        deleteWorkflowById(db, workflowId);
        // Fall through to insert
      }
    }
    
    // Check if workflow with same name exists (different ID)
    const existingByName = getWorkflowByName(db, workflow.name);
    if (existingByName && existingByName.id !== workflowId) {
      logger.warn(`Workflow with name "${workflow.name}" already exists with ID ${existingByName.id}. Will be replaced by ID ${workflowId}`);
      deleteWorkflowById(db, existingByName.id);
    }
    
    // Insert new workflow
    logger.debug(`Inserting workflow "${workflow.name}" with ID ${workflowId}`);
    
    const insert = db.prepare(`
      INSERT INTO workflow_entity (
        id, name, active, nodes, connections, settings, staticData, pinData,
        versionId, triggerCount, meta, parentFolderId, createdAt, updatedAt,
        isArchived, versionCounter, description, activeVersionId
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    insert.run(
      workflowId,
      entity.name ?? '',
      entity.active ?? false,
      entity.nodes ?? '[]',
      entity.connections ?? '{}',
      entity.settings ?? null,
      entity.staticData ?? null,
      entity.pinData ?? null,
      entity.versionId ?? generateVersionId(),
      entity.triggerCount ?? 0,
      entity.meta ?? null,
      entity.parentFolderId ?? null,
      entity.createdAt ?? new Date().toISOString().replace('T', ' ').substring(0, 23),
      entity.updatedAt ?? new Date().toISOString().replace('T', ' ').substring(0, 23),
      entity.isArchived ?? false,
      entity.versionCounter ?? 1,
      entity.description ?? null,
      entity.activeVersionId ?? null
    );
    
    return getWorkflowById(db, workflowId)!;
  });
  
  try {
    return transaction();
  } catch (error) {
    throw new Error(`Failed to import workflow to database: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Check if database is accessible and n8n is not running
 * (Direct database writes while n8n is running can cause corruption)
 */
export function checkDatabaseSafe(db: Database.Database): { safe: boolean; reason?: string } {
  try {
    // Try to acquire an exclusive lock
    // If n8n is running, this will fail or timeout
    db.pragma('lock_timeout = 1000'); // 1 second timeout
    db.exec('BEGIN EXCLUSIVE');
    db.exec('ROLLBACK');
    return { safe: true };
  } catch (error) {
    return {
      safe: false,
      reason: `Database is locked (n8n may be running): ${error instanceof Error ? error.message : String(error)}`
    };
  }
}
