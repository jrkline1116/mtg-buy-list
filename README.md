# MTG Buy List

A shared Magic: The Gathering card wishlist. One tab per Commander deck, card
images and prices from Scryfall, and no login for anyone — your friend
bookmarks the URL and starts typing.

Card data and images from [Scryfall](https://scryfall.com). Unofficial Fan
Content; not affiliated with Wizards of the Coast.

---

## What you need

Two free accounts, both of which you already have or can make in a minute:

- **GitHub** — hosts the site (static files, free, no server)
- **Supabase** — holds the shared card list (free tier, no credit card)

GitHub Pages can only serve files; it can't store anything two people both
write to. Supabase is the piece that lets your edits and your friend's edits
land in the same place.

---

## Setup

### 1. Put the files on GitHub

Create a repository named `mtg-buy-list`, upload everything in this folder,
then go to **Settings → Pages** and set Source to **Deploy from a branch**,
branch `main`, folder `/ (root)`. A minute later the site is live at:

```
https://jrkline1116.github.io/mtg-buy-list/
```

It will show a red error line until step 3 — that's expected.

### 2. Create the database

1. Go to [supabase.com](https://supabase.com), sign in, **New project**.
   Any name, any region close to you, and let it generate a database password.
2. Wait for it to finish provisioning (about a minute).
3. Open **SQL Editor → New query**, paste the entire contents of
   `supabase-setup.sql`, and press **Run**. It creates the two tables and the
   access policies.
4. Open **Project Settings → API** and copy two things:
   - the **Project URL** (`https://xxxxx.supabase.co`)
   - the **anon / public** key (a long string starting `eyJ`)

### 3. Fill in `config.js`

Edit `config.js` in your repo and paste both values in. While you're there,
change `'Friend'` to your friend's actual name:

```js
window.CONFIG = {
  SUPABASE_URL: 'https://xxxxx.supabase.co',
  SUPABASE_ANON_KEY: 'eyJ...',
  PEOPLE: ['John', 'Dave'],
  TITLE: 'MTG Buy List'
};
```

Commit the change. Pages redeploys on its own in under a minute.

> The anon key belongs in the repo — it's designed to be public, and the
> policies in `supabase-setup.sql` are what actually limit it. Never put the
> **service role** key in these files.

### 4. Import your existing list

Open the site, tap **⋯ → Import list from the spreadsheet**. It reads
`seed.json` (your 12 decks and 45 cards, exported from the Google Sheet) and
looks each one up on Scryfall. Takes about a minute. Run it once.

### 5. Send your friend the link

That's the whole handoff. No account, no authorization screen, no permissions.
On a phone, Add to Home Screen gives it an icon and opens it without browser
chrome.

---

## Using it

| | |
|---|---|
| **Add a card** | Start typing — suggestions come from Scryfall, so you can't misspell one into oblivion. Enter adds the highlighted name. |
| **See the card** | Tap the picture for full size, rules text and a notes field. |
| **Who wants it / priority / status** | The dropdowns on each card. They save as you change them. |
| **Totals** | Bottom right of the toolbar: how many cards are still marked Want on this deck, and what they'd cost. |
| **Refresh prices** | ⋯ menu. Re-checks every card against Scryfall in batches. |
| **Decks** | ⋯ menu to add, rename or delete. Renaming moves its cards with it. |

### Finding cards by what they do

Type a description instead of a name, such as `destroy target enchantment`,
`draw a card`, or `exile target creature`, and choose **🔍 Find cards that…**
at the bottom of the dropdown (or just press Enter). You get up to 24 cards in
the deck's commander's colors, Commander-legal, most-played first, each with
an Add button.

The commander is worked out from the deck name and shown under the search bar.
If it guessed wrong, click **change**. Advanced: anything with a colon is sent
to Scryfall as-is, so `otag:removal` or `t:equipment o:"double strike"` work too.

Changes appear on the other person's screen within a second or two — no
refreshing, no "are you looking at the latest version".

---

## Notes

**Who can get in.** Anyone with the URL can read and edit. That's the deliberate
trade for a no-login app, and it's the same exposure as a link-shared Google
Sheet. Fine for a card wishlist; don't reuse the pattern for anything private.

**Prices** are Scryfall's USD figures for the default printing, which is a
market estimate, not a specific listing. Check TCGplayer before actually buying
anything expensive.

**Double-faced cards** store the front face image and both faces' rules text.

**The spreadsheet** still works and still has the Apps Script. Nothing here
touches it — keep it as a backup until you're confident in this, then retire it.

---

## Files

```
index.html           markup
styles.css           styling, light and dark
app.js               all behavior — Supabase and Scryfall calls live here
config.js            your two Supabase values (the only file you must edit)
seed.json            decks and cards exported from the Google Sheet
supabase-setup.sql   run once in the Supabase SQL editor
manifest.json        makes it installable on phones
sw.js                caches the app shell so it opens offline
icons/               app icons
```
