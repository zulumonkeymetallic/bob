#!/usr/bin/env python3
"""Send daily brief to Telegram."""
import asyncio
import os

async def main():
    import subprocess
    
    # Generate fresh daily brief
    result = subprocess.run(
        ["python3", "/Users/jim/git/bob/scripts/generate_daily_brief.py"],
        capture_output=True, text=True, timeout=60
    )
    brief = result.stdout.strip() if result.returncode == 0 else "Daily brief generation failed."
    
    from gateway.config import load_gateway_config, Platform
    from tools.send_message_tool import _send_to_platform
    
    config = load_gateway_config()
    platform = Platform.TELEGRAM
    pconfig = config.platforms.get(platform)
    
    print(f"Telegram token present: {bool(pconfig.token)}")
    print(f"Token length: {len(pconfig.token) if pconfig.token else 0}")
    
    # Use home channel (default for cron delivery)
    chat_id = "1420817599"  # J X user ID / home channel
    
    print(f"Sending to Telegram chat_id={chat_id}")
    
    from gateway.platforms.base import BasePlatformAdapter
    media_files, cleaned_message = BasePlatformAdapter.extract_media(brief)
    
    result = await _send_to_platform(
        platform,
        pconfig,
        chat_id,
        cleaned_message,
        thread_id=None,
        media_files=media_files,
    )
    
    print(f"Send result: {result}")
    return result

if __name__ == "__main__":
    asyncio.run(main())
