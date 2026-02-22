import httpx
import os
from dotenv import load_dotenv

load_dotenv()

url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_KEY")

if not url or not key:
    print("Missing environment variables.")
    exit(1)

headers = {
    "apikey": key,
    "Authorization": f"Bearer {key}"
}

try:
    # Check workers and their location data
    resp = httpx.get(f"{url}/rest/v1/workers?select=id,name,latitude,longitude,is_online,account_status,service", headers=headers)
    print(f"Status Code: {resp.status_code}")
    if resp.status_code == 200:
        workers = resp.json()
        print(f"Total Workers: {len(workers)}")
        for w in workers:
            print(f"Worker {w['id']} ({w['name']}): Lat={w['latitude']}, Lng={w['longitude']}, Online={w['is_online']}, Status={w['account_status']}, Service={w['service']}")
    else:
        print(f"Error Response: {resp.text}")
except Exception as e:
    print(f"Error: {e}")
