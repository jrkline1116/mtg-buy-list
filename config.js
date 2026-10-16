// ---------------------------------------------------------------------------
// FILL THESE IN. Both values come from your Supabase project:
// Project Settings -> API. See README.md step 2.
//
// The anon key is meant to be public — it is safe in a GitHub repo. It only
// grants what your row-level security policies allow, which in this app means
// read and write on the buy list. Never paste the SERVICE ROLE key here.
// ---------------------------------------------------------------------------

window.CONFIG = {
  SUPABASE_URL: 'https://YOUR-PROJECT-ref.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-ANON-KEY',

  // Shown in the "who wants it" picker. Change the second name to your friend's.
  PEOPLE: ['John', 'Friend'],

  // Appears in the header.
  TITLE: 'MTG Buy List'
};
