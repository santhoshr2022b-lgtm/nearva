-- ==============================================================================
-- Migration script to add Community Ambassador System to Supabase
-- Run this in your Supabase SQL Editor
-- ==============================================================================

-- 1. Create the ambassadors table
CREATE TABLE IF NOT EXISTS public.ambassadors (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    area TEXT NOT NULL,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive'))
);

-- 2. Modify the workers table to link to ambassadors (Optional)
ALTER TABLE public.workers 
ADD COLUMN IF NOT EXISTS ambassador_id UUID REFERENCES public.ambassadors(id) ON DELETE SET NULL;

-- 3. Enable RLS on ambassadors
ALTER TABLE public.ambassadors ENABLE ROW LEVEL SECURITY;

-- 4. Create RLS Policies for ambassadors
-- Allow public to see active ambassadors (for registration dropdown and homepage)
CREATE POLICY "Allow Public Read Access" ON public.ambassadors
FOR SELECT USING (status = 'active');

-- Allow admin full access (Since MVP uses general policies)
CREATE POLICY "Allow All Access Admin" ON public.ambassadors
FOR ALL USING (true);

-- 5. Expose foreign key relation to PostgREST
-- PostgREST will automatically pick up the foreign key `ambassador_id`, 
-- allowing queries like `select=*,ambassadors(name)`
