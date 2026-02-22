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
    resp = httpx.get(f"{url}/rest/v1/workers?select=password_hash&limit=1", headers=headers)
    print(f"Status Code: {resp.status_code}")
    print(f"Response: {resp.text}")
except Exception as e:
    print(f"Error: {e}")
