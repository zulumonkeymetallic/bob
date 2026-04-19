import os
import subprocess
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn

app = FastAPI()

class TranscriptPayload(BaseModel):
    transcript: str

def process_with_gemma(text: str):
    # Call local gemma4 model (e.g., using ollama)
    cmd = ["ollama", "run", "gemma4:e4b", f"Classify, rename, and suggest routing for this note: '{text}'"]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.stdout.strip()

@app.post("/webhook/voice")
async def handle_webhook(payload: TranscriptPayload):
    try:
        processed_result = process_with_gemma(payload.transcript)
        # Placeholder for routing logic
        print(f"Processed: {processed_result}")
        return {"status": "success", "processed": processed_result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
