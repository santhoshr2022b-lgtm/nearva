-- Enable pgcrypto for UUID generation (if not already enabled)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create the workers table
CREATE TABLE IF NOT EXISTS public.workers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    service TEXT NOT NULL,
    experience INTEGER,
    area TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    availability TEXT DEFAULT 'Offline',
    is_online BOOLEAN DEFAULT false,
    status TEXT DEFAULT 'offline' CHECK (status IN ('online', 'offline')),
    last_status_update TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    last_active TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    account_status TEXT DEFAULT 'Pending' CHECK (account_status IN ('Pending', 'Approved', 'Rejected')),
    profile_photo TEXT,
    rating_avg DOUBLE PRECISION DEFAULT 4.5,
    review_count INTEGER DEFAULT 0,
    is_verified BOOLEAN DEFAULT false,
    completed_jobs INTEGER DEFAULT 0
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.workers ENABLE ROW LEVEL SECURITY;

-- Create Policy: Allow Public Read Access (so map works)
CREATE POLICY "Allow Public Read Access" ON public.workers
FOR SELECT USING (true);

-- Create Policy: Allow Public Insert Access (so registration works)
CREATE POLICY "Allow Public Insert Access" ON public.workers
FOR INSERT WITH CHECK (true);

-- Create Policy: Allow Update/Delete (Ideally restricted, but open for MVP Admin)
CREATE POLICY "Allow All Access" ON public.workers
FOR ALL USING (true);
