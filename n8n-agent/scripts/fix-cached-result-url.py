#!/usr/bin/env python3
"""
Fix missing cachedResultUrl in toolWorkflow nodes

This script fixes the issue where toolWorkflow nodes have workflowId references
but are missing the cachedResultUrl field, causing "workflow not found" errors at runtime.
"""

import sqlite3
import json
import os
from pathlib import Path

DB_PATH = Path.home() / '.n8n' / 'database.sqlite'

def fix_cached_result_urls():
    print('🔧 Fixing missing cachedResultUrl in toolWorkflow nodes...\n')
    
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()
    
    try:
        # Get all workflows
        cursor.execute('SELECT id, name, nodes FROM workflow_entity')
        workflows = cursor.fetchall()
        
        total_fixed = 0
        fixed_workflows = []
        
        for workflow_id, workflow_name, nodes_json in workflows:
            try:
                nodes = json.loads(nodes_json)
            except json.JSONDecodeError:
                print(f'⚠️  Skipping {workflow_name} - invalid JSON')
                continue
            
            workflow_modified = False
            
            for node in nodes:
                # Check if this is a toolWorkflow node with a workflowId reference
                if (node.get('type') == '@n8n/n8n-nodes-langchain.toolWorkflow' and 
                    'workflowId' in node.get('parameters', {})):
                    
                    workflow_id_ref = node['parameters']['workflowId']
                    
                    # Check if cachedResultUrl is missing
                    if (workflow_id_ref.get('__rl') and 
                        workflow_id_ref.get('value') and 
                        not workflow_id_ref.get('cachedResultUrl')):
                        
                        print(f'📝 Found missing cachedResultUrl in workflow: {workflow_name}')
                        print(f'   Node: {node["name"]}')
                        print(f'   Referenced workflow ID: {workflow_id_ref["value"]}')
                        
                        # Add the cachedResultUrl
                        workflow_id_ref['cachedResultUrl'] = f'/workflow/{workflow_id_ref["value"]}'
                        workflow_modified = True
                        total_fixed += 1
                        
                        print(f'   ✅ Added: {workflow_id_ref["cachedResultUrl"]}\n')
            
            # Update the workflow if modified
            if workflow_modified:
                updated_nodes = json.dumps(nodes)
                cursor.execute('UPDATE workflow_entity SET nodes = ? WHERE id = ?', 
                             (updated_nodes, workflow_id))
                fixed_workflows.append(workflow_name)
        
        # Commit changes
        conn.commit()
        
        print('\n' + '=' * 60)
        print(f'✨ Fixed {total_fixed} toolWorkflow node(s) in {len(fixed_workflows)} workflow(s)')
        
        if fixed_workflows:
            print('\n📋 Modified workflows:')
            for name in fixed_workflows:
                print(f'   - {name}')
            print('\n⚠️  IMPORTANT: Restart n8n for changes to take effect!')
        else:
            print('\n✅ No issues found - all toolWorkflow nodes have cachedResultUrl')
        
    except Exception as error:
        print(f'❌ Error: {error}')
        raise
    finally:
        conn.close()

if __name__ == '__main__':
    fix_cached_result_urls()

