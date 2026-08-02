#!/usr/bin/env python3
"""Merge per-service library scans into library.json.

Sources (in data/):
  google.json   - [[title, slug, isTv], ...]
  amazon.json   - {"movies": [[title, asin]...], "tv": [[title, asin]...]}
  fandango.txt  - slug/id;slug/id;...

Titles are normalized (editions stripped) so the same film owned on
multiple services becomes ONE entry with multiple watch locations.
"""
import json, re, sys, os, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, '..', 'data')
OUT = os.path.join(HERE, '..', 'library.json')

EDITION_PAT = re.compile(
    r"\s*[\(\[]?\b(unrated|extended(\s+(edition|cut|version))?|theatrical(\s+(edition|cut|version))?|"
    r"director'?\s?s\s+cut|deluxe\s+edition|ultimate\s+edition|special\s+edition|final\s+cut|"
    r"with\s+bonus\s+content|bonus\s+features?|uncut(\s+version)?|extended\s+edition|"
    r"\d+(th|st|nd|rd)\s+anniversary(\s+edition)?|imax(\s+enhanced)?|remastered)\b[\)\]]?\s*",
    re.I)
YEAR_PAT = re.compile(r"\s*\((\d{4})\)\s*")

ARTICLES = ("the ", "a ", "an ")

def norm(title):
    t = title.lower()
    t = re.sub(r"^(.*),\s*(the|a|an)$", r"\2 \1", t.strip())  # "X, The" -> "The X"
    t = YEAR_PAT.sub(' ', t)
    for _ in range(3):
        t = EDITION_PAT.sub(' ', t)
    t = re.sub(r"[^a-z0-9]+", ' ', t).strip()
    # normalize leading article position ("lord of the rings, the" style)
    t = re.sub(r"^(.*),\s*(the|a|an)$", r"\2 \1", t)
    t = re.sub(r"\s+(the|a|an)$", '', t)  # dangling article left by edition-stripping
    t = re.sub(r"\s+", ' ', t)
    return t

def year_of(title):
    m = YEAR_PAT.search(title)
    return int(m.group(1)) if m else None

def edition_of(title):
    m = EDITION_PAT.search(title)
    return re.sub(r"[\(\)\[\]]", '', m.group(0)).strip().title() if m else None

def deslug(slug):
    t = slug.replace('-', ' ').replace('_', ' ')
    t = re.sub(r"\s+", ' ', t).strip()
    return t

# Known normalization aliases (scan titles that refer to the same film)
ALIASES = {
    'batman the movie': 'batman 1966',
    '1776 director s cut': '1776',
    'psycho 1960': 'psycho',
    'saban s power rangers': 'power rangers',
    'sabans power rangers': 'power rangers',
    'final fantasy vii advent children complete': 'final fantasy vii advent children',
    'final fantasy the sprits within': 'final fantasy the spirits within',
    'dragon ball z battle of gods': 'dragon ball z battle of gods',
    'the hobbit the battle of five armies': 'the hobbit the battle of the five armies',
    'the hobbit the battle of the five armies part 3 20': 'the hobbit the battle of the five armies',
    'a team': 'the a team',
    'day watch dnevnoy dozor': 'day watch',
    'night watch nochnoy dozor': 'night watch',
    'love never dies': 'love never dies',
    'andrew lloyd webber s love never dies': 'love never dies',
    'wonder woman 2017': 'wonder woman',
    'max payne theatrical': 'max payne',
    'overboard': 'overboard 2018',  # both scans are the 2018 film
    'underworld 2003': 'underworld',
    'batman robin': 'batman and robin',
    'ben hur 1959': 'ben hur',
    'the agony and the ecstasy': 'the agony and the ecstasy',
    'agony and the ecstasy the': 'the agony and the ecstasy',
    'the martian': 'the martian',
    'monsters inc': 'monsters inc',
    '101 dalmatians 1961': '101 dalmatians',
    'the italian job 2003': 'the italian job',
    'the amateur 2025': 'the amateur',
    'the transformers the movie': 'the transformers the movie',
    'lord of the rings the the return of the king': 'the lord of the rings the return of the king',
    'the lord of the rings 1978': 'the lord of the rings',
    'the lord of the rings': 'the lord of the rings',  # 1978 animated (Fandango slug The-Lord-of-the-Rings/9511)
    'ghostbusters 2016': 'ghostbusters answer the call',
    'ghostbusters 2': 'ghostbusters ii',
    'a star is born 1954': 'a star is born',
    'the secret garden 1993': 'the secret garden',
    'redline 2011': 'redline',
    'cabaret 1972': 'cabaret',
    'cimarron 1931': 'cimarron',
    'hamlet 1996': 'hamlet',
    'godzilla 2014': 'godzilla',
    'man of steel 2013': 'man of steel',
    'suicide squad 2016': 'suicide squad',
    'wrath of the titans 2012': 'wrath of the titans',
    'the poseidon adventure 1972': 'the poseidon adventure',
    'sherlock holmes 2009': 'sherlock holmes',
    'batman 1989': 'batman',
    'dune part two': 'dune part two',
    'meet me in st louis': 'meet me in st louis',
}

def canon(title):
    n = norm(title)
    return ALIASES.get(n, n)

entries = {}  # key -> entry

def add(key, display, service, url, note=None, tv=False, year=None):
    e = entries.setdefault(key, {
        'title': display, 'type': 'tv' if tv else 'movie',
        'year': year, 'services': {}})
    if year and not e.get('year'):
        e['year'] = year
    svc = e['services'].setdefault(service, [])
    svc.append({'url': url, **({'note': note} if note else {})})

def better_title(a, b):
    """prefer the cleaner/shorter display title"""
    return a if len(a) <= len(b) else b

# ---- Google ----
with open(os.path.join(DATA, 'google.json')) as f:
    google = json.load(f)
for title, slug, is_tv in google:
    disp = YEAR_PAT.sub(lambda m: '', title).strip()
    y = year_of(title)
    note = edition_of(title)
    url = ('https://play.google.com/store/tv/show?id=' + slug) if is_tv and slug == 'show' \
        else 'https://play.google.com/store/movies/details/' + slug
    if is_tv and slug == 'show':
        url = 'https://play.google.com/library/tv'
    key = ('tv:' if is_tv else '') + canon(title)
    add(key, disp, 'google', url, note, tv=bool(is_tv), year=y)
    if disp and entries[key]['title'] != disp:
        entries[key]['title'] = better_title(entries[key]['title'], disp)

# ---- Amazon ----
with open(os.path.join(DATA, 'amazon.json')) as f:
    amazon = json.load(f)
for title, asin in amazon['movies']:
    disp = re.sub(r"^(.*),\s*(The|A|An)$", r"\2 \1", YEAR_PAT.sub('', title).strip())
    y = year_of(title)
    note = edition_of(title)
    url = 'https://www.amazon.com/gp/video/detail/' + asin
    key = canon(title)
    add(key, disp, 'amazon', url, note, year=y)
    entries[key]['title'] = better_title(entries[key]['title'], disp)
for title, asin in amazon['tv']:
    url = 'https://www.amazon.com/gp/video/detail/' + asin
    # season info stays in the note, series name is the entry
    m = re.match(r"^(.*?)(?:[,:\-–]?\s*(?:Season\s*\d+.*|S\d+|Volume\s*\d+.*|The Complete Series|Part\s*\d+.*))?$", title, re.I)
    series = m.group(1).strip(' ,:-') if m else title
    note = title[len(series):].strip(' ,:-') or None
    key = 'tv:' + canon(series)
    add(key, series, 'amazon', url, note, tv=True)

# ---- Fandango ----
with open(os.path.join(DATA, 'fandango.txt')) as f:
    fan = f.read().strip()
for item in fan.split(';'):
    slug, fid = item.rsplit('/', 1)
    disp = deslug(slug)
    note = edition_of(disp)
    y = None
    # a slug like "The-Amateur-2025-" (trailing dash) means "(2025)" — a
    # disambiguation year, not part of the title (unlike Fantasia-2000)
    if re.search(r"-(19|20)\d{2}-$", slug):
        ym = re.search(r"\b(19|20)\d{2}\b\s*$", disp)
        y = int(ym.group(0)); disp = disp[:ym.start()].strip()
    disp = EDITION_PAT.sub(' ', disp)
    disp = re.sub(r"\s+", ' ', disp).strip()
    url = f'https://athome.fandango.com/content/browse/details/{slug}/{fid}'
    key = canon(deslug(slug))
    add(key, disp, 'fandango', url, note, year=y)
    entries[key]['title'] = better_title(entries[key]['title'], disp)

# ---- finalize ----
lib = []
for key, e in sorted(entries.items(), key=lambda kv: kv[1]['title'].lower()):
    e['title'] = re.sub(r"\s+(The|A|An)$", '', e['title'])
    e['id'] = re.sub(r"[^a-z0-9]+", '-', key).strip('-')
    e['serviceCount'] = len(e['services'])
    lib.append(e)

out = {
    'generated': datetime.date.today().isoformat(),
    'sources': ['google', 'amazon', 'fandango'],
    'items': lib,
}
with open(OUT, 'w') as f:
    json.dump(out, f, indent=1)

movies = [e for e in lib if e['type'] == 'movie']
tv = [e for e in lib if e['type'] == 'tv']
multi = [e for e in lib if e['serviceCount'] > 1]
print(f"entries: {len(lib)}  movies: {len(movies)}  tv: {len(tv)}  multi-service: {len(multi)}")
for e in multi:
    print('  MULTI:', e['title'], '->', ', '.join(e['services']))
