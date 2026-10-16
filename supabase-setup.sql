-- MTG Buy List — database setup
-- Paste this whole file into the Supabase SQL Editor and press Run.
-- Safe to run more than once.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- decks
create table if not exists decks (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- cards
create table if not exists cards (
  id            uuid primary key default gen_random_uuid(),
  deck          text not null,
  name          text not null,
  scryfall_id   text,
  scryfall_url  text,
  image_small   text,
  image_normal  text,
  mana_cost     text,
  type_line     text,
  oracle_text   text,
  price         numeric(10,2),
  price_checked timestamptz,
  who           text,
  priority      text,
  status        text not null default 'Want',
  notes         text,
  created_at    timestamptz not null default now()
);

create index if not exists cards_deck_idx on cards (deck);

-- ------------------------------------------------------- access policies
-- No accounts: anyone holding the anon key (i.e. anyone with the site URL)
-- can read and write. That is the trade for "my friend just bookmarks it".
-- The data here is a card wishlist, so that exposure is acceptable — do not
-- reuse this pattern for anything private.

alter table decks enable row level security;
alter table cards enable row level security;

drop policy if exists decks_anon_all on decks;
create policy decks_anon_all on decks
  for all to anon using (true) with check (true);

drop policy if exists cards_anon_all on cards;
create policy cards_anon_all on cards
  for all to anon using (true) with check (true);

-- --------------------------------------------------------- live updates
-- Lets both of you see each other's changes without refreshing.
do $$
begin
  begin
    alter publication supabase_realtime add table cards;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table decks;
  exception when duplicate_object then null;
  end;
end $$;

-- ------------------------------------------------------------ commanders
-- Lets each deck remember its commander for everyone, so card suggestions
-- stay in the right colors. Without it the app guesses from the deck name
-- and remembers corrections only on the device where you made them.
alter table decks add column if not exists commander text;
