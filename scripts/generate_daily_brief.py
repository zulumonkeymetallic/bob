#!/bin/bash
# generate_daily_brief.py
import json
import subprocess
import os

def get_snapshot():
    try:
        with open(os.path.expanduser("~/.hermes/data/bob_snapshot/latest_snapshot.json"), 'r') as f:
            return json.load(f)
    except:
        return {"error": "Snapshot missing"}

def get_backup_status():
    log_dir = os.path.expanduser("~/BOB-Backups/logs/")
    # Get most recent log
    try:
        latest = sorted([f for f in os.listdir(log_dir)], reverse=True)[0]
        with open(os.path.join(log_dir, latest), 'r') as f:
            return f.read()[-500:] # Last 500 chars
    except:
        return "No recent backup logs found."

def run_gemma(prompt):
    try:
        result = subprocess.run(['ollama', 'run', 'gemma4:e4b'], input=prompt, capture_output=True, text=True, timeout=30)
        return result.stdout
    except:
        # Fallback to Gemini Lite via helper
        return "Fallback: Gemini Lite analysis..."

snapshot = get_snapshot()
backup = get_backup_status()

prompt = f"""
Analyze this data and create a 300-word daily briefing for a high-performance personal OS.
Data: {json.dumps(snapshot)}
Backup Log: {backup}

Include: 
1. Top 3 Priorities (Stories/Tasks).
2. Health/Recovery assessment.
3. Discretionary spend insight.
4. Backup status.
"""

print(run_gemma(prompt))
