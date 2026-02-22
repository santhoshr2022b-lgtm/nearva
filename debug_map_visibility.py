
import httpx
import asyncio
import os
from dotenv import load_dotenv

load_dotenv()

async def check_workers():
    print("--- 🔍 Checking Local API (Fix Verification) ---")
    async with httpx.AsyncClient() as client:
        # Call the LOCAL API on test port 8001
        url = "http://127.0.0.1:8001/api/workers"
        try:
            response = await client.get(url)
            print(f"Response Status: {response.status_code}")
            
            if response.status_code == 200:
                workers = response.json()
                print(f"Total Workers Returned: {len(workers)}")
                for w in workers:
                     print(f"Worker: {w['name']} | Avail: {w['availability']} | is_online: {w.get('is_online')} (Type: {type(w.get('is_online'))})")
            else:
                print(f"Error: {response.text}")
        except Exception as e:
            print(f"Connection failed: {e}")
            print("Make sure uvicorn is running!")

if __name__ == "__main__":
    asyncio.run(check_workers())
