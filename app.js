/**
 * MTG Buy List — shared card wishlist.
 *
 * Data lives in Supabase (see supabase-setup.sql). Card data and images come
 * from Scryfall, using the static cards.scryfall.io CDN rather than the
 * rate-limited api.scryfall.com redirect endpoint.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CFG = window.CONFIG || {};
const PEOPLE = CFG.PEOPLE || ['Me', 'Friend'];
const PRIORITIES = ['High', 'Medium', 'Low'];
const STATUSES = ['Want', 'Ordered', 'Owned', 'Passed'];

const $ = (sel) => document.querySelector(sel);
const el = {
  title: $('#app-title'),
  tabs: $('#deck-tabs'),
  input: $('#card-input'),
  sugg: $('#suggestions'),
  add: $('#btn-add'),
  cards: $('#cards'),
  empty: $('#empty'),
  totals: $('#totals'),
  status: $('#status-line'),
  whoami: $('#whoami'),
  filterStatus: $('#filter-status'),
  filterWho: $('#filter-who'),
  sortBy: $('#sort-by'),
  detail: $('#detail'),
  menu: $('#menu'),
  menuBtn: $('#btn-menu')
};

let db = null;
let decks = [];
let cards = [];
let activeDeck = localStorage.getItem('deck') || null;
let me = localStorage.getItem('me') || PEOPLE[0];

// ------------------------------------------------------------- utilities

function say(msg, isError) {
  el.status.textContent = msg || '';
  el.status.classList.toggle('error', !!isError);
}

function money(n) {
  if (n === null || n === undefined || n === '') return '—';
  return '$' + Number(n).toFixed(2);
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// --------------------------------------------------------------- scryfall

const SCRY = 'https://api.scryfall.com';

async function scryfallAutocomplete(q) {
  const res = await fetch(`${SCRY}/cards/autocomplete?q=${encodeURIComponent(q)}`);
  if (!res.ok) return [];
  const json = await res.json();
  return json.data || [];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch() that waits and retries when Scryfall rate-limits (429) or hiccups
 * (5xx), instead of failing on the first refusal. Returns the final response.
 */
async function scryFetch(url, opts) {
  let wait = 1000;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, opts);
    if (res.status !== 429 && res.status < 500) return res;
    if (attempt >= 5) return res;
    const after = Number(res.headers.get('Retry-After'));
    await sleep(after ? after * 1000 : wait);
    wait *= 2;
  }
}

async function scryfallNamed(name) {
  let res = await scryFetch(`${SCRY}/cards/named?exact=${encodeURIComponent(name)}`);
  if (res.status === 404) {
    res = await scryFetch(`${SCRY}/cards/named?fuzzy=${encodeURIComponent(name)}`);
  }
  if (res.status === 429) throw new Error('Scryfall is busy — try again in a minute.');
  if (!res.ok) throw new Error(`Scryfall could not find "${name}".`);
  return res.json();
}

/**
 * Batched lookup, 75 per request. Each identifier is either { id } or
 * { name }. One request covers a whole deck, so this is far gentler on
 * Scryfall's rate limit than looking cards up one at a time.
 */
async function scryfallCollection(identifiers) {
  const out = [];
  for (let i = 0; i < identifiers.length; i += 75) {
    const chunk = identifiers.slice(i, i + 75);
    const res = await scryFetch(`${SCRY}/cards/collection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: chunk })
    });
    if (!res.ok) throw new Error(`Scryfall returned ${res.status}.`);
    const json = await res.json();
    out.push(...(json.data || []));
    await sleep(150);
  }
  return out;
}

function faceOf(card) {
  if (card.image_uris) return card;
  if (card.card_faces && card.card_faces.length) return card.card_faces[0];
  return card;
}

/** Flattens a Scryfall card into the columns this app stores. */
function toRow(card) {
  const face = faceOf(card);
  let oracle = card.oracle_text || '';
  if (!oracle && card.card_faces) {
    oracle = card.card_faces
      .map((f) => (f.name ? f.name + ' — ' : '') + (f.oracle_text || ''))
      .join('\n\n');
  }
  if (card.power && card.toughness) oracle += `\n[${card.power}/${card.toughness}]`;
  if (card.loyalty) oracle += `\n[loyalty ${card.loyalty}]`;

  return {
    name: card.name,
    scryfall_id: card.id,
    scryfall_url: card.scryfall_uri,
    image_small: (face.image_uris && face.image_uris.small) || null,
    image_normal: (face.image_uris && face.image_uris.normal) || null,
    mana_cost: card.mana_cost || (face.mana_cost || ''),
    type_line: card.type_line || face.type_line || '',
    oracle_text: oracle,
    price: card.prices && card.prices.usd ? Number(card.prices.usd) : null,
    price_checked: new Date().toISOString()
  };
}

// --------------------------------------------------------------- loading

async function loadAll() {
  const [{ data: d, error: de }, { data: c, error: ce }] = await Promise.all([
    db.from('decks').select('*').order('sort_order').order('name'),
    db.from('cards').select('*')
  ]);
  if (de) throw de;
  if (ce) throw ce;

  decks = d || [];
  cards = c || [];

  if (!decks.length) {
    el.tabs.innerHTML = '';
    say('No decks yet — open the ⋯ menu and import the list, or add a deck.');
  }
  if (!activeDeck || !decks.some((x) => x.name === activeDeck)) {
    activeDeck = decks.length ? decks[0].name : null;
  }
  render();
  backfillMissing();
}

// -------------------------------------------------------------- rendering

function render() {
  renderTabs();
  renderCards();
}

function renderTabs() {
  el.tabs.innerHTML = '';
  decks.forEach((deck) => {
    const n = cards.filter((c) => c.deck === deck.name).length;
    const b = document.createElement('button');
    b.className = 'deck-tab';
    b.setAttribute('aria-current', String(deck.name === activeDeck));
    b.innerHTML = `${escapeHtml(deck.name)}${n ? ` <span class="count">${n}</span>` : ''}`;
    b.onclick = () => {
      activeDeck = deck.name;
      localStorage.setItem('deck', activeDeck);
      render();
    };
    el.tabs.appendChild(b);
  });
}

function visibleCards() {
  let list = cards.filter((c) => c.deck === activeDeck);

  const fs = el.filterStatus.value;
  const fw = el.filterWho.value;
  if (fs) list = list.filter((c) => (c.status || 'Want') === fs);
  if (fw) list = list.filter((c) => c.who === fw);

  const sort = el.sortBy.value;
  const byPriority = { High: 0, Medium: 1, Low: 2, '': 3, null: 3 };
  list.sort((a, b) => {
    switch (sort) {
      case 'name': return a.name.localeCompare(b.name);
      case 'price-desc': return (b.price || 0) - (a.price || 0);
      case 'price-asc': return (a.price || 0) - (b.price || 0);
      case 'priority':
        return (byPriority[a.priority] ?? 3) - (byPriority[b.priority] ?? 3);
      default:
        return new Date(b.created_at) - new Date(a.created_at);
    }
  });
  return list;
}

function renderCards() {
  const list = visibleCards();
  el.cards.innerHTML = '';
  el.empty.hidden = list.length > 0;

  list.forEach((c) => el.cards.appendChild(cardNode(c)));

  const deckCards = cards.filter((x) => x.deck === activeDeck);
  const open = deckCards.filter((x) => (x.status || 'Want') === 'Want');
  const sum = open.reduce((t, x) => t + (Number(x.price) || 0), 0);
  el.totals.innerHTML =
    `${open.length} still to buy · <strong>${money(sum)}</strong>`;
}

function cardNode(c) {
  const node = document.createElement('article');
  node.className = 'card';

  const art = document.createElement('button');
  art.className = 'art';
  art.type = 'button';
  art.title = 'View card';
  art.innerHTML = c.image_small
    ? `<img loading="lazy" alt="${escapeHtml(c.name)}" src="${escapeHtml(c.image_small)}">`
    : '';
  art.onclick = () => openDetail(c);

  const body = document.createElement('div');
  body.className = 'body';

  const status = c.status || 'Want';
  body.innerHTML = `
    <p class="name">${escapeHtml(c.name)}</p>
    <div class="meta">
      <span class="price">${money(c.price)}</span>
      <span class="badge ${escapeHtml(status)}">${escapeHtml(status)}</span>
    </div>
    <div class="row2">
      <select class="sel-who" aria-label="Who wants it">
        <option value="">Who?</option>
        ${PEOPLE.map((p) => `<option ${c.who === p ? 'selected' : ''}>${escapeHtml(p)}</option>`).join('')}
        <option ${c.who === 'Both' ? 'selected' : ''}>Both</option>
      </select>
      <select class="sel-priority" aria-label="Priority">
        <option value="">Priority</option>
        ${PRIORITIES.map((p) => `<option ${c.priority === p ? 'selected' : ''}>${p}</option>`).join('')}
      </select>
    </div>
    <select class="sel-status" aria-label="Status">
      ${STATUSES.map((s) => `<option ${status === s ? 'selected' : ''}>${s}</option>`).join('')}
    </select>
  `;

  body.querySelector('.sel-who').onchange = (e) => patch(c.id, { who: e.target.value || null });
  body.querySelector('.sel-priority').onchange = (e) => patch(c.id, { priority: e.target.value || null });
  body.querySelector('.sel-status').onchange = (e) => patch(c.id, { status: e.target.value });

  node.append(art, body);
  return node;
}

function openDetail(c) {
  const box = el.detail.querySelector('.detail-body');
  box.innerHTML = `
    ${c.image_normal ? `<img alt="${escapeHtml(c.name)}" src="${escapeHtml(c.image_normal)}">` : ''}
    <h2>${escapeHtml(c.name)}</h2>
    <p class="tl">${escapeHtml(c.type_line || '')} ${c.mana_cost ? '· ' + escapeHtml(c.mana_cost) : ''}</p>
    ${c.oracle_text ? `<div class="oracle">${escapeHtml(c.oracle_text)}</div>` : ''}
    <textarea placeholder="Notes…">${escapeHtml(c.notes || '')}</textarea>
    <div class="detail-actions">
      <a href="${escapeHtml(c.scryfall_url || '#')}" target="_blank" rel="noopener">Open on Scryfall</a>
      <button type="button" class="delete">Remove</button>
    </div>
  `;

  const ta = box.querySelector('textarea');
  ta.onchange = () => patch(c.id, { notes: ta.value });

  box.querySelector('.delete').onclick = async () => {
    if (!confirm(`Remove ${c.name} from ${c.deck}?`)) return;
    el.detail.close();
    await remove(c.id);
  };

  el.detail.showModal();
}

// ---------------------------------------------------------------- writes

async function patch(id, fields) {
  const row = cards.find((c) => c.id === id);
  if (row) Object.assign(row, fields);     // optimistic
  renderCards();
  const { error } = await db.from('cards').update(fields).eq('id', id);
  if (error) { say(error.message, true); await loadAll(); }
}

async function remove(id) {
  cards = cards.filter((c) => c.id !== id);
  render();
  const { error } = await db.from('cards').delete().eq('id', id);
  if (error) { say(error.message, true); await loadAll(); }
}

async function addCard(name) {
  if (!activeDeck) { say('Add a deck first — ⋯ menu → New deck.', true); return; }
  el.add.disabled = true;
  say(`Looking up ${name}…`);
  try {
    const card = await scryfallNamed(name);
    const row = { ...toRow(card), deck: activeDeck, who: me, status: 'Want' };
    const { data, error } = await db.from('cards').insert(row).select().single();
    if (error) throw error;
    cards.push(data);
    el.input.value = '';
    hideSuggestions();
    render();
    say(`Added ${data.name}.`);
  } catch (err) {
    say(err.message || String(err), true);
  } finally {
    el.add.disabled = false;
  }
}

async function refreshPrices() {
  const withIds = cards.filter((c) => c.scryfall_id);
  if (!withIds.length) { say('Nothing to refresh.'); return; }
  say(`Refreshing ${withIds.length} prices…`);
  try {
    const fresh = await scryfallCollection(withIds.map((c) => ({ id: c.scryfall_id })));
    const byId = Object.fromEntries(fresh.map((c) => [c.id, c]));
    let n = 0;
    for (const c of withIds) {
      const f = byId[c.scryfall_id];
      if (!f) continue;
      const price = f.prices && f.prices.usd ? Number(f.prices.usd) : null;
      if (price !== c.price) {
        await db.from('cards')
          .update({ price, price_checked: new Date().toISOString() })
          .eq('id', c.id);
        c.price = price;
        n++;
      }
    }
    render();
    say(n ? `${n} price${n === 1 ? '' : 's'} changed.` : 'Prices are already current.');
  } catch (err) {
    say(err.message || String(err), true);
  }
}

/** Front-face, lowercased — so "Birgi, God of Storytelling" matches the stored "Birgi … // Harnfel …". */
function nameKey(deck, name) {
  return `${deck}::${String(name).split(' // ')[0].trim().toLowerCase()}`;
}

async function importSeed() {
  if (!confirm('Import the deck list and cards from the spreadsheet? Cards already here are kept, not duplicated.')) return;
  try {
    const seed = await (await fetch('seed.json', { cache: 'no-store' })).json();

    for (let i = 0; i < seed.decks.length; i++) {
      const name = seed.decks[i];
      if (decks.some((d) => d.name === name)) continue;
      await db.from('decks').insert({ name, sort_order: i });
    }

    const existing = new Set(cards.map((c) => nameKey(c.deck, c.name)));
    const todo = seed.cards.filter((c) => !existing.has(nameKey(c.deck, c.name)));
    if (!todo.length) { await loadAll(); say('Everything from the spreadsheet is already here.'); return; }

    // One batched Scryfall request instead of one per card.
    say(`Looking up ${todo.length} card${todo.length === 1 ? '' : 's'} on Scryfall…`);
    const found = await scryfallCollection(todo.map((c) => ({ name: c.name })));
    const byKey = {};
    found.forEach((card) => {
      byKey[card.name.toLowerCase()] = card;
      byKey[card.name.split(' // ')[0].toLowerCase()] = card;
    });

    const rows = [];
    const missed = [];
    for (const item of todo) {
      const card = byKey[item.name.toLowerCase()];
      const extra = {
        deck: item.deck,
        who: item.who || null,
        priority: item.priority || null,
        status: item.status || 'Want',
        notes: item.notes || null
      };
      if (card) rows.push({ ...toRow(card), ...extra });
      else { missed.push(item.name); rows.push({ name: item.name, ...extra }); }
    }

    const { error } = await db.from('cards').insert(rows);
    if (error) throw error;
    await loadAll();

    say(missed.length
      ? `Imported ${rows.length}. Scryfall didn't recognise: ${missed.join(', ')} — added by name; fix the spelling or remove them.`
      : `Imported ${rows.length} card${rows.length === 1 ? '' : 's'}.`, missed.length > 0);
  } catch (err) {
    say(err.message || String(err), true);
  }
}

/**
 * Any card stored without Scryfall data (added by name only, or left half-done
 * by an interrupted import) gets looked up and completed. Runs on every load,
 * so gaps fill themselves instead of sitting there silently.
 */
let backfilling = false;
async function backfillMissing() {
  if (backfilling) return;
  const bare = cards.filter((c) => !c.scryfall_id);
  if (!bare.length) return;
  backfilling = true;
  try {
    const found = await scryfallCollection(bare.map((c) => ({ name: c.name })));
    const byKey = {};
    found.forEach((card) => {
      byKey[card.name.toLowerCase()] = card;
      byKey[card.name.split(' // ')[0].toLowerCase()] = card;
    });
    let n = 0;
    for (const c of bare) {
      const card = byKey[c.name.toLowerCase()];
      if (!card) continue;
      const row = toRow(card);
      const { error } = await db.from('cards').update(row).eq('id', c.id);
      if (!error) { Object.assign(c, row); n++; }
    }
    if (n) { render(); say(`Filled in details for ${n} card${n === 1 ? '' : 's'}.`); }
  } catch (err) {
    console.warn('backfill', err);
  } finally {
    backfilling = false;
  }
}

// ----------------------------------------------------------- deck admin

async function newDeck() {
  const name = prompt('Deck name (your commander):');
  if (!name || !name.trim()) return;
  const { error } = await db.from('decks')
    .insert({ name: name.trim(), sort_order: decks.length });
  if (error) return say(error.message, true);
  activeDeck = name.trim();
  localStorage.setItem('deck', activeDeck);
  await loadAll();
}

async function renameDeck() {
  if (!activeDeck) return;
  const name = prompt('New name for this deck:', activeDeck);
  if (!name || name.trim() === activeDeck) return;
  const next = name.trim();
  const { error } = await db.from('decks').update({ name: next }).eq('name', activeDeck);
  if (error) return say(error.message, true);
  await db.from('cards').update({ deck: next }).eq('deck', activeDeck);
  activeDeck = next;
  localStorage.setItem('deck', activeDeck);
  await loadAll();
}

async function deleteDeck() {
  if (!activeDeck) return;
  const n = cards.filter((c) => c.deck === activeDeck).length;
  if (!confirm(`Delete "${activeDeck}" and its ${n} card${n === 1 ? '' : 's'}? This cannot be undone.`)) return;
  await db.from('cards').delete().eq('deck', activeDeck);
  await db.from('decks').delete().eq('name', activeDeck);
  activeDeck = null;
  localStorage.removeItem('deck');
  await loadAll();
}

// ------------------------------------------------------ autocomplete UI

let suggestions = [];
let suggIndex = -1;

function hideSuggestions() {
  el.sugg.hidden = true;
  el.input.setAttribute('aria-expanded', 'false');
  suggestions = [];
  suggIndex = -1;
}

function showSuggestions(names) {
  suggestions = names;
  suggIndex = -1;
  if (!names.length) return hideSuggestions();
  el.sugg.innerHTML = names
    .map((n, i) => `<li role="option" data-i="${i}">${escapeHtml(n)}</li>`).join('');
  el.sugg.hidden = false;
  el.input.setAttribute('aria-expanded', 'true');
}

const onType = debounce(async () => {
  const q = el.input.value.trim();
  if (q.length < 2) return hideSuggestions();
  try {
    showSuggestions(await scryfallAutocomplete(q));
  } catch { hideSuggestions(); }
}, 220);

function highlight(i) {
  suggIndex = i;
  [...el.sugg.children].forEach((li, n) =>
    li.setAttribute('aria-selected', String(n === i)));
}

// ------------------------------------------------------------ wiring up

function wire() {
  el.title.textContent = CFG.TITLE || 'MTG Buy List';
  document.title = el.title.textContent;

  el.whoami.innerHTML = PEOPLE
    .map((p) => `<option ${p === me ? 'selected' : ''}>${escapeHtml(p)}</option>`).join('');
  el.whoami.onchange = () => { me = el.whoami.value; localStorage.setItem('me', me); };

  el.filterWho.innerHTML =
    `<option value="">Anyone</option>` +
    PEOPLE.map((p) => `<option>${escapeHtml(p)}</option>`).join('') +
    `<option>Both</option>`;

  el.input.addEventListener('input', onType);
  el.input.addEventListener('keydown', (e) => {
    if (el.sugg.hidden) {
      if (e.key === 'Enter' && el.input.value.trim()) addCard(el.input.value.trim());
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); highlight(Math.min(suggIndex + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(Math.max(suggIndex - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      addCard(suggIndex >= 0 ? suggestions[suggIndex] : el.input.value.trim());
    } else if (e.key === 'Escape') hideSuggestions();
  });

  el.sugg.onclick = (e) => {
    const li = e.target.closest('li');
    if (li) addCard(suggestions[Number(li.dataset.i)]);
  };

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.combo')) hideSuggestions();
  });

  el.add.onclick = () => {
    const v = el.input.value.trim();
    if (v) addCard(v);
  };

  [el.filterStatus, el.filterWho, el.sortBy].forEach((s) => (s.onchange = renderCards));

  el.menuBtn.onclick = () => el.menu.showModal();
  el.menu.querySelector('.close-menu').onclick = () => el.menu.close();
  el.menu.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-action]');
    if (!b) return;
    el.menu.close();
    const actions = {
      'new-deck': newDeck,
      'rename-deck': renameDeck,
      'delete-deck': deleteDeck,
      'refresh-prices': refreshPrices,
      'import-seed': importSeed
    };
    await actions[b.dataset.action]();
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

function subscribeLive() {
  db.channel('buylist')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'cards' }, loadAll)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'decks' }, loadAll)
    .subscribe();
}

async function main() {
  wire();

  if (!CFG.SUPABASE_URL || CFG.SUPABASE_URL.includes('YOUR-PROJECT')) {
    say('config.js still has placeholder values — add your Supabase URL and anon key. See README step 2.', true);
    return;
  }

  db = createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

  try {
    await loadAll();
    subscribeLive();
    say('');
  } catch (err) {
    say(`Could not reach the database: ${err.message || err}`, true);
  }
}

main();
