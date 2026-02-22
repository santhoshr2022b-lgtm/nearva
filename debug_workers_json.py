import httpx
import os
import json
from dotenv import load_dotenv

load_dotenv()

url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_KEY")

headers = {
    "apikey": key,
    "Authorization": f"Bearer {key}"
}

try:
    resp = httpx.get(f"{url}/rest/v1/workers?select=id,name,latitude,longitude,is_online,account_status,service", headers=headers)
    if resp.status_code == 200:
        print(json.dumps(resp.json(), indent=2))
except Exception as e:
    print(str(e))
