from fastapi import FastAPI, Request, Form, Depends, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
import httpx
from dotenv import load_dotenv
import os
import uvicorn
import bcrypt
from starlette.middleware.sessions import SessionMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from datetime import datetime, timezone
from contextlib import asynccontextmanager

# Load environment variables
load_dotenv()

import cloudinary
import cloudinary.uploader
import cloudinary.utils
import time

# Configure Cloudinary
cloudinary.config(
    cloud_name = os.environ.get('CLOUDINARY_CLOUD_NAME'),
    api_key = os.environ.get('CLOUDINARY_API_KEY'),
    api_secret = os.environ.get('CLOUDINARY_API_SECRET'),
    secure = True
)

# Supabase Config
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation"
}

# Global HTTP Client for connection pooling
http_client = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global http_client
    http_client = httpx.AsyncClient(timeout=10.0)
    yield
    await http_client.aclose()

app = FastAPI(lifespan=lifespan)

# Add Middlewares
app.add_middleware(SessionMiddleware, secret_key=os.environ.get("SESSION_SECRET_KEY", "fallback-secret-key-123"))
app.add_middleware(GZipMiddleware, minimum_size=1000) # Compress responses > 1KB

async def supabase_request(method: str, endpoint: str, data: dict = None, params: dict = None):
    url = f"{SUPABASE_URL}/rest/v1/{endpoint}"
    try:
        response = await http_client.request(method, url, headers=headers, json=data, params=params)
        
        if response.status_code >= 400:
            print(f"Supabase Error [{response.status_code}]: {response.text}")
            raise HTTPException(
                status_code=response.status_code, 
                detail=f"Database operational error: {response.text}"
            )
        return response
    except httpx.RequestError as e:
        print(f"Connection Error: {str(e)}")
        raise HTTPException(status_code=503, detail="Database service temporarily unavailable")
    except Exception as e:
        if isinstance(e, HTTPException): raise e
        print(f"Internal Error: {str(e)}")
        raise HTTPException(status_code=500, detail="An internal server error occurred")

# Static & Templates
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "static")), name="static")
templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))

# Middleware for Cache Control (Zero-Glitch Delivery)
@app.middleware("http")
async def add_cache_control_header(request: Request, call_next):
    response = await call_next(request)
    
    # Static Assets: Cache for 1 hour to prevent repeat-request jitter
    if request.url.path.startswith("/static"):
        response.headers["Cache-Control"] = "public, max-age=3600"
    else:
        # Dynamic Content: No cache to ensure data freshness (Real-time status)
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    
    return response

# --- Routes ---

@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/api/workers")
async def get_workers(category: str = "All", lat: float = None, lng: float = None):
    # Master Optimization: Fetch ONLY minimum required fields for map rendering
    fields = "id,name,phone,service,experience,area,latitude,longitude,is_online,last_active,profile_photo,ambassadors(name)"
    query = f"workers?account_status=eq.Approved&latitude=not.is.null&longitude=not.is.null&select={fields}"
    
    # 1. Category Filtering
    if category != "All":
        query += f"&service=eq.{category}"
        
    # 2. Geospatial Filtering (10km Bounding Box)
    if lat is not None and lng is not None:
        # ~10km bounding box (approximate)
        # 1 deg lat is ~111km, 1 deg lng at 12 deg lat is ~108km
        lat_delta = 0.1 # approx 11km
        lng_delta = 0.1 # approx 11km
        
        lat_min = lat - lat_delta
        lat_max = lat + lat_delta
        lng_min = lng - lng_delta
        lng_max = lng + lng_delta
        
        query += f"&latitude=gte.{lat_min}&latitude=lte.{lat_max}"
        query += f"&longitude=gte.{lng_min}&longitude=lte.{lng_max}"
        
    response = await supabase_request("GET", query)
    workers = response.json()
    
    # Debug log
    if lat is not None:
        print(f"DEBUG: Found {len(workers)} workers for category {category} near {lat}, {lng}")
    else:
        print(f"DEBUG: Found {len(workers)} workers for category {category} (Global)")
    
    return workers


@app.get("/map", response_class=HTMLResponse)
async def map_page(request: Request, category: str = "All"):
    return templates.TemplateResponse("map.html", {"request": request, "category": category})

@app.get("/register", response_class=HTMLResponse)
async def register_page(request: Request):
    if request.session.get("worker_id"):
        return RedirectResponse(url="/worker/dashboard")
    return templates.TemplateResponse("register.html", {"request": request})

@app.get("/admin", response_class=HTMLResponse)
async def admin_page(request: Request):
    is_logged_in = request.session.get("admin_logged_in", False)
    return templates.TemplateResponse("admin.html", {"request": request, "is_logged_in": is_logged_in})

@app.get("/about", response_class=HTMLResponse)
async def about_page(request: Request):
    return templates.TemplateResponse("about.html", {"request": request})

@app.get("/contact", response_class=HTMLResponse)
async def contact_page(request: Request):
    return templates.TemplateResponse("contact.html", {"request": request})

@app.get("/privacy", response_class=HTMLResponse)
async def privacy_page(request: Request):
    return templates.TemplateResponse("privacy.html", {"request": request})

@app.get("/terms", response_class=HTMLResponse)
async def terms_page(request: Request):
    return templates.TemplateResponse("terms.html", {"request": request})


# --- API Endpoints ---
# (Removed duplicate /api/workers route here)

@app.post("/api/register")
async def register_worker(
    name: str = Form(...),
    phone: str = Form(...),
    password: str = Form(...),
    service: str = Form(...),
    experience: int = Form(...),
    area: str = Form(...),
    latitude: float = Form(...),
    longitude: float = Form(...),
    profile_photo: str = Form(None),
    ambassador_id: str = Form(None)
):
    # Check if phone number already exists
    check_response = await supabase_request("GET", f"workers?phone=eq.{phone}")
    existing_workers = check_response.json()
    
    if existing_workers:
        return JSONResponse({"status": "error", "message": "Phone number is already registered."}, status_code=409)
    
    # Hash the password
    hashed_password = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    
    # All new workers start as Offline and Pending approval
    worker_data = {
        "name": name,
        "phone": phone,
        "password_hash": hashed_password,
        "service": service,
        "experience": experience,
        "area": area,
        "latitude": latitude,
        "longitude": longitude,
        "availability": "Offline",
        "is_online": False,
        "account_status": "Pending",
        "status": "offline",
        "profile_photo": profile_photo or f"https://ui-avatars.com/api/?name={name.replace(' ', '+')}&background=random&color=fff",
        "rating_avg": 4.5,
        "review_count": 0,
        "is_verified": False,
        "completed_jobs": 0
    }
    
    ambassador_name = None
    ambassador_phone = None
    if ambassador_id:
        worker_data["ambassador_id"] = ambassador_id
        # fetch ambassador details to return to frontend for whatsapp link
        amb_res = await supabase_request("GET", f"ambassadors?id=eq.{ambassador_id}")
        ambs = amb_res.json()
        if ambs:
            ambassador_name = ambs[0].get("name")
            ambassador_phone = ambs[0].get("phone")
    
    result = await supabase_request("POST", "workers", data=worker_data)
    if not result.is_success:
        print(f"Supabase Error: {result.status_code} - {result.text}")
        return JSONResponse({"status": "error", "message": "Database error occurred."}, status_code=500)
        
    return JSONResponse({
        "status": "success", 
        "worker": {
            "name": name,
            "service": service,
            "experience": experience,
            "phone": phone,
            "ambassador_name": ambassador_name,
            "ambassador_phone": ambassador_phone
        }
    })

# --- Admin API ---

@app.post("/api/admin/login")
async def admin_login(request: Request, password: str = Form(...)):
    # Use environment variable or fallback to user specified password
    if password == os.environ.get("ADMIN_PASSWORD", "AB125467#aaa1"):
        request.session["admin_logged_in"] = True
        return JSONResponse({"status": "success"})
    return JSONResponse({"status": "error"}, status_code=401)

@app.get("/api/admin/logout")
async def admin_logout(request: Request):
    request.session.clear()
    return RedirectResponse(url="/admin")

@app.get("/api/admin/workers")
async def get_all_workers():
    response = await supabase_request("GET", "workers?select=*,ambassadors(name)&order=created_at.desc")
    return response.json()

@app.post("/api/admin/approve/{worker_id}")
async def approve_worker(worker_id: str):
    await supabase_request("PATCH", f"workers?id=eq.{worker_id}", data={"account_status": "Approved"})
    return {"status": "success"}

@app.post("/api/admin/reject/{worker_id}")
async def reject_worker(worker_id: str):
    await supabase_request("PATCH", f"workers?id=eq.{worker_id}", data={"account_status": "Rejected"})
    return {"status": "success"}

@app.delete("/api/admin/delete/{worker_id}")
async def delete_worker(worker_id: str):
    await supabase_request("DELETE", f"workers?id=eq.{worker_id}")
    return {"status": "success"}

@app.post("/api/admin/toggle_availability/{worker_id}")
async def toggle_availability(worker_id: str):
    # First get current status
    response = await supabase_request("GET", f"workers?id=eq.{worker_id}&select=availability")
    workers = response.json()
    if not workers:
        return JSONResponse({"status": "error", "message": "Worker not found"}, status_code=404)
    
    current_status = workers[0]['availability']
    new_status = "Busy" if current_status == "Available" else "Available"
    is_online = (new_status != "Offline")
    
    # Update availability and is_online
    await supabase_request("PATCH", f"workers?id=eq.{worker_id}", data={"availability": new_status, "is_online": is_online})
    return {"status": "success", "new_status": new_status}

# --- Ambassador API ---

@app.get("/api/ambassadors")
async def get_ambassadors():
    response = await supabase_request("GET", "ambassadors?status=eq.active&select=id,name,area,phone,workers(name,service,area,is_online)&workers.account_status=eq.Approved")
    return response.json()

@app.post("/api/admin/ambassadors")
async def create_ambassador(request: Request, name: str = Form(...), phone: str = Form(...), area: str = Form(...)):
    if not request.session.get("admin_logged_in"):
        return JSONResponse({"status": "error"}, status_code=401)
    # Ensure phone number formatting is valid (simple strip)
    phone = "".join(filter(str.isdigit, phone))[-10:]
    data = {"name": name, "phone": phone, "area": area, "status": "active"}
    res = await supabase_request("POST", "ambassadors", data=data)
    if res.status_code >= 400: return JSONResponse({"status": "error", "message": res.text}, status_code=400)
    return {"status": "success"}

@app.get("/api/admin/ambassadorsList")
async def get_admin_ambassadors(request: Request):
    if not request.session.get("admin_logged_in"):
        return JSONResponse({"status": "error"}, status_code=401)
    response = await supabase_request("GET", "ambassadors?select=id,name,phone,area,status,created_at,workers(count)&order=created_at.desc")
    # If the subquery on workers(count) fails because of Supabase version, we'll try catching it.
    if response.status_code >= 400:
        # Fallback without count
        response = await supabase_request("GET", "ambassadors?select=*&order=created_at.desc")
    
    return response.json()

@app.post("/api/admin/ambassadors/{id}/toggle")
async def toggle_ambassador(request: Request, id: str):
    if not request.session.get("admin_logged_in"):
        return JSONResponse({"status": "error"}, status_code=401)
    amb_res = await supabase_request("GET", f"ambassadors?id=eq.{id}")
    ambs = amb_res.json()
    if not ambs: return {"status": "error"}
    new_status = "inactive" if ambs[0]["status"] == "active" else "active"
    await supabase_request("PATCH", f"ambassadors?id=eq.{id}", data={"status": new_status})
    return {"status": "success", "new_status": new_status}

# --- Worker Real-Time API ---

@app.get("/login")
async def login_redirect():
    """Redirect legacy login link to the correct worker login page."""
    return RedirectResponse(url="/worker/login")

@app.get("/worker/login", response_class=HTMLResponse)
async def worker_login_page(request: Request):
    if request.session.get("worker_id"):
        return RedirectResponse(url="/worker/dashboard")
    return templates.TemplateResponse("worker_login.html", {"request": request})

@app.get("/worker/dashboard", response_class=HTMLResponse)
async def worker_dashboard_page(request: Request):
    worker_id = request.session.get("worker_id")
    if not worker_id:
        return RedirectResponse(url="/worker/login")
    return templates.TemplateResponse("worker_dashboard.html", {"request": request, "worker_id": worker_id})

@app.get("/worker/profile", response_class=HTMLResponse)
async def worker_profile_page(request: Request):
    worker_id = request.session.get("worker_id")
    if not worker_id:
        return RedirectResponse(url="/worker/login")
    return templates.TemplateResponse("worker_profile.html", {"request": request, "worker_id": worker_id})

@app.get("/api/cloudinary/signature")
async def get_cloudinary_signature(request: Request):
    session_worker_id = request.session.get("worker_id")
    if not session_worker_id:
        return JSONResponse({"status": "error", "message": "Unauthorized access."}, status_code=403)
        
    timestamp = int(time.time())
    params_to_sign = {
        "timestamp": timestamp,
        "folder": "nearva_profiles"
    }

    signature = cloudinary.utils.api_sign_request(params_to_sign, os.environ.get('CLOUDINARY_API_SECRET'))

    return {"signature": signature, "timestamp": timestamp, "cloud_name": os.environ.get('CLOUDINARY_CLOUD_NAME'), "api_key": os.environ.get('CLOUDINARY_API_KEY'), "folder": "nearva_profiles"}

@app.post("/api/worker/profile")
async def update_worker_profile(
    request: Request,
    id: str = Form(...),
    name: str = Form(...),
    service: str = Form(...),
    experience: int = Form(...),
    profile_photo: str = Form(None)
):
    session_worker_id = request.session.get("worker_id")
    if str(session_worker_id) != str(id):
        return JSONResponse({"status": "error", "message": "Unauthorized access."}, status_code=403)
        
    data = {
        "name": name,
        "service": service,
        "experience": experience
    }
    if profile_photo:
        data["profile_photo"] = profile_photo
        
    await supabase_request("PATCH", f"workers?id=eq.{id}", data=data)
    return {"status": "success"}

@app.get("/api/worker/profile/{worker_id}")
async def get_worker_profile(worker_id: str, request: Request):
    session_worker_id = request.session.get("worker_id")
    if str(session_worker_id) != str(worker_id):
        return JSONResponse({"status": "error", "message": "Unauthorized access."}, status_code=403)
        
    response = await supabase_request("GET", f"workers?id=eq.{worker_id}&select=id,name,phone,service,experience,profile_photo")
    workers = response.json()
    if workers:
        return {"status": "success", "worker": workers[0]}
    return JSONResponse({"status": "error", "message": "Worker not found."}, status_code=404)

@app.post("/api/worker/login")
async def worker_login(request: Request, phone: str = Form(...), password: str = Form(...)):
    # Fetch worker by phone
    response = await supabase_request("GET", f"workers?phone=eq.{phone}&select=id,name,account_status,password_hash")
    workers = response.json()
    
    if not workers:
        return JSONResponse({"status": "error", "message": "Phone number not found."}, status_code=404)
    
    worker = workers[0]
    
    # Verify password hash (and handle legacy workers without password)
    stored_hash = worker.get('password_hash')
    if not stored_hash or not bcrypt.checkpw(password.encode('utf-8'), stored_hash.encode('utf-8')):
        return JSONResponse({"status": "error", "message": "Invalid password or account requires password setup."}, status_code=401)
    
    # Check account_status
    if worker.get('account_status') == 'Pending':
        return JSONResponse({"status": "error", "message": "Account pending approval."}, status_code=403)
    elif worker.get('account_status') == 'Rejected':
        return JSONResponse({"status": "error", "message": "Account rejected by admin."}, status_code=403)
    
    # Secure Session Login
    request.session["worker_id"] = worker["id"]
    request.session["worker_role"] = "worker"
    
    return {"status": "success", "worker": {"id": worker["id"], "name": worker["name"], "status": worker.get("account_status")}}

@app.get("/api/worker/logout")
async def worker_logout(request: Request):
    request.session.clear()
    return RedirectResponse(url="/worker/login")

@app.post("/api/worker/update")
async def worker_update(
    request: Request,
    id: str = Form(...),
    latitude: float = Form(None),
    longitude: float = Form(None),
    availability: str = Form(...) # 'Available' or 'Offline'
):
    # Verify session matches the worker being updated
    session_worker_id = request.session.get("worker_id")
    if not session_worker_id or session_worker_id != id:
        return JSONResponse({"status": "error", "message": "Unauthorized access."}, status_code=403)
    # SECURITY: Validate worker is approved before allowing updates
    check_response = await supabase_request("GET", f"workers?id=eq.{id}&select=account_status")
    workers = check_response.json()
    
    if not workers:
        return JSONResponse({"status": "error", "message": "Worker not found."}, status_code=404)
    
    worker_status = workers[0].get('account_status')
    if worker_status != 'Approved':
        return JSONResponse({
            "status": "error", 
            "message": "Only approved workers can update their status."
        }, status_code=403)
    
    # Proceed with update if approved
    is_online = (availability != "Offline")
    data = {
        "availability": availability,
        "is_online": is_online,
        "last_active": "now()" # PostgREST shorthand
    }
    
    from datetime import datetime, timezone
    data["last_active"] = datetime.now(timezone.utc).isoformat()
    
    if latitude is not None and longitude is not None:
        data["latitude"] = latitude
        data["longitude"] = longitude
    
    await supabase_request("PATCH", f"workers?id=eq.{id}", data=data)
    return {"status": "success", "is_online": is_online, "availability": availability}

# Basic in-memory rate limiter
RE_LIMITER = {}

@app.put("/api/worker/status")
async def update_worker_status(request: Request):
    session_worker_id = request.session.get("worker_id")
    if not session_worker_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    try:
        body = await request.json()
        new_status = body.get("status") # 'online' or 'offline'
        lat = body.get("latitude")
        lng = body.get("longitude")
    except:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    if new_status not in ["online", "offline"]:
        raise HTTPException(status_code=422, detail="Status must be 'online' or 'offline'")

    # STEP 1 FIX: If going online, GPS is MANDATORY
    if new_status == "online":
        if lat is None or lng is None:
            raise HTTPException(status_code=400, detail="GPS location required to go online")

    # Basic Rate Limiting
    now_ts = datetime.now(timezone.utc).timestamp()
    history = RE_LIMITER.get(session_worker_id, [])
    history = [t for t in history if now_ts - t < 60]
    if len(history) >= 10: # Allow more updates for heartbeat
        raise HTTPException(status_code=429, detail="Too many updates. Please wait.")
    history.append(now_ts)
    RE_LIMITER[session_worker_id] = history

    # Update database
    is_online = (new_status == "online")
    now_iso = datetime.now(timezone.utc).isoformat()
    
    data = {
        "status": new_status,
        "is_online": is_online,
        "availability": "Available" if is_online else "Offline",
        "last_status_update": now_iso,
        "last_active": now_iso
    }
    
    if lat is not None: data["latitude"] = lat
    if lng is not None: data["longitude"] = lng
    
    response = await supabase_request("PATCH", f"workers?id=eq.{session_worker_id}", data=data)
    
    if response.status_code >= 400:
        error_detail = response.text
        print(f"ERROR: Failed to update status for {session_worker_id}: {error_detail}")
        raise HTTPException(status_code=500, detail=f"Database update failed: {error_detail}")

    print(f"LOG: Worker {session_worker_id} is now {'ONLINE' if is_online else 'OFFLINE'} at {now_iso}")
    
    return {
        "status": "success",
        "is_online": is_online,
        "last_update": now_iso
    }

@app.get("/api/worker/status/{worker_id}")
async def get_worker_status(worker_id: str, request: Request):
    session_worker_id = request.session.get("worker_id")
    if not session_worker_id or session_worker_id != worker_id:
        return JSONResponse({"status": "error", "message": "Unauthorized access."}, status_code=403)
    response = await supabase_request("GET", f"workers?id=eq.{worker_id}&select=account_status,name,status,last_status_update,is_online,last_active")
    workers = response.json()
    
    if workers:
        return {"status": "success", "worker": workers[0]}
    return JSONResponse({"status": "error", "message": "Worker not found."}, status_code=404)
    
@app.get("/{city}/{service}", response_class=HTMLResponse)
async def service_city_page(request: Request, city: str, service: str):
    return templates.TemplateResponse(
        "service_city.html",
        {
            "request": request,
            "city": city.capitalize(),
            "service": service.replace("-", " ").title()
        }
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
