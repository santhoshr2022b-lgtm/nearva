import os
import httpx
import asyncio
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json"
}

async def check_workers():
    url = f"{SUPABASE_URL}/rest/v1/workers?account_status=eq.Approved&select=*"
    async with httpx.AsyncClient() as client:
        response = await client.get(url, headers=headers)
        if response.status_code == 200:
            workers = response.json()
            print(f"Found {len(workers)} approved workers.")
            for w in workers:
                print(f"Worker: {w['name']}, Service: {w['service']}, Lat: {w['latitude']}, Lng: {w['longitude']}, Online: {w['is_online']}")
        else:
            print(f"Error: {response.status_code} - {response.text}")

if __name__ == "__main__":
    asyncio.run(check_workers())
