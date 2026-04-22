import os
import subprocess
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn
import json

app = FastAPI()

class TranscriptPayload(BaseModel):
    transcript: str

def process_with_gemma(text: str):
    # Use gemma4 to determine if it's a task/story to be delegated
    prompt = f"""Classify this transcript. Return ONLY a JSON string like:
    {{"intent": "delegate"|"log"|"none", "agent": "Sean"|"Gary"|"Tom"|"Liam"|null, "task": "detailed task description", "title": "short title"}}
    Note: If it sounds like a task/story to be researched or built, set intent to 'delegate'.
    Transcript: '{text}'"""
    cmd = ["ollama", "run", "gemma4:e4b", prompt]
    result = subprocess.run(cmd, capture_output=True, text=True)
    
    # Parse JSON and delegate to the task queue if intent == delegate
    try:
        data = json.loads(result.stdout.strip())
        if data.get("intent") == "delegate":
            # Write to task queue
            with open("/Users/jim/.hermes/task_queue.json", "a") as f:
                json.dump(data, f)
                f.write("\n")
    except Exception as e:
        print(f"Failed to delegate: {e}")
        
    return result.stdout.strip()

@app.post("/webhook/voice")
async def handle_webhook(payload: TranscriptPayload):
    try:
        processed_result = process_with_gemma(payload.transcript)
        print(f"Processed: {processed_result}")
        return {"status": "success", "processed": processed_result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
