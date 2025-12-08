#!/usr/bin/env python3
"""
Comprehensive fix for missing cachedResultUrl in toolWorkflow nodes

This script provides two approaches:
1. Direct database fix (fast, requires n8n restart)
2. API-based regeneration (slower, no restart needed, lets n8n handle it)

Usage:
  python3 fix-and-regenerate-cached-urls.py --db-only     # Fast DB fix
  python3 fix-and-regenerate-cached-urls.py --api-only    # API regeneration
  python3 fix-and-regenerate-cached-urls.py               # Both (recommended)
"""

import sqlite3
import json
import os
import sys
import argparse
import subprocess
from pathlib import Path
from typing import List, Tuple

DB_PATH = Path.home() / '.n8n' / 'database.sqlite'

def fix_database_directly() -> Tuple[int, List[str]]:
    """
    Fix missing cachedResultUrl directly in the database.
    Returns: (count_fixed, list_of_workflow_names)
    """
    print('🔧 [DB] Fixing missing cachedResultUrl in database...\n')
    
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()
    
    total_fixed = 0
    fixed_workflows = []
    
    try:
        cursor.execute('SELECT id, name, nodes FROM workflow_entity')
        workflows = cursor.fetchall()
        
        for workflow_id, workflow_name, nodes_json in workflows:
            try:
                nodes = json.loads(nodes_json)
            except json.JSONDecodeError:
                continue
            
            workflow_modified = False
            
            for node in nodes:
                if (node.get('type') == '@n8n/n8n-nodes-langchain.toolWorkflow' and 
                    'workflowId' in node.get('parameters', {})):
                    
                    workflow_id_ref = node['parameters']['workflowId']
                    
                    if (workflow_id_ref.get('__rl') and 
                        workflow_id_ref.get('value') and 
                        not workflow_id_ref.get('cachedResultUrl')):
                        
                        print(f'   📝 {workflow_name} / {node["name"]}')
                        workflow_id_ref['cachedResultUrl'] = f'/workflow/{workflow_id_ref["value"]}'
                        workflow_modified = True
                        total_fixed += 1
            
            if workflow_modified:
                updated_nodes = json.dumps(nodes)
                cursor.execute('UPDATE workflow_entity SET nodes = ? WHERE id = ?', 
                             (updated_nodes, workflow_id))
                fixed_workflows.append(workflow_name)
        
        conn.commit()
        
        print(f'\n   ✅ [DB] Fixed {total_fixed} node(s) in {len(fixed_workflows)} workflow(s)\n')
        
    finally:
        conn.close()
    
    return total_fixed, fixed_workflows


def regenerate_via_api() -> Tuple[int, List[str]]:
    """
    Force n8n to regenerate cachedResultUrl by re-saving workflows via API.
    Returns: (count_regenerated, list_of_workflow_names)
    """
    print('🔄 [API] Forcing n8n to regenerate cachedResultUrl...\n')
    
    try:
        # Check if ts-node is available
        result = subprocess.run(
            ['npx', 'ts-node', '--version'],
            capture_output=True,
            text=True,
            timeout=5
        )
        
        if result.returncode != 0:
            print('   ⚠️  ts-node not available, skipping API regeneration')
            return 0, []
        
        # Run the TypeScript script
        script_path = Path(__file__).parent / 'regenerate-cached-urls.ts'
        
        result = subprocess.run(
            ['npx', 'ts-node', str(script_path)],
            capture_output=True,
            text=True,
            timeout=60
        )
        
        # Print the output
        print(result.stdout)
        if result.stderr:
            print(result.stderr, file=sys.stderr)
        
        if result.returncode != 0:
            print(f'   ❌ [API] Regeneration failed with exit code {result.returncode}')
            return 0, []
        
        # Parse output to get count (simple heuristic)
        # Look for "Triggered regeneration for X workflow(s)"
        import re
        match = re.search(r'Triggered regeneration for (\d+) workflow', result.stdout)
        count = int(match.group(1)) if match else 0
        
        return count, []
        
    except subprocess.TimeoutExpired:
        print('   ⚠️  [API] Regeneration timed out')
        return 0, []
    except Exception as e:
        print(f'   ⚠️  [API] Regeneration failed: {e}')
        return 0, []


def main():
    parser = argparse.ArgumentParser(
        description='Fix missing cachedResultUrl in n8n toolWorkflow nodes'
    )
    parser.add_argument(
        '--db-only',
        action='store_true',
        help='Only fix the database directly (requires n8n restart)'
    )
    parser.add_argument(
        '--api-only',
        action='store_true',
        help='Only regenerate via API (no restart needed)'
    )
    
    args = parser.parse_args()
    
    print('=' * 60)
    print('🔧 n8n cachedResultUrl Fix & Regeneration Tool')
    print('=' * 60 + '\n')
    
    db_fixed = 0
    db_workflows = []
    api_fixed = 0
    api_workflows = []
    
    # Determine which approaches to use
    use_db = not args.api_only
    use_api = not args.db_only
    
    if use_db:
        db_fixed, db_workflows = fix_database_directly()
    
    if use_api:
        api_fixed, api_workflows = regenerate_via_api()
    
    # Summary
    print('\n' + '=' * 60)
    print('📊 Summary')
    print('=' * 60)
    
    if use_db:
        print(f'   [DB]  Fixed: {db_fixed} node(s)')
        if db_workflows:
            for name in db_workflows:
                print(f'         - {name}')
    
    if use_api:
        print(f'   [API] Regenerated: {api_fixed} workflow(s)')
    
    print()
    
    # Recommendations
    if db_fixed > 0 and not use_api:
        print('⚠️  IMPORTANT: Restart n8n for database changes to take effect!')
    elif api_fixed > 0:
        print('✅ Changes applied via API - no restart needed')
    elif db_fixed == 0 and api_fixed == 0:
        print('✅ No issues found - all workflows are properly configured')
    
    print()


if __name__ == '__main__':
    main()

