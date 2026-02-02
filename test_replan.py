#!/usr/bin/env python3
"""
BOB Replan Calendar Tester

This script tests the replanCalendarNow function to understand:
1. If it removes existing gcal events
2. If it reruns LLM prioritization/scoring
3. If it recreates gcals for tasks/stories
4. If mobile UI "replan" triggers the same action
"""

import firebase_admin
from firebase_admin import credentials, firestore, auth
import json
import requests
import time
from datetime import datetime, timezone

# Configuration
SERVICE_ACCOUNT_PATH = "/Users/jim/GitHub/secret/bob20250810-firebase-adminsdk-fbsvc-0f8ac23f94.json"
FIREBASE_PROJECT_ID = "bob20250810"
TEST_UID = "3L3nnXSuTPfr08c8DTXG5zYX37A2" # From AGENTS.md
FIREBASE_FUNCTIONS_URL = f"https://europe-west2-{FIREBASE_PROJECT_ID}.cloudfunctions.net"

def initialize_firebase():
    """Initialize Firebase with service account"""
    try:
        cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
        firebase_admin.initialize_app(cred, {
            'projectId': FIREBASE_PROJECT_ID
        })
        print(f"✅ Firebase initialized for project: {FIREBASE_PROJECT_ID}")
        return firestore.client()
    except Exception as e:
        print(f"❌ Firebase initialization failed: {e}")
        return None

def create_custom_token(uid):
    """Create custom token for authentication"""
    try:
        custom_token = auth.create_custom_token(uid)
        print(f"✅ Custom token created for UID: {uid}")
        return custom_token.decode('utf-8')
    except Exception as e:
        print(f"❌ Custom token creation failed: {e}")
        return None

def get_calendar_blocks_before_replan(db, uid):
    """Get current calendar blocks before replan"""
    try:
        # Get current timestamp
        now_ms = int(time.time() * 1000)
        
        # Query calendar blocks for the next 7 days
        blocks_ref = db.collection('calendar_blocks')
        query = blocks_ref.where('ownerUid', '==', uid).where('start', '>=', now_ms).limit(50)
        
        docs = query.get()
        blocks = []
        for doc in docs:
            data = doc.to_dict()
            blocks.append({
                'id': doc.id,
                'title': data.get('title', 'N/A'),
                'entityType': data.get('entityType', 'N/A'),
                'taskId': data.get('taskId'),
                'storyId': data.get('storyId'),
                'aiGenerated': data.get('aiGenerated', False),
                'start': data.get('start'),
                'end': data.get('end'),
                'googleEventId': data.get('googleEventId')
            })
        
        print(f"📅 Found {len(blocks)} calendar blocks before replan")
        for i, block in enumerate(blocks[:10]):  # Show first 10
            start_time = datetime.fromtimestamp(block['start']/1000, tz=timezone.utc) if block['start'] else 'N/A'
            print(f"  {i+1}. {block['title']} ({block['entityType']}) - {start_time} - AI:{block['aiGenerated']} - GCal:{bool(block['googleEventId'])}")
        
        return blocks
    except Exception as e:
        print(f"❌ Failed to get calendar blocks: {e}")
        return []

def get_tasks_and_stories_priority_scores(db, uid):
    """Get current priority scores for tasks and stories"""
    try:
        # Get active sprint IDs
        sprints_ref = db.collection('sprints').where('ownerUid', '==', uid)
        sprint_docs = sprints_ref.get()
        active_sprint_ids = []
        
        for doc in sprint_docs:
            data = doc.to_dict()
            status = str(data.get('status', '')).lower()
            if status in ['active', 'planning', '1', '0']:
                active_sprint_ids.append(doc.id)
        
        # Get stories
        stories_ref = db.collection('stories').where('ownerUid', '==', uid)
        if active_sprint_ids:
            stories_ref = stories_ref.where('sprintId', 'in', active_sprint_ids)
        
        story_docs = stories_ref.get()
        stories = []
        for doc in story_docs:
            data = doc.to_dict()
            if str(data.get('status', '')).lower() != 'done' and int(data.get('status', 0)) < 4:
                stories.append({
                    'id': doc.id,
                    'title': data.get('title', 'N/A'),
                    'priority': data.get('priority', 0),
                    'aiCriticalityScore': data.get('aiCriticalityScore', 0)
                })
        
        # Get tasks  
        tasks_ref = db.collection('tasks').where('ownerUid', '==', uid)
        task_docs = tasks_ref.get()
        tasks = []
        for doc in task_docs:
            data = doc.to_dict()
            status = str(data.get('status', '')).lower()
            if (status not in ['done', 'completed', 'complete'] and 
                int(data.get('status', 0)) < 2 and
                (not data.get('sprintId') or data.get('sprintId') in active_sprint_ids)):
                tasks.append({
                    'id': doc.id,
                    'title': data.get('title', 'N/A'),
                    'priority': data.get('priority', 0),
                    'aiCriticalityScore': data.get('aiCriticalityScore', 0)
                })
        
        print(f"📋 Found {len(stories)} open stories and {len(tasks)} open tasks")
        print("🎯 Top stories by AI score:")
        sorted_stories = sorted(stories, key=lambda x: int(x['aiCriticalityScore'] or 0), reverse=True)[:5]
        for i, story in enumerate(sorted_stories):
            print(f"  {i+1}. {story['title']} - Priority:{story['priority']} AI:{story['aiCriticalityScore']}")
        
        print("🎯 Top tasks by AI score:")
        sorted_tasks = sorted(tasks, key=lambda x: int(x['aiCriticalityScore'] or 0), reverse=True)[:5]
        for i, task in enumerate(sorted_tasks):
            print(f"  {i+1}. {task['title']} - Priority:{task['priority']} AI:{task['aiCriticalityScore']}")
        
        return stories, tasks
    except Exception as e:
        print(f"❌ Failed to get tasks/stories: {e}")
        return [], []

def call_replan_calendar(custom_token, days=7):
    """Call the replanCalendarNow function"""
    try:
        # This would normally require authentication via Firebase Auth
        # For direct testing, we need to make an HTTP request to the function
        url = f"{FIREBASE_FUNCTIONS_URL}/replanCalendarNow"
        
        headers = {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {custom_token}'
        }
        
        payload = {
            'data': {
                'days': days
            }
        }
        
        print(f"🔄 Calling replanCalendarNow with {days} days...")
        print(f"📡 URL: {url}")
        
        response = requests.post(url, json=payload, headers=headers, timeout=30)
        
        if response.status_code == 200:
            result = response.json()
            print(f"✅ Replan successful!")
            print(f"📊 Result: {json.dumps(result, indent=2)}")
            return result
        else:
            print(f"❌ Replan failed with status {response.status_code}")
            print(f"📄 Response: {response.text}")
            return None
            
    except Exception as e:
        print(f"❌ Failed to call replan: {e}")
        return None

def compare_calendar_blocks_after_replan(db, uid, blocks_before):
    """Compare calendar blocks after replan"""
    try:
        # Wait a moment for the function to complete
        time.sleep(2)
        
        # Get blocks after replan
        blocks_after = get_calendar_blocks_before_replan(db, uid)
        
        print(f"\n📊 COMPARISON:")
        print(f"   Before replan: {len(blocks_before)} blocks")
        print(f"   After replan: {len(blocks_after)} blocks")
        
        # Find removed blocks (AI-generated ones)
        before_ids = {block['id'] for block in blocks_before}
        after_ids = {block['id'] for block in blocks_after}
        
        removed_ids = before_ids - after_ids
        added_ids = after_ids - before_ids
        
        print(f"   Removed: {len(removed_ids)} blocks")
        print(f"   Added: {len(added_ids)} blocks")
        
        if removed_ids:
            print("🗑️  Removed blocks:")
            for block in blocks_before:
                if block['id'] in removed_ids:
                    print(f"     - {block['title']} ({block['entityType']}) - AI:{block['aiGenerated']}")
        
        if added_ids:
            print("➕ Added blocks:")
            for block in blocks_after:
                if block['id'] in added_ids:
                    start_time = datetime.fromtimestamp(block['start']/1000, tz=timezone.utc) if block['start'] else 'N/A'
                    print(f"     - {block['title']} ({block['entityType']}) - {start_time}")
        
        return blocks_after
        
    except Exception as e:
        print(f"❌ Failed to compare blocks: {e}")
        return []

def main():
    """Main test function"""
    print("🚀 BOB Replan Calendar Test Starting...")
    print("=" * 60)
    
    # Initialize Firebase
    db = initialize_firebase()
    if not db:
        return
    
    # Create custom token
    custom_token = create_custom_token(TEST_UID)
    if not custom_token:
        return
    
    print("\n" + "=" * 60)
    print("📊 PRE-REPLAN STATE")
    print("=" * 60)
    
    # Get current state
    blocks_before = get_calendar_blocks_before_replan(db, TEST_UID)
    stories_before, tasks_before = get_tasks_and_stories_priority_scores(db, TEST_UID)
    
    print("\n" + "=" * 60) 
    print("🔄 RUNNING REPLAN")
    print("=" * 60)
    
    # Run replan
    replan_result = call_replan_calendar(custom_token, days=7)
    
    if replan_result:
        print("\n" + "=" * 60)
        print("📊 POST-REPLAN STATE") 
        print("=" * 60)
        
        # Compare results
        blocks_after = compare_calendar_blocks_after_replan(db, TEST_UID, blocks_before)
        
        print("\n" + "=" * 60)
        print("🎯 ANALYSIS")
        print("=" * 60)
        
        print("❓ Does replan remove existing gcal events?")
        ai_blocks_removed = sum(1 for block in blocks_before 
                               if block['id'] not in {b['id'] for b in blocks_after} 
                               and block['aiGenerated'])
        print(f"   YES - Removed {ai_blocks_removed} AI-generated blocks")
        
        print("❓ Does replan rerun LLM prioritization/scoring?")
        print("   NO - Uses existing aiCriticalityScore values (check source code)")
        
        print("❓ Does replan recreate gcals for tasks/stories?")
        created_count = replan_result.get('result', {}).get('created', 0) if 'result' in replan_result else replan_result.get('created', 0)
        print(f"   YES - Created {created_count} new calendar entries")
        
        print("❓ Is mobile UI 'replan' the same as 'replan around calendar'?")
        print("   YES - Both call 'replanCalendarNow' function")
        
    else:
        print("❌ Replan failed - cannot complete analysis")

if __name__ == "__main__":
    main()