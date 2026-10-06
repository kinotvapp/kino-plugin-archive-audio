// @ts-check
/// <reference path="./kino.d.ts" />
// Kino plugin: Internet Archive Audio -- free music, live concerts, audiobooks and old-time radio from archive.org.
// The reference audio plugin (apiVersion 8). Read it top to bottom:
//   1. archive.org client   2. texts   3. collections and lists   4. the tracks of an item   5. metadata cache
//   6. search   7. home and browse   8. section and categories   9. episodes and resolve   10. settings form
// Declared hosts: archive.org and *.archive.org (a download redirects to a storage node such as dn601307.us.archive.org,
// and a wildcard does not cover its own bare domain).

const BASE = "https://archive.org";
// archive.org identifiers: letters, digits, dot, underscore, dash. Also a valid Kino item id.
const VALID_ID = /^[A-Za-z0-9._-]{1,100}$/;

// ---- 1. archive.org client ------------------------------------------------------------------------------------

// Throws only AFTER its first await (README section 6). archive.org answers some failures with 200 and an HTML page
// (rate limiting) or with a JSON `error`: both are "unavailable", with a sentence the person understands.
async function getJson(url) {
  const r = await kino.fetch(url);
  if (!r.ok) throw kino.error("unavailable", `archive.org answered ${r.status}`, { userMessage: t("unavailable") });
  let body;
  try {
    body = await r.json();
  } catch {
    throw kino.error("unavailable", "archive.org answered something that is not JSON", { userMessage: t("unavailable") });
  }
  if (body && body.error) throw kino.error("unavailable", `archive.org: ${String(body.error).slice(0, 150)}`, { userMessage: t("unavailable") });
  return body;
}

function poster(id) {
  return BASE + "/services/img/" + encodeURIComponent(id);
}

function downloadUrl(id, name) {
  return BASE + "/download/" + encodeURIComponent(id) + "/" + name.split("/").map(encodeURIComponent).join("/");
}

// archive.org metadata values are a string, an array of strings, a number or missing: one trimmed string.
function text(v) {
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string").join(", ").trim();
  return v == null ? "" : String(v).trim();
}

// Lowercase letters and digits only, accents folded: how two names are compared.
function squash(s) {
  const lower = String(s || "").toLowerCase();
  return (typeof lower.normalize === "function" ? lower.normalize("NFKD") : lower).replace(/[^a-z0-9]/g, "");
}

const FIELDS = ["identifier", "title", "creator", "year", "collection", "mediatype"];

// archive.org's search (advancedsearch.php). Docs with an identifier Kino can't use as an id are skipped.
async function searchDocs(query, { rows, page = 1, sort = "downloads desc" }) {
  const parts = ["q=" + encodeURIComponent(query)];
  for (const f of FIELDS) parts.push("fl%5B%5D=" + f);
  parts.push("sort%5B%5D=" + encodeURIComponent(sort), "rows=" + rows, "page=" + page, "output=json");
  const body = await getJson(BASE + "/advancedsearch.php?" + parts.join("&"));
  const docs = body && body.response && Array.isArray(body.response.docs) ? body.response.docs : [];
  return docs.filter((d) => d && typeof d.identifier === "string" && VALID_ID.test(d.identifier));
}

// A search doc as a Kino item. `creator` may be a list ("Wonder Band, Guest"); `year` a number.
function toItem(doc) {
  const item = { id: doc.identifier, ref: "item:" + doc.identifier, title: text(doc.title) || doc.identifier, kind: kindOf(doc.collection), poster: poster(doc.identifier) };
  const artist = text(doc.creator);
  if (artist) item.artist = artist.slice(0, 200);
  const year = parseInt(text(doc.year), 10);
  if (year) item.year = String(year);
  return item;
}

// ---- 2. texts -------------------------------------------------------------------------------------------------

// Every text the person reads, in Spanish and English: Kino does not translate a plugin's texts. An error's sentence
// (userMessage) names no domain and not the app: Kino hides a sentence that does and shows its own generic one. kino.lang is the
// person's language ("es-CO"); anything that is not Spanish reads English.
const TEXTS = {
  es: {
    unavailable: "El archivo no responde ahora. Intenta de nuevo en un rato.",
    noAudio: "Este álbum no tiene audio que se pueda reproducir.",
    gone: "Esta pista ya no está disponible.",
    chapter: "Capítulo {n}", episode: "Episodio {n}", track: "Pista {n}",
    q_mp3: "Normal (MP3)", q_light: "Liviana (64 kbps)", q_ogg: "Ogg Vorbis", q_flac: "Sin pérdida (FLAC)",
    row_netlabels: "Discos de netlabels", row_books: "Audiolibros", row_radio: "Radio clásica", row_extra: "Tu colección: {name}",
    tab_music: "Música", tab_live: "Conciertos", tab_books: "Audiolibros", tab_radio: "Radio",
    list_top: "Más escuchados", list_new: "Recién agregados", list_78rpm: "Discos de 78 rpm",
    heroBy: "De {artist}. El destacado de hoy.", heroPick: "El destacado de hoy.",
    genre_jazz: "Jazz", genre_classical: "Clásica", genre_electronic: "Electrónica", genre_liverock: "Rock en vivo",
    genre_blues: "Blues", genre_scifi: "Ciencia ficción (radio)", genre_mystery: "Misterio (radio)", genre_poetry: "Poesía",
    genre_children: "Cuentos infantiles",
    cacheStatus: "Caché: {n} álbumes, {kb} KB", cacheCleared: "Listo: se vació la caché",
    badCollection: "Escribe el identificador de una colección (por ejemplo, librivoxaudio) o su dirección en archive.org",
    emptyCollection: "Esa colección no existe o no tiene audio",
  },
  en: {
    unavailable: "The archive isn't answering right now. Try again in a while.",
    noAudio: "This album has no audio that can be played.",
    gone: "This track is no longer available.",
    chapter: "Chapter {n}", episode: "Episode {n}", track: "Track {n}",
    q_mp3: "Standard (MP3)", q_light: "Light (64 kbps)", q_ogg: "Ogg Vorbis", q_flac: "Lossless (FLAC)",
    row_netlabels: "Netlabel albums", row_books: "Audiobooks", row_radio: "Old-time radio", row_extra: "Your collection: {name}",
    tab_music: "Music", tab_live: "Concerts", tab_books: "Audiobooks", tab_radio: "Radio",
    list_top: "Most played", list_new: "Recently added", list_78rpm: "78 rpm records",
    heroBy: "By {artist}. Today's pick.", heroPick: "Today's pick.",
    genre_jazz: "Jazz", genre_classical: "Classical", genre_electronic: "Electronic", genre_liverock: "Live rock",
    genre_blues: "Blues", genre_scifi: "Science fiction (radio)", genre_mystery: "Mystery (radio)", genre_poetry: "Poetry",
    genre_children: "Children's stories",
    cacheStatus: "Cache: {n} albums, {kb} KB", cacheCleared: "Done: the cache is empty",
    badCollection: "Type an archive.org collection identifier (for example, librivoxaudio) or its address",
    emptyCollection: "That collection doesn't exist or has no audio",
  },
};

function t(key, vars) {
  const lang = String(kino.lang || "").toLowerCase().startsWith("es") ? "es" : "en";
  const template = TEXTS[lang][key] || TEXTS.es[key] || key;
  return vars ? template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k])) : template;
}

// ---- 3. collections and lists ---------------------------------------------------------------------------------

// What each archive.org collection is in Kino. An item lists many collections (favorites, curators...): the first
// one known here decides; an item of none of them (the person's extra collection) is music.
const KIND_OF = { netlabels: "music", "78rpm": "music", etree: "music", librivoxaudio: "podcast", oldtimeradio: "podcast" };

function kindOf(collections) {
  for (const c of [].concat(collections || [])) if (KIND_OF[c]) return KIND_OF[c];
  return "music";
}

// etree items have mediatype "etree", not "audio"; "collection" items (a band's page) are not playable.
const MEDIA = "mediatype:(audio OR etree)";

function liveShowsOn() {
  return kino.config.get("liveShows") !== false;
}

// LibriVox items carry a language code ("spa", "eng"); the setting narrows only them.
function collectionClause(name) {
  const lang = kino.config.get("bookLang");
  if (name === "librivoxaudio" && lang && lang !== "all") return `(collection:(librivoxaudio) AND language:(${lang}))`;
  return `collection:(${name})`;
}

function allCollections() {
  return Object.keys(KIND_OF).filter((c) => c !== "etree" || liveShowsOn());
}

function within(collections, extra) {
  const scope = "(" + collections.map(collectionClause).join(" OR ") + ") AND " + MEDIA;
  return extra ? `${scope} AND ${extra}` : scope;
}

// A list ref is "<scope>:<order>": "music:top", "books:new", "genre-jazz:top", "extra:new". Home rows, section rows,
// genre tiles and "Ver más" all page through these.
const SCOPES = {
  music: ["netlabels", "78rpm"], netlabels: ["netlabels"], "78rpm": ["78rpm"],
  live: ["etree"], books: ["librivoxaudio"], radio: ["oldtimeradio"],
};
const ORDERS = { top: "downloads desc", new: "addeddate desc" };
// [scope, archive.org subject]. Counts measured 2026-10-06: jazz 49,778; classical 5,553; electronic 13,060; live rock
// 13,020; blues 4,032; radio sci-fi 104; LibriVox poetry 2,834.
const GENRES = {
  jazz: ["music", "jazz"], classical: ["music", "classical"], electronic: ["netlabels", "electronic"],
  liverock: ["live", "rock"], blues: ["music", "blues"], scifi: ["radio", "science fiction"],
  mystery: ["radio", "mystery"], poetry: ["books", "poetry"], children: ["books", "children"],
};

// The person's extra collection: an identifier, or its https://archive.org/details/<id> address.
function collectionId(raw) {
  const s = text(raw);
  const m = /^https:\/\/(?:www\.)?archive\.org\/details\/([A-Za-z0-9._-]{1,100})\/?(?:[?#].*)?$/.exec(s);
  const id = m ? m[1] : s;
  return VALID_ID.test(id) ? id : null;
}

function extraCollection() {
  return collectionId(kino.config.get("extraCollection"));
}

// The query of a list, or null for a ref this plugin does not know or that a setting turned off.
function listQuery(ref) {
  const m = /^([a-z0-9-]+):(top|new)$/.exec(String(ref || ""));
  if (!m) return null;
  const [, scope, order] = m;
  const sort = ORDERS[order];
  if (scope === "extra") {
    const id = extraCollection();
    return id ? { query: `collection:(${id}) AND ${MEDIA}`, sort } : null;
  }
  const genre = scope.startsWith("genre-") ? GENRES[scope.slice(6)] : null;
  const collections = (genre ? SCOPES[genre[0]] : SCOPES[scope] || []).filter((c) => c !== "etree" || liveShowsOn());
  if (!collections.length) return null;
  return { query: within(collections, genre ? `subject:(${genre[1]})` : null), sort };
}

async function listItems(ref, page, rows) {
  const list = listQuery(ref);
  if (!list) throw kino.error("not_found", `unknown list ${String(ref).slice(0, 60)}`);
  return (await searchDocs(list.query, { rows, page, sort: list.sort })).map(toItem);
}

// ---- 4. the tracks of an item ---------------------------------------------------------------------------------

// archive.org keeps one ORIGINAL file per track (FLAC for etree, VBR MP3 for netlabels and LibriVox, 128Kbps MP3 for
// 78rpm) and DERIVATIVES made from it, which name it in `original`. A track is that group; each audio format in it is
// a rendition. [rendition, preference]: inside one rendition the higher preference wins (16-bit FLAC over 24-bit,
// which is huge for a phone).
const RENDITIONS = { "VBR MP3": ["mp3", 250], "MP3": ["mp3", 1], "Ogg Vorbis": ["ogg", 1], "Flac": ["flac", 2], "24bit Flac": ["flac", 1] };

// A file's rendition, or null when it is not audio this plugin plays. archive.org also names MP3s by bitrate ("32Kbps
// MP3" to "320Kbps MP3"): an ORIGINAL is the track's MP3 whatever its bitrate (Dragnet's are 24 and 32 kbps); a
// derivative of 64 kbps or less is the light copy.
function renditionOf(f) {
  if (RENDITIONS[f.format]) return RENDITIONS[f.format];
  const m = /^(\d{2,3})Kbps MP3$/.exec(String(f.format || ""));
  if (!m) return null;
  const kbps = Number(m[1]);
  return f.source !== "original" && kbps <= 64 ? ["light", kbps] : ["mp3", kbps];
}

// A private file (many soundboard recordings keep their FLAC original private) answers 403 to everyone: it still names
// its track and gives it a title, but it is never offered as something to play.
function isPrivate(f) {
  return f.private === true || f.private === "true";
}
const MIMES = { mp3: "audio/mpeg", light: "audio/mpeg", ogg: "audio/ogg", flac: "audio/flac" };

// A file's length: seconds ("240.9") on most originals, "mm:ss" or "h:mm:ss" ("10:40") on derivatives. 0 when unknown.
function seconds(length) {
  const s = text(length);
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(s);
  return m ? Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

function baseName(name) {
  return name.slice(name.lastIndexOf("/") + 1);
}

function stem(name) {
  return baseName(name).replace(/\.[A-Za-z0-9]{2,5}$/, "");
}

// The disc of a file: a folder named "CD 2" or "Disc 2", or etree's "d2t05" in the name; else 1.
function discOf(name) {
  const dir = name.includes("/") ? name.slice(0, name.lastIndexOf("/")) : "";
  const folder = /(?:^|\/)(?:cd|dis[ck])[\s_-]*(\d{1,2})(?:\D|$)/i.exec(dir);
  if (folder) return Math.max(1, Number(folder[1]));
  const etree = /d(\d{1,2})t\d{1,3}(?!\d)/i.exec(baseName(name));
  return etree ? Math.max(1, Number(etree[1])) : 1;
}

// "Track 10" after "Track 9": localeCompare cannot be trusted in Kino's engine (README section 6).
function natural(a, b) {
  const x = a.split(/(\d+)/);
  const y = b.split(/(\d+)/);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] === y[i]) continue;
    if (i % 2 === 1) return Number(x[i]) - Number(y[i]);
    return x[i] < y[i] ? -1 : 1;
  }
  return x.length - y.length;
}

// The groups of an item's files, in play order: by disc, then by the `track` number ("3/15", "03"), then by name.
// Nothing here is localized, so it can be cached (titles are finished per call, in finishTracks).
function tracksOf(files) {
  const list = Array.isArray(files) ? files.filter((f) => f && typeof f.name === "string") : [];
  const byName = new Map(list.map((f) => [f.name, f]));
  // The original a file comes from, following `original` (a 64 kbps copy may be made from a VBR one).
  const rootOf = (f) => {
    let cur = f;
    for (let i = 0; i < 4 && cur.source !== "original" && cur.original && byName.has(cur.original); i++) cur = byName.get(cur.original);
    return cur.source === "original" ? cur.name : cur.original || cur.name;
  };
  const groups = new Map();
  for (const f of list) {
    const r = renditionOf(f);
    if (!r) continue;
    const key = rootOf(f);
    let g = groups.get(key);
    if (!g) {
      g = { key, files: {}, pref: {}, title: "", artist: "", track: 0, secs: 0, disc: discOf(key) };
      groups.set(key, g);
    }
    const [rendition, pref] = r;
    if (!isPrivate(f) && !(g.pref[rendition] >= pref)) {
      g.files[rendition] = f.name;
      g.pref[rendition] = pref;
    }
    if (!g.title) g.title = text(f.title);
    if (!g.artist) g.artist = text(f.artist);
    if (!g.track) g.track = parseInt(text(f.track), 10) > 0 ? parseInt(text(f.track), 10) : 0;
    if (!g.secs) g.secs = seconds(f.length);
  }
  return [...groups.values()]
    .filter((g) => Object.keys(g.files).length)
    .map(({ pref, ...g }) => g)
    .sort((a, b) => a.disc - b.disc || (a.track || 1e9) - (b.track || 1e9) || natural(a.key, b.key));
}

// A title from a file name: "Caruso-AddioAllaMadre.mp3" by Caruso -> "Addio Alla Madre".
function titleFromName(name, creator) {
  let s = stem(name);
  const dash = s.indexOf("-");
  if (dash > 0 && squash(creator) && squash(s.slice(0, dash)) === squash(creator)) s = s.slice(dash + 1);
  s = s.replace(/^\d{1,3}[\s._-]+/, "").replace(/_+/g, " ").replace(/([a-z\d])([A-Z])/g, "$1 $2").replace(/([A-Z])([A-Z][a-z])/g, "$1 $2").replace(/\s+/g, " ").trim();
  return s || stem(name);
}

// The tracks as the person reads them, numbered 1, 2, 3 inside each disc. A title that is only the file's stem
// ("wonderland_ch_01") says nothing: an audiobook's becomes "Chapter N"; anything else is rebuilt from the file name,
// where radio shows keep the episode's title ("Forecast 400722 The Lodger"), and a name with no word in it becomes
// "Episode N" or "Track N". When the tracks have more than one artist (a compilation), each title starts with its own.
function finishTracks(groups, kind, creator, book) {
  const artists = new Set(groups.map((g) => squash(g.artist)).filter(Boolean));
  const compilation = kind === "music" && artists.size > 1;
  const perDisc = new Map();
  return groups.map((g) => {
    const number = (perDisc.get(g.disc) || 0) + 1;
    perDisc.set(g.disc, number);
    let title = g.title && squash(g.title) !== squash(stem(g.key)) ? g.title : "";
    if (!title && book) title = t("chapter", { n: number });
    if (!title) {
      const fromName = titleFromName(g.key, creator);
      title = /[A-Za-z\u00C0-\uFFFF]/.test(fromName) ? fromName : t(kind === "podcast" ? "episode" : "track", { n: number });
    }
    if (compilation && g.artist) title = `${g.artist} — ${title}`;
    return { key: g.key, disc: g.disc, number, title, secs: g.secs, files: g.files };
  });
}

// An item's metadata, trimmed to what this plugin uses. archive.org answers `{}` for an identifier it does not have.
async function fetchItem(id) {
  const body = await getJson(BASE + "/metadata/" + encodeURIComponent(id));
  if (!body || !body.metadata) throw kino.error("not_found", `archive.org has no item ${id}`);
  const m = body.metadata;
  return {
    id,
    title: text(m.title) || id,
    creator: text(m.creator),
    kind: kindOf(m.collection),
    book: [].concat(m.collection || []).includes("librivoxaudio"),
    year: parseInt(text(m.date) || text(m.year), 10) || 0,
    overview: plain(m.description),
    groups: tracksOf(body.files),
    at: Date.now(),
  };
}

// archive.org descriptions are HTML: Kino shows plain text.
function plain(html) {
  return text(html)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
}

// ---- 5. metadata cache ----------------------------------------------------------------------------------------

// Opening an album and then playing each track would ask archive.org for the same metadata every time. kino.storage
// keeps it for 24 h (ttlMs: an expired entry is gone by itself). It holds 256 KB in all, so a huge item (a radio show
// of 500 episodes) is simply not cached, and a full storage gives up its oldest album. What is cached has no
// localized text: the person may switch Kino's language tomorrow.
// Versioned: a release that changes what is cached bumps it, and yesterday's entries are simply never read again.
const CACHE_PREFIX = "meta1:";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_ENTRY_MAX = 48 * 1024;

function cacheKeys() {
  return kino.storage.keys().filter((k) => k.startsWith(CACHE_PREFIX));
}

function readCache(id) {
  const raw = kino.storage.get(CACHE_PREFIX + id);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    kino.storage.remove(CACHE_PREFIX + id);
    return null;
  }
}

function evictOldest() {
  let victim = null;
  let oldest = Infinity;
  for (const key of cacheKeys()) {
    let at = 0;
    try {
      at = JSON.parse(kino.storage.get(key) || "{}").at || 0;
    } catch {
      // unreadable: the first to go
    }
    if (at < oldest) {
      oldest = at;
      victim = key;
    }
  }
  if (!victim) return false;
  kino.storage.remove(victim);
  return true;
}

// A cache never fails the call it serves: anything storage refuses is just not cached.
function writeCache(id, item) {
  const raw = JSON.stringify(item);
  if (raw.length > CACHE_ENTRY_MAX) return;
  for (let tries = 0; tries < 20; tries++) {
    try {
      kino.storage.set(CACHE_PREFIX + id, raw, { ttlMs: CACHE_TTL_MS });
      return;
    } catch (e) {
      if (!e || e.code !== "too_large" || !evictOldest()) return;
    }
  }
}

async function itemOf(id) {
  const cached = readCache(id);
  if (cached) return cached;
  const item = await fetchItem(id);
  writeCache(id, item);
  return item;
}

// ---- 6. search ------------------------------------------------------------------------------------------------

// archive.org answers 200 with an error body when the text has a stray / - & ' or a dangling AND/OR/NOT, so only
// letters, digits and apostrophes inside words are kept, and the operator words go.
function cleanText(raw) {
  return String(raw || "")
    .replace(/[^\p{L}\p{M}\p{N}' ]+/gu, " ")
    .replace(/(?<![\p{L}\p{M}\p{N}])'|'(?![\p{L}\p{M}\p{N}])/gu, " ")
    .replace(/(?<![\p{L}\p{M}\p{N}])(and|or|not)(?![\p{L}\p{M}\p{N}])/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// One request over every enabled collection, by title and by creator (people search for "Caruso" as often as for an
// album). `type` only orders: Kino derives it from a guess, never filter by it.
export async function search(query) {
  const typed = cleanText(kino.rank.shortQuery(String(query.q || "")));
  if (!typed) return [];
  const titles = [query.q, query.originalTitle].concat(Array.isArray(query.altTitles) ? query.altTitles : []).filter((x) => typeof x === "string" && x.trim());
  const docs = await searchDocs(within(allCollections(), `(title:(${typed}) OR creator:(${typed}))`), { rows: 100 });
  const words = (item) => [item.title, item.artist || ""];
  const items = docs.map(toItem);
  const ranked = kino.rank.sortBySimilarity(kino.rank.filterRelevant(items, titles, words), titles, words);
  if (query.type !== "music" && query.type !== "podcast") return ranked;
  return ranked.filter((i) => i.kind === query.type).concat(ranked.filter((i) => i.kind !== query.type));
}

// ---- 7. home and browse ---------------------------------------------------------------------------------------

const ROW_SIZE = 30;
const PAGE_SIZE = 50;

// One row, or null: a row archive.org fails to answer is logged and left out, never taking the others with it.
async function rowOf(id, ref, title, genre) {
  try {
    const items = await listItems(ref, 1, ROW_SIZE);
    if (!items.length) return null;
    const row = { id, title, ref, items };
    if (genre) row.genre = genre;
    return row;
  } catch (e) {
    kino.log(`row ${id} failed: ${e && e.message}`);
    return null;
  }
}

// Kino allows 6 fetches in flight per plugin: never start more than `limit` at once.
async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return out;
}

export async function home() {
  const plan = [];
  const extra = extraCollection();
  if (extra) plan.push(["extra", "extra:new", t("row_extra", { name: extra })]);
  plan.push(["netlabels", "netlabels:top", t("row_netlabels"), "musica"], ["books", "books:top", t("row_books")], ["radio", "radio:top", t("row_radio")]);
  return (await mapLimit(plan, 4, (r) => rowOf(...r))).filter(Boolean);
}

export async function browse(ref, cursor) {
  const page = Math.max(1, parseInt(cursor || "1", 10) || 1);
  const items = await listItems(ref, page, PAGE_SIZE);
  return items.length === PAGE_SIZE ? { items, next: String(page + 1) } : { items };
}

// ---- 8. section and categories --------------------------------------------------------------------------------

// The plugin's own section (a chip on the phone's Inicio, an entry in the TV's sidebar): one tab per kind of audio.
const TABS = {
  music: ["music:top", "music:new", "78rpm:top"],
  live: ["live:top", "live:new"],
  books: ["books:top", "books:new"],
  radio: ["radio:top", "radio:new"],
};

function listTitle(ref) {
  return ref === "78rpm:top" ? t("list_78rpm") : t("list_" + ref.split(":")[1]);
}

// Today's pick: the same all day for everyone, a different one tomorrow (the day number picks it, not chance).
function heroOf(items) {
  const item = items[Math.floor(Date.now() / 86400000) % items.length];
  const hero = { title: item.title, text: item.artist ? t("heroBy", { artist: item.artist }) : t("heroPick") };
  if (item.poster) hero.image = item.poster;
  return hero;
}

export async function section({ tab }) {
  const tabs = Object.keys(TABS).filter((id) => id !== "live" || liveShowsOn()).map((id) => ({ id, label: t("tab_" + id) }));
  const chosen = tabs.some((x) => x.id === tab) ? tab : "music";
  const rows = (await mapLimit(TABS[chosen], 3, (ref) => rowOf(`${chosen}-${ref.replace(":", "-")}`, ref, listTitle(ref)))).filter(Boolean);
  const answer = { tabs, tab: chosen, rows };
  if (rows.length) answer.hero = heroOf(rows[0].items);
  return answer;
}

// Genre tiles in Kino's Categorías. Each is asked for its most played item (its cover is the tile's art); a genre
// with nothing, one archive.org fails to answer, or one a setting switched off is simply not offered.
export async function categories() {
  const tiles = await mapLimit(Object.keys(GENRES), 4, async (id) => {
    const ref = `genre-${id}:top`;
    if (!listQuery(ref)) return null;
    try {
      const [first] = await listItems(ref, 1, 1);
      return first ? { id, title: t("genre_" + id), ref, art: first.poster } : null;
    } catch (e) {
      kino.log(`genre ${id} failed: ${e && e.message}`);
      return null;
    }
  });
  return tiles.filter(Boolean);
}

// ---- 9. episodes and resolve ----------------------------------------------------------------------------------

function itemIdOf(ref) {
  const m = /^item:([A-Za-z0-9._-]{1,100})$/.exec(String(ref || ""));
  return m ? m[1] : null;
}

// "track:<id>/<file>" plays a track in the person's quality; "track:<id>/<file>|<rendition>" is one copy of it.
function trackRefOf(ref) {
  const m = /^track:([A-Za-z0-9._-]{1,100})\/(.+?)(?:\|(mp3|light|ogg|flac))?$/.exec(String(ref || ""));
  return m ? { id: m[1], key: m[2], rendition: m[3] || null } : null;
}

// Kino asks this for every music and podcast item, even a single 78 rpm side: it answers one track.
export async function episodes(ref) {
  const id = itemIdOf(ref);
  if (!id) throw kino.error("not_found", `not an item ref: ${String(ref).slice(0, 80)}`);
  const item = await itemOf(id);
  const tracks = finishTracks(item.groups, item.kind, item.creator, item.book);
  if (!tracks.length) throw kino.error("not_found", `no playable audio in ${id}`, { userMessage: t("noAudio") });
  const series = { title: item.title, poster: poster(id) };
  if (item.overview) series.overview = item.overview;
  if (item.year) series.year = String(item.year);
  return {
    series,
    episodes: tracks.map((tr) => {
      const e = { season: tr.disc, number: tr.number, ref: `track:${id}/${tr.key}`, title: tr.title, still: poster(id) };
      if (tr.secs) e.runtimeMinutes = Math.max(1, Math.round(tr.secs / 60));
      return e;
    }),
  };
}

// The renditions to try, best first, for each quality setting. A missing one falls back to the next.
const QUALITY_ORDER = {
  standard: ["mp3", "ogg", "flac", "light"],
  light: ["light", "mp3", "ogg", "flac"],
  lossless: ["flac", "mp3", "ogg", "light"],
};

// A track in the person's quality, with the other renditions as labelled LAZY copies (apiVersion 6): Kino shows them
// in the player's Servidor menu and resolves one only when it is picked, used as a fallback or chosen for a download.
// A copy's own ref ends in "|<rendition>" and resolves to exactly that file, with no copies of its own.
export async function resolve(ref) {
  const tr = trackRefOf(ref);
  if (!tr) throw kino.error("not_found", `not a track ref: ${String(ref).slice(0, 80)}`);
  const item = await itemOf(tr.id);
  const group = item.groups.find((g) => g.key === tr.key);
  const setting = kino.config.get("quality");
  const order = tr.rendition ? [tr.rendition] : QUALITY_ORDER[setting] || QUALITY_ORDER.standard;
  const rendition = group && order.find((r) => group.files[r]);
  if (!group || !rendition) throw kino.error("not_found", `${tr.id} has no ${tr.rendition || "audio"} for ${tr.key.slice(0, 80)}`, { userMessage: t("gone") });
  // A degraded result the author wants to hear about (telemetry): at most one report per area an hour reaches Kino.
  // Codes only, never what the person plays (the identifier came from their library).
  if (rendition !== order[0]) kino.log.report("quality_fallback", order[0], rendition);
  const stream = { url: downloadUrl(tr.id, group.files[rendition]), mime: MIMES[rendition], label: t("q_" + rendition) };
  if (group.secs) stream.durationMs = Math.round(group.secs * 1000);
  if (!tr.rendition) {
    const others = Object.keys(MIMES).filter((r) => r !== rendition && group.files[r]);
    if (others.length) stream.alternatives = others.map((r) => ({ label: t("q_" + r), ref: `${ref}|${r}` }));
  }
  return stream;
}

// ---- 10. settings form ----------------------------------------------------------------------------------------

// The "Estado" line (a `status` setting): Kino asks it when the form opens and after every action.
export async function settingsStatus() {
  const keys = cacheKeys();
  let chars = 0;
  for (const k of keys) chars += k.length + (kino.storage.get(k) || "").length;
  return { cache: t("cacheStatus", { n: keys.length, kb: Math.ceil(chars / 1024) }) };
}

// The "Vaciar caché" button (an `action` setting). It touches only the cache, never anything else in storage.
export async function action(key) {
  if (key !== "clearCache") throw kino.error("not_found", `unknown action ${String(key).slice(0, 40)}`);
  for (const k of cacheKeys()) kino.storage.remove(k);
  return { message: t("cacheCleared") };
}

// Runs before Kino saves the form: an extra collection must be a real archive.org collection with audio in it.
export async function validateSettings(values) {
  const raw = values && typeof values.extraCollection === "string" ? values.extraCollection.trim() : "";
  if (!raw) return null;
  const id = collectionId(raw);
  if (!id) return { extraCollection: t("badCollection") };
  const docs = await searchDocs(`collection:(${id}) AND ${MEDIA}`, { rows: 1 });
  return docs.length ? null : { extraCollection: t("emptyCollection") };
}
