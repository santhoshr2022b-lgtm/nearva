import asyncio
import httpx
import os
from dotenv import load_dotenv

load_dotenv()

BASE_URL = "http://127.0.0.1:8000"
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Vignesh@47rv")

async def run_tests():
    print("🚀 Starting End-to-End Test Suite...\n")
    
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30.0) as client:
        
        # 1. Health Check (Main Page)
        print("1️⃣  Testing Homepage...")
        resp = await client.get("/")
        assert resp.status_code == 200
        print("✅ Homepage is UP")

        # 2. Register a Test Worker
        print("\n2️⃣  Testing Worker Registration...")
        worker_data = {
            "name": "Test Bot",
            "phone": "1234567890",
            "service": "Plumber",
            "experience": 10,
            "area": "Test Area",
            "latitude": 12.9716,
            "longitude": 77.5946,
            "availability": "Available"
        }
        # Note: Form data is sent differently than JSON
        resp = await client.post("/api/register", data=worker_data)
        # It redirects to /register?success=true
        assert resp.status_code == 303 
        print("✅ Registration Successful (Redirected)")

        # 3. Admin Login
        print("\n3️⃣  Testing Admin Login...")
        resp = await client.post("/api/admin/login", data={"password": ADMIN_PASSWORD})
        assert resp.status_code == 200
        print("✅ Admin Login Successful")

        # 4. Fetch Admin Workers List
        print("\n4️⃣  Fetching Worker List (Admin)...")
        resp = await client.get("/api/admin/workers")
        assert resp.status_code == 200
        workers = resp.json()
        assert len(workers) > 0
        
        # Find our test bot
        test_bot = next((w for w in workers if w["name"] == "Test Bot"), None)
        assert test_bot is not None
        print(f"✅ Found Test Bot (ID: {test_bot['id']}, Status: {test_bot['status']})")

        # 5. Approve Worker
        print(f"\n5️⃣  Approving Worker {test_bot['id']}...")
        resp = await client.post(f"/api/admin/approve/{test_bot['id']}")
        assert resp.status_code == 200
        print("✅ Worker Approved")

        # 6. Toggle Availability
        print(f"\n6️⃣  Toggling Availability...")
        # Should switch from Offline -> Available
        resp = await client.post(f"/api/admin/toggle_availability/{test_bot['id']}")
        assert resp.status_code == 200
        result = resp.json()
        print(f"✅ Availability Toggled to: {result['new_status']}")
        assert result['new_status'] == "Available"
        
        # Toggle back to Busy
        resp = await client.post(f"/api/admin/toggle_availability/{test_bot['id']}")
        print(f"✅ Availability Toggled to: {resp.json()['new_status']}")
        assert resp.json()['new_status'] == "Busy"

        # 7. Check Map API (Public)
        print("\n7️⃣  Checking Public Map API...")
        # Since we approved it, it should show up
        resp = await client.get("/api/workers?category=Plumber")
        assert resp.status_code == 200
        public_workers = resp.json()
        found = any(w['id'] == test_bot['id'] for w in public_workers)
        assert found
        print("✅ Approved worker visible in public API")

        # 8. Delete Worker (Cleanup)
        print(f"\n8️⃣  Cleaning up (Deleting Worker)...")
        resp = await client.delete(f"/api/admin/delete/{test_bot['id']}")
        assert resp.status_code == 200
        print("✅ Worker Deleted")

    print("\n✨ ALL TESTS PASSED! The system is fully functional. ✨")

if __name__ == "__main__":
    try:
        asyncio.run(run_tests())
    except AssertionError as e:
        print(f"\n❌ TEST FAILED: {e}")
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
