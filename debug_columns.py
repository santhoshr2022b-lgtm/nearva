
import httpx
import asyncio
import os
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json"
}

async def check_columns():
    print("--- 🔍 Checking Table Columns ---")
    async with httpx.AsyncClient() as client:
        # Fetch one worker with all columns
        url = f"{SUPABASE_URL}/rest/v1/workers?select=*&limit=1"
        response = await client.get(url, headers=headers)
        
        if response.status_code == 200:
            workers = response.json()
            if workers:
                print("Columns found:", workers[0].keys())
            else:
                print("Table is empty, cannot check columns easily via REST.")
        else:
            print(f"Error ({response.status_code}): {response.text}")

if __name__ == "__main__":
    asyncio.run(check_columns())
