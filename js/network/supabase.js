// Supabase client / diagnostic build
const BT_BUILD_ID = '20260815-human-turn-sync-01';
const SUPABASE_URL  = 'https://ffztxyeevdqlhvxzcopn.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmenR4eWVldmRxbGh2eHpjb3BuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyNzgxMTMsImV4cCI6MjA4Nzg1NDExM30.EdA8cwETE00YFENj-CN93ScKMFN4yfNNG63BentHiQ4';

// Diagnostic only: report any Supabase REST request that leaves this build
// without an apikey header. Do not print token values.
const _btOriginalFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url || '';
  if (url.includes('.supabase.co/rest/v1/')) {
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    if (!headers.has('apikey')) {
      console.error('[BT-DIAG] Supabase REST request missing apikey:', url);
    }
  }
  return _btOriginalFetch(input, init);
};

console.log('[BT-DIAG] build', BT_BUILD_ID);
const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
