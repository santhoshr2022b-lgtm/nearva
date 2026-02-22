import requests
import json

print("=== DEBUGGING /api/workers RESPONSE ===\n")

# Test localhost
url = "http://127.0.0.1:8000/api/workers"
print(f"Fetching: {url}")

try:
    response = requests.get(url, timeout=5)
    print(f"Status Code: {response.status_code}\n")
    
    if response.status_code == 200:
        data = response.json()
        print(f"Total Workers Returned: {len(data)}\n")
        
        for i, worker in enumerate(data, 1):
            print(f"--- Worker {i} ---")
            print(f"Name: {worker.get('name')}")
            print(f"Service: {worker.get('service')}")
            print(f"Availability: {worker.get('availability')}")
            print(f"is_online: {worker.get('is_online')} (Type: {type(worker.get('is_online')).__name__})")
            print(f"Latitude: {worker.get('latitude')}")
            print(f"Longitude: {worker.get('longitude')}")
            print()
        
        # Count by status
        online_count = len([w for w in data if w.get('is_online') == True])
        offline_count = len([w for w in data if w.get('is_online') == False])
        null_coords = len([w for w in data if w.get('latitude') is None or w.get('longitude') is None])
        
        print(f"Summary:")
        print(f"  Online (is_online=true): {online_count}")
        print(f"  Offline (is_online=false): {offline_count}")
        print(f"  Missing Coordinates: {null_coords}")
    else:
        print(f"Error: {response.text}")
except Exception as e:
    print(f"Request failed: {e}")
