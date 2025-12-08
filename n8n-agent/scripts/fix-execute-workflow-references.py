#!/usr/bin/env python3
"""
Fix executeWorkflow node references that use names instead of IDs

This script fixes the issue where executeWorkflow nodes (not toolWorkflow) have:
- value: workflow name (should be ID)
- cachedResultUrl: /workflow/slug (should be /workflow/ID)

This is different from the toolWorkflow issue - this affects regular Execute Workflow nodes.
"""

import sqlite3
import json
import os
from pathlib import Path
from typing import Dict, List, Tuple

DB_PATH = Path.home() / '.n8n' / 'database.sqlite'

def get_workflow_id_map(cursor) -> Dict[str, str]:
    """Build a map of workflow names to IDs"""
    cursor.execute('SELECT id, name FROM workflow_entity')
    return {name: wf_id for wf_id, name in cursor.fetchall()}

def fix_execute_workflow_references():
    print('🔧 Fixing executeWorkflow node references...\n')
    
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()
    
    try:
        # Get workflow name -> ID mapping
        workflow_map = get_workflow_id_map(cursor)
        print(f'📋 Found {len(workflow_map)} workflows in database\n')
        
        # Get all workflows
        cursor.execute('SELECT id, name, nodes FROM workflow_entity')
        workflows = cursor.fetchall()
        
        total_fixed = 0
        fixed_workflows = []
        
        for workflow_id, workflow_name, nodes_json in workflows:
            try:
                nodes = json.loads(nodes_json)
            except json.JSONDecodeError:
                continue
            
            workflow_modified = False
            
            for node in nodes:
                # Check executeWorkflow nodes (not toolWorkflow)
                if node.get('type') == 'n8n-nodes-base.executeWorkflow':
                    workflow_ref = node.get('parameters', {}).get('workflowId', {})
                    
                    if not isinstance(workflow_ref, dict) or not workflow_ref.get('__rl'):
                        continue
                    
                    value = workflow_ref.get('value', '')
                    cached_url = workflow_ref.get('cachedResultUrl', '')
                    
                    # Skip dynamic expressions (they're intentional)
                    if value.startswith('={{') or '{{' in value:
                        continue
                    
                    # Check if value is a name (not an ID)
                    # IDs are typically 16-20 chars of alphanumeric
                    # Names contain spaces, brackets, etc.
                    is_name = ' ' in value or '[' in value or len(value) > 50
                    
                    # Check if cachedResultUrl is wrong (doesn't contain the ID)
                    url_is_wrong = cached_url and not any(
                        wf_id in cached_url for wf_id in workflow_map.values()
                    )
                    
                    if is_name or url_is_wrong:
                        # Try to find the workflow ID
                        target_id = workflow_map.get(value)
                        
                        if target_id:
                            print(f'📝 {workflow_name} / {node["name"]}')
                            print(f'   Old value: {value}')
                            print(f'   Old URL: {cached_url}')
                            print(f'   New value: {target_id}')
                            print(f'   New URL: /workflow/{target_id}')
                            
                            workflow_ref['value'] = target_id
                            workflow_ref['cachedResultUrl'] = f'/workflow/{target_id}'
                            
                            workflow_modified = True
                            total_fixed += 1
                            print(f'   ✅ Fixed\n')
                        else:
                            # Only warn if it's not in LAB/LEGACY folders (those are WIP)
                            if not any(x in workflow_name for x in ['[LAB]', '[LEGACY]', 'Legacy']):
                                print(f'⚠️  {workflow_name} / {node["name"]}')
                                print(f'   Could not find workflow: {value}')
                                print(f'   This workflow may not exist in the database\n')
            
            if workflow_modified:
                updated_nodes = json.dumps(nodes)
                cursor.execute('UPDATE workflow_entity SET nodes = ? WHERE id = ?', 
                             (updated_nodes, workflow_id))
                fixed_workflows.append(workflow_name)
        
        conn.commit()
        
        print('\n' + '=' * 60)
        print(f'✨ Fixed {total_fixed} executeWorkflow node(s) in {len(fixed_workflows)} workflow(s)')
        
        if fixed_workflows:
            print('\n📋 Modified workflows:')
            for name in fixed_workflows:
                print(f'   - {name}')
            print('\n⚠️  IMPORTANT: Restart n8n for changes to take effect!')
        else:
            print('\n✅ No issues found - all executeWorkflow nodes have correct references')
        
    finally:
        conn.close()

if __name__ == '__main__':
    fix_execute_workflow_references()

