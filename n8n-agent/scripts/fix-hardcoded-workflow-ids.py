#!/usr/bin/env python3
"""
Fix hardcoded workflow IDs that no longer exist

This script finds and replaces old/invalid workflow IDs with the correct current IDs.
Useful when workflows are deleted and recreated with new IDs.
"""

import sqlite3
import json
from pathlib import Path
from typing import Dict

DB_PATH = Path.home() / '.n8n' / 'database.sqlite'

# Map of old IDs to new IDs (or workflow names to look up)
ID_REPLACEMENTS = {
    'zZfQPFI7JkUjGspq': '[HELPERS] Global Cache System',  # Old Global Cache System ID
    'IZa7S90Z9W1qxysr': '[HELPERS] Dynamic RAG',  # Old Dynamic RAG ID
}

def get_workflow_id_by_name(cursor, name: str) -> str:
    """Get workflow ID by name"""
    cursor.execute('SELECT id FROM workflow_entity WHERE name = ?', (name,))
    result = cursor.fetchone()
    return result[0] if result else None

def fix_hardcoded_ids():
    print('🔧 Fixing hardcoded workflow IDs...\n')
    
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()
    
    try:
        # Build the replacement map with actual IDs
        replacements = {}
        for old_id, name_or_new_id in ID_REPLACEMENTS.items():
            if name_or_new_id.startswith('[') or ' ' in name_or_new_id:
                # It's a workflow name, look up the ID
                new_id = get_workflow_id_by_name(cursor, name_or_new_id)
                if new_id:
                    replacements[old_id] = new_id
                    print(f'📋 Mapping: {old_id} → {new_id} ({name_or_new_id})')
                else:
                    print(f'⚠️  Could not find workflow: {name_or_new_id}')
            else:
                # It's already an ID
                replacements[old_id] = name_or_new_id
        
        print()
        
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
            nodes_str = json.dumps(nodes)
            
            # Check if any old IDs are in the workflow
            for old_id, new_id in replacements.items():
                if old_id in nodes_str:
                    print(f'📝 {workflow_name}')
                    print(f'   Replacing {old_id} → {new_id}')
                    
                    # Replace in the JSON string
                    nodes_str = nodes_str.replace(old_id, new_id)
                    workflow_modified = True
                    total_fixed += 1
            
            if workflow_modified:
                # Parse back and update
                nodes = json.loads(nodes_str)
                updated_nodes = json.dumps(nodes)
                cursor.execute('UPDATE workflow_entity SET nodes = ? WHERE id = ?', 
                             (updated_nodes, workflow_id))
                fixed_workflows.append(workflow_name)
                print(f'   ✅ Fixed\n')
        
        conn.commit()
        
        print('\n' + '=' * 60)
        print(f'✨ Fixed {total_fixed} reference(s) in {len(fixed_workflows)} workflow(s)')
        
        if fixed_workflows:
            print('\n📋 Modified workflows:')
            for name in fixed_workflows:
                print(f'   - {name}')
            print('\n⚠️  IMPORTANT: Restart n8n for changes to take effect!')
        else:
            print('\n✅ No issues found - all workflow IDs are current')
        
    finally:
        conn.close()

if __name__ == '__main__':
    fix_hardcoded_ids()

