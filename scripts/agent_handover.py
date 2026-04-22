import os
import json
from google.cloud import firestore

# Initialize Firestore
db = firestore.Client()

def agent_handover(task_id, file_path, drive_link):
    """
    Updates task in Firestore to 'review' status and adds review_url.
    """
    print(f"Handing over task {task_id} with file {file_path}")
    
    # Simulate GDrive upload logic here if needed
    # For now, assuming drive_link is provided or uploaded elsewhere
    
    task_ref = db.collection("delegated_tasks").document(task_id)
    task_ref.update({
        "status": "review",
        "review_url": drive_link,
        "completed_file": file_path
    })
    print(f"Task {task_id} status updated to 'review'.")

if __name__ == "__main__":
    import sys
    if len(sys.argv) < 4:
        print("Usage: python agent_handover.py <task_id> <file_path> <drive_link>")
        sys.exit(1)
        
    agent_handover(sys.argv[1], sys.argv[2], sys.argv[3])
