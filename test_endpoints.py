import requests
import sys

def check_url(url, description):
    try:
        response = requests.get(url, timeout=5)
        status = response.status_code
        if status == 200:
            print(f"✅ [PASS] {description}: {url} (Status: {status})")
        else:
            print(f"❌ [FAIL] {description}: {url} (Status: {status})")
    except Exception as e:
        print(f"❌ [FAIL] {description}: {url} (Error: {str(e)})")

print("--- Testing Localhost (http://127.0.0.1:8000) ---")
check_url("http://127.0.0.1:8000/", "Main Page")
check_url("http://127.0.0.1:8000/map", "Map Page")
check_url("http://127.0.0.1:8000/worker/dashboard", "Worker Dashboard")
check_url("http://127.0.0.1:8000/api/workers", "API Workers List")

print("\n--- Testing Production (https://nearva.vercel.app) ---")
check_url("https://nearva.vercel.app/", "Main Page")
check_url("https://nearva.vercel.app/map", "Map Page")
check_url("https://nearva.vercel.app/worker/dashboard", "Worker Dashboard")
check_url("https://nearva.vercel.app/api/workers", "API Workers List")
