// ── SUPABASE CONFIG ──────────────────────────────────────
const SUPABASE_URL  = 'https://ffztxyeevdqlhvxzcopn.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmenR4eWVldmRxbGh2eHpjb3BuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyNzgxMTMsImV4cCI6MjA4Nzg1NDExM30.EdA8cwETE00YFENj-CN93ScKMFN4yfNNG63BentHiQ4';
const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
