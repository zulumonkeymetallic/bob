import os
import json
import time
from google.cloud import firestore

# Initialize Firestore
db = firestore.Client()
TASK_QUEUE_FILE = os.path.expanduser("~/.hermes/task_queue.json")

def sync_tasks():
    print("Polling delegated_tasks...")
    tasks_ref = db.collection("delegated_tasks")
    query = tasks_ref.where("status", "==", "pending")
    
    tasks = []
    for doc in query.stream():
        task = doc.to_dict()
        task["id"] = doc.id
        tasks.append(task)
        
        # Update status to in_progress
        doc.reference.update({"status": "in_progress"})
        print(f"Locked task: {doc.id}")
    
    if tasks:
        with open(TASK_QUEUE_FILE, "w") as f:
            json.dump(tasks, f, indent=2)
        print(f"Saved {len(tasks)} tasks to {TASK_QUEUE_FILE}")

if __name__ == "__main__":
    sync_tasks()
