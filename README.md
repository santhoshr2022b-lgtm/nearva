# Nearva (FastAPI + Supabase)

A hyperlocal service discovery platform connecting users with nearby verified workers.

## Tech Stack
-   **Backend:** FastAPI (Python)
-   **Database:** Supabase (PostgreSQL)
-   **Frontend:** HTML + TailwindCSS
-   **Maps:** Leaflet.js + OpenStreetMap

## Setup Instructions

### 1. Database Setup (Supabase)
1.  Create a new project on [Supabase.com](https://supabase.com/).
2.  Go to the **SQL Editor** in your Supabase dashboard.
3.  Paste and run the following SQL code to create the `workers` table:

```sql
-- Create workers table
create table workers (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  phone text not null,
  service text not null,
  experience int not null,
  area text not null,
  latitude float8 not null,
  longitude float8 not null,
  availability text default 'Available',
  status text default 'Pending', -- 'Pending', 'Approved', 'Rejected'
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- Create indexes for faster search
create index idx_workers_service on workers(service);
create index idx_workers_status on workers(status);
```

### 2. Configure Environment
1.  Open the `.env` file in the project folder.
2.  Paste your **Project URL** and **anon public key** from Supabase settings (API section).

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key
ADMIN_PASSWORD=admin123
```

### 3. Install Dependencies
```bash
pip install -r requirements.txt
```

### 4. Run the Application
```bash
uvicorn main:app --reload
```
The app will start at: `http://127.0.0.1:8000`

## Features
-   **Mobile-First Design:** Fully responsive UI with TailwindCSS.
-   **Real-time Maps:** View nearby workers on an interactive map.
-   **Service Discovery:** Filter by category (Plumber, Electrician, etc.).
-   **Worker Registration:** Simple form to join the platform.
-   **Admin Panel:** Manage workers (Approve/Reject/Delete).
