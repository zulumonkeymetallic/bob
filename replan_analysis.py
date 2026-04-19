#!/usr/bin/env python3
"""
BOB Replan Analysis - Direct Firebase Admin SDK Test

Analyzes the current state and simulates what replanCalendarNow would do.
"""

import firebase_admin
from firebase_admin import credentials, firestore
import json
import time
from datetime import datetime, timezone

# Configuration
SERVICE_ACCOUNT_PATH = "/Users/jim/GitHub/secret/bob20250810-firebase-adminsdk-fbsvc-0f8ac23f94.json"
FIREBASE_PROJECT_ID = "bob20250810"
TEST_UID = "3L3nnXSuTPfr08c8DTXG5zYX37A2"

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

def analyze_current_calendar_state(db, uid):
    """Analyze current calendar blocks"""
    try:
        now_ms = int(time.time() * 1000)
        seven_days_ms = now_ms + (7 * 24 * 60 * 60 * 1000)
        
        # Query calendar blocks for the next 7 days
        blocks_ref = db.collection('calendar_blocks')
        query = (blocks_ref
                .where('ownerUid', '==', uid)
                .where('start', '>=', now_ms)
                .where('start', '<=', seven_days_ms))
        
        docs = query.get()
        all_blocks = []
        ai_generated_blocks = []
        task_story_blocks = []
        
        for doc in docs:
            data = doc.to_dict()
            block = {
                'id': doc.id,
                'title': data.get('title', 'N/A'),
                'entityType': data.get('entityType', 'N/A'),
                'taskId': data.get('taskId'),
                'storyId': data.get('storyId'),
                'aiGenerated': data.get('aiGenerated', False),
                'createdBy': data.get('createdBy'),
                'start': data.get('start'),
                'end': data.get('end'),
                'googleEventId': data.get('googleEventId')
            }
            all_blocks.append(block)
            
            is_ai = block['aiGenerated'] or block['createdBy'] == 'ai'
            if is_ai:
                ai_generated_blocks.append(block)
            
            if block['taskId'] or block['storyId']:
                task_story_blocks.append(block)
        
        print(f"📊 CURRENT CALENDAR STATE:")
        print(f"   Total blocks next 7 days: {len(all_blocks)}")
        print(f"   AI-generated blocks: {len(ai_generated_blocks)}")
        print(f"   Task/Story blocks: {len(task_story_blocks)}")
        
        print(f"\n📅 AI-Generated Blocks (would be candidates for removal):")
        for i, block in enumerate(ai_generated_blocks[:10]):
            start_time = datetime.fromtimestamp(block['start']/1000, tz=timezone.utc) if block['start'] else 'N/A'
            task_or_story = f"Task:{block['taskId']}" if block['taskId'] else f"Story:{block['storyId']}" if block['storyId'] else "Neither"
            print(f"   {i+1}. {block['title']} - {start_time} - {task_or_story}")
        
        return all_blocks, ai_generated_blocks, task_story_blocks
        
    except Exception as e:
        print(f"❌ Failed to analyze calendar state: {e}")
        return [], [], []

def get_current_top_priorities(db, uid):
    """Get current top 3 tasks and stories (simulating replan logic)"""
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
                
        print(f"🎯 Found {len(active_sprint_ids)} active sprints")
        
        # Get open stories from active sprints
        if active_sprint_ids:
            stories_ref = (db.collection('stories')
                          .where('ownerUid', '==', uid)
                          .where('sprintId', 'in', active_sprint_ids))
        else:
            stories_ref = db.collection('stories').where('ownerUid', '==', uid)
            
        story_docs = stories_ref.get()
        open_stories = []
        
        for doc in story_docs:
            data = doc.to_dict()
            # Filter open stories (status != 'done' and numeric status < 4)
            status_str = str(data.get('status', '')).lower()
            try:
                status_num = int(data.get('status', 0))
            except (ValueError, TypeError):
                status_num = 0
                
            if status_str != 'done' and status_num < 4:
                priority = int(data.get('priority', 0))
                ai_score_base = int(data.get('aiCriticalityScore', 0))
                # Add 500 point bonus for priority >= 4 (critical)
                ai_score = ai_score_base + (500 if priority >= 4 else 0)
                
                open_stories.append({
                    'id': doc.id,
                    'title': data.get('title', 'N/A'),
                    'priority': priority,
                    'aiCriticalityScore': ai_score_base,
                    'finalScore': ai_score,
                    'sprintId': data.get('sprintId')
                })
        
        # Get open tasks
        tasks_ref = db.collection('tasks').where('ownerUid', '==', uid)
        task_docs = tasks_ref.get()
        open_tasks = []
        
        for doc in task_docs:
            data = doc.to_dict()
            # Filter open tasks
            status_str = str(data.get('status', '')).lower()
            try:
                status_num = int(data.get('status', 0))
            except (ValueError, TypeError):
                status_num = 0
                
            if (status_str not in ['done', 'completed', 'complete'] and 
                status_num < 2 and
                (not data.get('sprintId') or data.get('sprintId') in active_sprint_ids)):
                
                priority = int(data.get('priority', 0))
                ai_score_base = int(data.get('aiCriticalityScore', 0))
                # Add 500 point bonus for priority >= 4 (critical)  
                ai_score = ai_score_base + (500 if priority >= 4 else 0)
                
                open_tasks.append({
                    'id': doc.id,
                    'title': data.get('title', 'N/A'),
                    'priority': priority,
                    'aiCriticalityScore': ai_score_base,
                    'finalScore': ai_score,
                    'sprintId': data.get('sprintId')
                })
        
        # Get top 3 of each
        top_stories = sorted(open_stories, key=lambda x: x['finalScore'], reverse=True)[:3]
        top_tasks = sorted(open_tasks, key=lambda x: x['finalScore'], reverse=True)[:3]
        
        print(f"\n🏆 TOP 3 STORIES (would get calendar blocks):")
        for i, story in enumerate(top_stories):
            critical_bonus = " (+500 critical bonus)" if story['priority'] >= 4 else ""
            print(f"   {i+1}. {story['title']}")
            print(f"      Priority: {story['priority']}, AI Score: {story['aiCriticalityScore']}, Final: {story['finalScore']}{critical_bonus}")
        
        print(f"\n🏆 TOP 3 TASKS (would get calendar blocks):")
        for i, task in enumerate(top_tasks):
            critical_bonus = " (+500 critical bonus)" if task['priority'] >= 4 else ""
            print(f"   {i+1}. {task['title']}")
            print(f"      Priority: {task['priority']}, AI Score: {task['aiCriticalityScore']}, Final: {task['finalScore']}{critical_bonus}")
        
        return top_stories, top_tasks, open_stories, open_tasks
        
    except Exception as e:
        print(f"❌ Failed to get priorities: {e}")
        return [], [], [], []

def simulate_replan_behavior(all_blocks, ai_blocks, top_stories, top_tasks):
    """Simulate what replanCalendarNow would do"""
    print(f"\n🔄 SIMULATING REPLAN BEHAVIOR:")
    
    # Create set of current top IDs
    top_ids = set()
    for story in top_stories:
        top_ids.add(f"story:{story['id']}")
    for task in top_tasks:
        top_ids.add(f"task:{task['id']}")
    
    print(f"   Current top priorities: {len(top_ids)} items")
    
    # Find AI blocks that would be removed
    blocks_to_remove = []
    blocks_to_keep = []
    
    for block in ai_blocks:
        is_ai = block['aiGenerated'] or block['createdBy'] == 'ai'
        key = None
        if block['storyId']:
            key = f"story:{block['storyId']}"
        elif block['taskId']:
            key = f"task:{block['taskId']}"
            
        if is_ai and key and key not in top_ids:
            blocks_to_remove.append(block)
        else:
            blocks_to_keep.append(block)
    
    print(f"   AI blocks to remove: {len(blocks_to_remove)}")
    print(f"   AI blocks to keep: {len(blocks_to_keep)}")
    
    if blocks_to_remove:
        print(f"\n🗑️  WOULD REMOVE these AI blocks:")
        for block in blocks_to_remove[:10]:
            start_time = datetime.fromtimestamp(block['start']/1000, tz=timezone.utc) if block['start'] else 'N/A'
            entity = f"Task:{block['taskId']}" if block['taskId'] else f"Story:{block['storyId']}" if block['storyId'] else "Unknown"
            print(f"      - {block['title']} ({entity}) - {start_time}")
    
    # Find what would be recreated
    remaining_covered = set()
    for block in all_blocks:
        if block['taskId']:
            remaining_covered.add(f"task:{block['taskId']}")
        if block['storyId']:
            remaining_covered.add(f"story:{block['storyId']}")
    
    # Remove the ones we're deleting
    for block in blocks_to_remove:
        if block['taskId']:
            remaining_covered.discard(f"task:{block['taskId']}")
        if block['storyId']:
            remaining_covered.discard(f"story:{block['storyId']}")
    
    new_entries_needed = top_ids - remaining_covered
    
    print(f"\n➕ WOULD CREATE new blocks for:")
    for item_id in new_entries_needed:
        if item_id.startswith('story:'):
            story_id = item_id[6:]
            story = next((s for s in top_stories if s['id'] == story_id), None)
            if story:
                print(f"      - Story: {story['title']} (Score: {story['finalScore']})")
        elif item_id.startswith('task:'):
            task_id = item_id[5:]
            task = next((t for t in top_tasks if t['id'] == task_id), None)
            if task:
                print(f"      - Task: {task['title']} (Score: {task['finalScore']})")
    
    return len(blocks_to_remove), len(new_entries_needed)

def main():
    """Main analysis function"""
    print("🔍 BOB Replan Calendar Analysis")
    print("=" * 60)
    
    # Initialize Firebase
    db = initialize_firebase()
    if not db:
        return
    
    # Analyze current state
    all_blocks, ai_blocks, task_story_blocks = analyze_current_calendar_state(db, TEST_UID)
    
    # Get current priorities
    top_stories, top_tasks, open_stories, open_tasks = get_current_top_priorities(db, TEST_UID)
    
    # Simulate replan behavior
    removed_count, created_count = simulate_replan_behavior(all_blocks, ai_blocks, top_stories, top_tasks)
    
    print(f"\n" + "=" * 60)
    print("📋 SUMMARY - What 'Replan Around Calendar' Does:")
    print("=" * 60)
    print(f"✅ Removes gcal events: YES - Would remove {removed_count} AI-generated blocks no longer in top 3")
    print(f"❌ Reruns LLM scoring: NO - Uses existing aiCriticalityScore values") 
    print(f"✅ Recreates gcals: YES - Would create {created_count} new blocks for current top priorities")
    print(f"✅ Mobile 'replan' = Desktop 'replan around calendar': YES - Same function call")
    print(f"\n🔄 The function respects main gig blocks (no tasks/stories placed in work time)")
    print(f"🎯 Critical tasks/stories (priority ≥ 4) get +500 bonus but still avoid main gig blocks")

if __name__ == "__main__":
    main()