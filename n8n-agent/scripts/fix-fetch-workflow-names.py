#!/usr/bin/env python3
"""
Fix fetchWorkflowId references that use friendly names instead of actual IDs

The platform config in Context Scout workflows uses friendly names like:
- "TelegramContactFetch" 
- "DiscordGuildFetch"

But these need to be actual workflow IDs. This script creates a mapping and
updates the JavaScript code in the config nodes.
"""

import sqlite3
import json
import re
from pathlib import Path
from typing import Dict

DB_PATH = Path.home() / '.n8n' / 'database.sqlite'

# Mapping of friendly names to actual workflow names in database
FRIENDLY_NAME_TO_WORKFLOW = {
    # Telegram
    'TelegramContactFetch': '[HELPERS] Telegram Contact Fetch',
    'TelegramChatFetch': '[HELPERS] Telegram Chat Fetch',
    'TelegramToolFetch': '[HELPERS] Telegram Tool Fetch',
    'TelegramProfileFetch': '[HELPERS] Telegram Profile Fetch',
    'TelegramMessageFetch': '[HELPERS] Telegram Message Fetch',
    
    # Discord
    'DiscordContactFetch': '[HELPERS] Discord Contact Fetch',
    'DiscordGuildFetch': '[HELPERS] Discord Guild Fetch',
    'DiscordToolFetch': '[HELPERS] Discord Tool Fetch',
    'DiscordProfileFetch': '[HELPERS] Discord Profile Fetch',
}

def get_workflow_id_map(cursor) -> Dict[str, str]:
    """Build a map of workflow names to IDs"""
    cursor.execute('SELECT id, name FROM workflow_entity')
    return {name: wf_id for wf_id, name in cursor.fetchall()}

def fix_fetch_workflow_names():
    print('🔧 Fixing fetchWorkflowId friendly names to actual IDs...\n')
    
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()
    
    try:
        # Get workflow name -> ID mapping
        workflow_map = get_workflow_id_map(cursor)
        
        # Build friendly name -> ID mapping
        friendly_to_id = {}
        for friendly, workflow_name in FRIENDLY_NAME_TO_WORKFLOW.items():
            workflow_id = workflow_map.get(workflow_name)
            if workflow_id:
                friendly_to_id[friendly] = workflow_id
                print(f'📋 {friendly} → {workflow_id} ({workflow_name})')
            else:
                print(f'⚠️  Could not find workflow: {workflow_name}')
        
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
            
            for node in nodes:
                # Check Code nodes that might contain platform config
                if node.get('type') == 'n8n-nodes-base.code':
                    js_code = node.get('parameters', {}).get('jsCode', '')
                    
                    # Check if this contains fetchWorkflowId references
                    if 'fetchWorkflowId' in js_code:
                        original_code = js_code
                        
                        # Replace each friendly name with actual ID
                        for friendly, actual_id in friendly_to_id.items():
                            # Match patterns like: fetchWorkflowId: "TelegramContactFetch"
                            pattern = f'fetchWorkflowId:\\s*["\']({friendly})["\']'
                            if re.search(pattern, js_code):
                                js_code = re.sub(pattern, f'fetchWorkflowId: "{actual_id}"', js_code)
                                print(f'📝 {workflow_name} / {node["name"]}')
                                print(f'   Replaced: {friendly} → {actual_id}')
                                workflow_modified = True
                                total_fixed += 1
                        
                        if js_code != original_code:
                            node['parameters']['jsCode'] = js_code
            
            if workflow_modified:
                updated_nodes = json.dumps(nodes)
                cursor.execute('UPDATE workflow_entity SET nodes = ? WHERE id = ?', 
                             (updated_nodes, workflow_id))
                fixed_workflows.append(workflow_name)
                print(f'   ✅ Fixed\n')
        
        conn.commit()
        
        print('\n' + '=' * 60)
        print(f'✨ Fixed {total_fixed} fetchWorkflowId reference(s) in {len(fixed_workflows)} workflow(s)')
        
        if fixed_workflows:
            print('\n📋 Modified workflows:')
            for name in fixed_workflows:
                print(f'   - {name}')
            print('\n⚠️  IMPORTANT: Restart n8n for changes to take effect!')
            print('\n💡 TIP: You may also want to update your local JSON files:')
            print('   npm run n8n:workflows:downsync')
        else:
            print('\n✅ No issues found - all fetchWorkflowId references use actual IDs')
        
    finally:
        conn.close()

if __name__ == '__main__':
    fix_fetch_workflow_names()

