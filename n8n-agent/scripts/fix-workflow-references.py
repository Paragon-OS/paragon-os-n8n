#!/usr/bin/env python3
"""
n8n Workflow Reference Fixer - All-in-One

Fixes all common workflow reference issues in n8n SQLite database:
1. Missing cachedResultUrl in toolWorkflow nodes
2. Wrong references in executeWorkflow nodes (names instead of IDs)
3. Hardcoded old workflow IDs
4. Friendly names in fetchWorkflowId configs

Usage:
    python3 fix-workflow-references.py [--check-only]
"""

import sqlite3
import json
import re
import sys
from pathlib import Path
from typing import Dict, List, Tuple

DB_PATH = Path.home() / '.n8n' / 'database.sqlite'

# Hardcoded ID replacements (old ID -> workflow name or new ID)
ID_REPLACEMENTS = {
    'zZfQPFI7JkUjGspq': '[HELPERS] Global Cache System',
    'IZa7S90Z9W1qxysr': '[HELPERS] Dynamic RAG',
}

# Friendly name to workflow name mappings
FRIENDLY_NAME_TO_WORKFLOW = {
    'TelegramContactFetch': '[HELPERS] Telegram Contact Fetch',
    'TelegramChatFetch': '[HELPERS] Telegram Chat Fetch',
    'TelegramToolFetch': '[HELPERS] Telegram Tool Fetch',
    'TelegramProfileFetch': '[HELPERS] Telegram Profile Fetch',
    'TelegramMessageFetch': '[HELPERS] Telegram Message Fetch',
    'DiscordContactFetch': '[HELPERS] Discord Contact Fetch',
    'DiscordGuildFetch': '[HELPERS] Discord Guild Fetch',
    'DiscordToolFetch': '[HELPERS] Discord Tool Fetch',
    'DiscordProfileFetch': '[HELPERS] Discord Profile Fetch',
}

def get_workflow_maps(cursor) -> Tuple[Dict[str, str], Dict[str, str]]:
    """Get workflow name->ID and ID->name mappings"""
    cursor.execute('SELECT id, name FROM workflow_entity')
    results = cursor.fetchall()
    name_to_id = {name: wf_id for wf_id, name in results}
    id_to_name = {wf_id: name for wf_id, name in results}
    return name_to_id, id_to_name

def fix_all_issues(check_only=False):
    """Fix all workflow reference issues"""
    
    print('🔧 n8n Workflow Reference Fixer\n')
    print('=' * 60)
    
    if check_only:
        print('🔍 CHECK MODE - No changes will be made\n')
    
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()
    
    try:
        # Get workflow mappings
        name_to_id, id_to_name = get_workflow_maps(cursor)
        
        # Build replacement maps
        id_replacements = {}
        for old_id, name_or_new_id in ID_REPLACEMENTS.items():
            if name_or_new_id in name_to_id:
                id_replacements[old_id] = name_to_id[name_or_new_id]
            else:
                id_replacements[old_id] = name_or_new_id
        
        friendly_to_id = {}
        for friendly, workflow_name in FRIENDLY_NAME_TO_WORKFLOW.items():
            if workflow_name in name_to_id:
                friendly_to_id[friendly] = name_to_id[workflow_name]
        
        # Get all workflows
        cursor.execute('SELECT id, name, nodes FROM workflow_entity')
        workflows = cursor.fetchall()
        
        total_issues = 0
        fixed_workflows = set()
        
        for workflow_id, workflow_name, nodes_json in workflows:
            try:
                nodes = json.loads(nodes_json)
            except json.JSONDecodeError:
                continue
            
            workflow_modified = False
            
            for node in nodes:
                node_type = node.get('type', '')
                
                # Fix 1: toolWorkflow nodes - missing cachedResultUrl
                if node_type == '@n8n/n8n-nodes-langchain.toolWorkflow':
                    workflow_ref = node.get('parameters', {}).get('workflowId', {})
                    if (workflow_ref.get('__rl') and 
                        workflow_ref.get('value') and 
                        not workflow_ref.get('cachedResultUrl')):
                        
                        print(f'📝 [toolWorkflow] {workflow_name} / {node["name"]}')
                        print(f'   Adding cachedResultUrl: /workflow/{workflow_ref["value"]}')
                        
                        if not check_only:
                            workflow_ref['cachedResultUrl'] = f'/workflow/{workflow_ref["value"]}'
                            workflow_modified = True
                        
                        total_issues += 1
                
                # Fix 2: executeWorkflow nodes - wrong references
                elif node_type == 'n8n-nodes-base.executeWorkflow':
                    workflow_ref = node.get('parameters', {}).get('workflowId', {})
                    
                    if not isinstance(workflow_ref, dict) or not workflow_ref.get('__rl'):
                        continue
                    
                    value = workflow_ref.get('value', '')
                    
                    # Skip dynamic expressions
                    if value.startswith('={{') or '{{' in value:
                        continue
                    
                    # Check if value is a name (not an ID)
                    is_name = ' ' in value or '[' in value or len(value) > 50
                    
                    if is_name and value in name_to_id:
                        target_id = name_to_id[value]
                        print(f'📝 [executeWorkflow] {workflow_name} / {node["name"]}')
                        print(f'   {value} → {target_id}')
                        
                        if not check_only:
                            workflow_ref['value'] = target_id
                            workflow_ref['cachedResultUrl'] = f'/workflow/{target_id}'
                            workflow_modified = True
                        
                        total_issues += 1
                
                # Fix 3: Code nodes - hardcoded old IDs
                elif node_type == 'n8n-nodes-base.code':
                    js_code = node.get('parameters', {}).get('jsCode', '')
                    original_code = js_code
                    
                    # Replace old IDs
                    for old_id, new_id in id_replacements.items():
                        if old_id in js_code:
                            print(f'📝 [hardcoded ID] {workflow_name} / {node["name"]}')
                            print(f'   {old_id} → {new_id}')
                            
                            if not check_only:
                                js_code = js_code.replace(old_id, new_id)
                                workflow_modified = True
                            
                            total_issues += 1
                    
                    # Replace friendly names in fetchWorkflowId
                    for friendly, actual_id in friendly_to_id.items():
                        pattern = f'fetchWorkflowId:\\s*["\']({friendly})["\']'
                        if re.search(pattern, js_code):
                            print(f'📝 [fetchWorkflowId] {workflow_name} / {node["name"]}')
                            print(f'   {friendly} → {actual_id}')
                            
                            if not check_only:
                                js_code = re.sub(pattern, f'fetchWorkflowId: "{actual_id}"', js_code)
                                workflow_modified = True
                            
                            total_issues += 1
                    
                    if js_code != original_code and not check_only:
                        node['parameters']['jsCode'] = js_code
            
            if workflow_modified:
                updated_nodes = json.dumps(nodes)
                cursor.execute('UPDATE workflow_entity SET nodes = ? WHERE id = ?', 
                             (updated_nodes, workflow_id))
                fixed_workflows.add(workflow_name)
        
        if not check_only:
            conn.commit()
        
        print('\n' + '=' * 60)
        print(f'{"🔍 Found" if check_only else "✨ Fixed"} {total_issues} issue(s) in {len(fixed_workflows)} workflow(s)')
        
        if fixed_workflows:
            print('\n📋 Affected workflows:')
            for name in sorted(fixed_workflows):
                print(f'   - {name}')
            
            if not check_only:
                print('\n⚠️  IMPORTANT: Restart n8n for changes to take effect!')
        else:
            print('\n✅ No issues found - all workflows are properly configured')
        
    finally:
        conn.close()

if __name__ == '__main__':
    check_only = '--check-only' in sys.argv or '--dry-run' in sys.argv
    fix_all_issues(check_only)

