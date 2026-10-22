'use strict';
/* =========================================================
   Barrow Convergence — Barrow Family Association Y-DNA
   Based on "Y-DNA Lineage Reconstruction: Theory and Application"
   by David C. Joyce
   The data comes from the three CSV files in this folder.
   ========================================================= */

const FILES = { ancestors: 'barrow-ancestors.csv', testers: 'barrow-testers.csv', snps: 'barrow-snps.csv', places: 'barrow-places.csv' };
let D = null;
let view = { page: 'home', sig: '', lin: '' };

/* ---------- Helpers ---------- */
function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function yearNum(v) { const m = String(v || '').match(/\d{3,4}/); return m ? Number(m[0]) : null; }
/* A man's dates as they read in the records: 1679–1715, b. 1671, c. 1600. */
function lifeOf(m) {
  if (m.birth && m.death) return `${m.birth}–${m.death}`;
  if (m.birth) return /^c/i.test(m.birth) ? m.birth : `b. ${m.birth}`;
  if (m.death) return `d. ${m.death}`;
  return '';
}
function plural(n, one, many) { return `${n} ${n === 1 ? one : (many || one + 's')}`; }
/* The region a place belongs to: the state in America, or the county and country in the British Isles. */
const OLD_WORLD = ['England', 'Scotland', 'Ireland', 'Wales'];
function regionOf(place) {
  const p = String(place || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!p.length) return '';
  const last = p[p.length - 1];
  return OLD_WORLD.includes(last) && p.length > 1 ? `${p[p.length - 2]}, ${last}` : last;
}

/* ---------- Reading the CSV files ---------- */
function parseCSV(text) {
  text = String(text).replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const head = (rows.shift() || []).map(h => h.trim());
  return rows.filter(r => r.some(x => x.trim() !== '')).map(r => {
    const o = {};
    head.forEach((h, i) => { o[h] = (r[i] || '').trim(); });
    return o;
  });
}
async function loadData() {
  const get = async f => {
    const r = await fetch(f, { cache: 'no-store' });
    if (!r.ok) throw new Error(f);
    return parseCSV(await r.text());
  };
  const [A, T, S] = await Promise.all([get(FILES.ancestors), get(FILES.testers), get(FILES.snps)]);
  /* Map positions are optional: without barrow-places.csv the rest of the app still works. */
  const P = await get(FILES.places).catch(() => []);
  const data = buildData(A, T, S);
  data.places = new Map(P.filter(p => p['Place'] && p['Latitude'] && p['Longitude']).map(p => [p['Place'].trim().toLowerCase(), [Number(p['Latitude']), Number(p['Longitude'])]]));
  return data;
}
/* Links each man to his father and sons, each SNP to the man it formed in, and each tester to his line. */
function buildData(A, T, S) {
  const men = new Map();
  A.forEach(a => men.set(a['ID'], {
    id: a['ID'], father: a['Father ID'], sig: a['Signature'], lineage: a['Lineage'], name: a['Name'],
    birth: a['Birth year'], death: a['Death year'], bplace: a['Birth place'], dplace: a['Death place'], notes: a['Notes'],
    kids: [], snps: [], testers: []
  }));
  men.forEach(m => { const f = men.get(m.father); if (f) f.kids.push(m); });
  men.forEach(m => m.kids.sort((x, y) => (yearNum(x.birth) || 0) - (yearNum(y.birth) || 0)));
  const snps = S.map(s => ({
    sig: s['Signature'], name: s['SNP'], parent: s['Parent SNP'], formedIn: s['Formed in'], year: s['Formation year'],
    place: s['Place'], lineage: s['Lineage'], notes: s['Notes'], kids: []
  }));
  snps.forEach(s => {
    const m = men.get(s.formedIn);
    if (m) m.snps.push(s);
    const p = snps.find(x => x.name === s.parent);
    if (p) p.kids.push(s);
  });
  const testers = T.map(t => ({ kit: t['Kit'], sig: t['Signature'], lineage: t['Lineage'], snp: t['Terminal SNP'], gg: t['Great-grandfather ID'] }));
  testers.forEach(t => { const m = men.get(t.gg); if (m) m.testers.push(t); });
  const sigs = [...new Set(A.map(a => a['Signature']).concat(S.map(s => s['Signature'])).filter(Boolean))];
  return { men, snps, testers, sigs };
}

/* ---------- Questions about the data ---------- */
function allMen() { return [...D.men.values()]; }
function lineagesOf(sig) { return [...new Set(allMen().filter(m => m.sig === sig).map(m => m.lineage).filter(Boolean))]; }
function menOf(lin) { return allMen().filter(m => m.lineage === lin); }
function rootsOf(lin) { return menOf(lin).filter(m => { const f = D.men.get(m.father); return !f || f.lineage !== lin; }); }
function testersOfSig(sig) { return D.testers.filter(t => t.sig === sig); }
function testersOfLin(lin) { return D.testers.filter(t => t.lineage === lin); }
function testersUnder(m) { return m.testers.concat(...m.kids.map(testersUnder)); }
/* The earliest man in a lineage with a known birth year. */
function earliestOf(list) { return list.filter(m => yearNum(m.birth) != null).sort((x, y) => yearNum(x.birth) - yearNum(y.birth))[0] || null; }
/* Where the documented men were born and died, in order of the first record in each region. */
function presence(men) {
  const R = new Map();
  men.forEach(m => [[m.bplace, m.birth], [m.dplace, m.death]].forEach(([place, yr]) => {
    const r = regionOf(place), y = yearNum(yr);
    if (!r) return;
    const e = R.get(r) || { region: r, first: null, men: new Set() };
    if (y != null && (e.first == null || y < e.first)) e.first = y;
    e.men.add(m.id);
    R.set(r, e);
  }));
  return [...R.values()].sort((a, b) => (a.first == null ? 9999 : a.first) - (b.first == null ? 9999 : b.first));
}

/* ---------- Pieces of a page ---------- */
function snpTag(s) { return `<span class="snp-node target" title="${esc(s.name)} formed in him">${esc(s.name)}</span>`; }
/* Testers listed by their terminal SNP: names and kits are never shown. */
function testerTags(list) {
  const by = {};
  list.forEach(t => { by[t.snp || 'No SNP'] = (by[t.snp || 'No SNP'] || 0) + 1; });
  return Object.entries(by).map(([snp, n]) => `<span class="tester-tag">${plural(n, 'tester')} · ${esc(snp)}</span>`).join('');
}
function presenceTable(men) {
  const rows = presence(men);
  if (!rows.length) return '<p class="muted">No places recorded yet.</p>';
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Region</th><th>First record</th><th>Men recorded there</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${esc(r.region)}</td><td class="calc">${r.first == null ? '—' : r.first}</td><td class="calc">${r.men.size}</td></tr>`).join('')}
  </tbody></table></div>`;
}
/* The documented line as a family tree, oldest man at the top. When the line's earliest man has a father
   recorded in another lineage, that shared ancestor is drawn at the top too, so both lines show where they meet. */
function lineTree(lin) {
  const node = (m, kids) => {
    const places = [m.bplace && `b. ${m.bplace}`, m.dplace && `d. ${m.dplace}`].filter(Boolean).join(' · ');
    const shared = m.lineage !== lin ? `<span class="hint">shared ancestor with the ${esc(m.lineage)} line</span>` : '';
    const hl = m.id === view.hl ? ' style="outline:3px solid var(--bronze);outline-offset:2px"' : '';
    return `<li><div class="ut-row" data-man="${esc(m.id)}"><span class="anc-node"${hl}>${esc(m.name)}</span>${lifeOf(m) ? `<span class="hint">${esc(lifeOf(m))}</span>` : ''}${m.snps.map(snpTag).join('')}${testerTags(m.testers)}${shared}</div>
      ${places ? `<div class="hint" style="margin:2px 0 0 4px">${esc(places)}</div>` : ''}${kids.length ? `<ul>${kids.map(k => node(k, k.kids.filter(x => x.lineage === lin))).join('')}</ul>` : ''}</li>`;
  };
  const tops = [];
  rootsOf(lin).forEach(r => {
    const f = D.men.get(r.father);
    if (!f) { tops.push({ m: r, kids: r.kids.filter(x => x.lineage === lin) }); return; }
    let t = tops.find(x => x.m === f);
    if (!t) { t = { m: f, kids: [] }; tops.push(t); }
    t.kids.push(r);
  });
  return `<div class="tree utree"><ul>${tops.map(t => node(t.m, t.kids)).join('')}</ul></div>`;
}
/* The signature's SNP tree, oldest SNP at the top, each with the man it formed in. */
function snpTree(sig) {
  const list = D.snps.filter(s => s.sig === sig);
  const roots = list.filter(s => !list.some(x => x.name === s.parent));
  if (!roots.length) return '<p class="muted">No SNPs recorded yet.</p>';
  const draw = nodes => `<ul>${nodes.map(s => {
    const m = D.men.get(s.formedIn);
    const who = m ? `<span class="anc-node ut-link" data-go="lin" data-sig="${esc(sig)}" data-lin="${esc(m.lineage)}">${esc(m.name)}${lifeOf(m) ? ' (' + esc(lifeOf(m)) + ')' : ''}</span>` : '';
    const when = [s.year && `c. ${s.year}`, s.place].filter(Boolean).join(' · ');
    return `<li><div class="ut-row"><span class="snp-node target">${esc(s.name)}</span>${who ? '<span class="hint">formed in</span>' + who : ''}${when ? `<span class="hint">${esc(when)}</span>` : ''}</div>${s.kids.length ? draw(s.kids) : ''}</li>`;
  }).join('')}</ul>`;
  return `<div class="tree utree">${draw(roots)}</div>
    ${roots.length > 1 ? '<p class="hint" style="margin-top:8px">SNPs not yet connected to an older SNP appear as separate trees until their parent SNP is added.</p>' : ''}`;
}
function lineageCard(sig, lin) {
  const men = menOf(lin), first = earliestOf(men), ts = testersOfLin(lin);
  const snps = [...new Set(ts.map(t => t.snp).filter(Boolean))];
  return `<div class="anc-card" data-go="lin" data-sig="${esc(sig)}" data-lin="${esc(lin)}">
    <h3>${esc(lin)}</h3>
    <div class="hint">${first ? `Earliest dated ancestor: ${esc(first.name)} (${esc(lifeOf(first))})${first.bplace ? ', b. ' + esc(first.bplace) : ''}` : ''}</div>
    <div class="hint" style="margin-top:8px">${plural(ts.length, 'tester')} · ${plural(men.length, 'documented man', 'documented men')}${snps.length ? ' · ' + snps.map(esc).join(', ') : ''}</div></div>`;
}

/* ---------- Migration map ----------
   Each place is placed using barrow-places.csv. A line is drawn when a son was born somewhere other than
   his father's birthplace, or a man died somewhere other than where he was born, dated by that birth or death.
   The slider and Play button step through the years, so the family's spread can be watched over time. */
const LINE_COLORS = ['#2f6b85', '#3f7a6a', '#b84a3e', '#6b4f9e', '#15303c', '#5b8fa8'];
let liveMaps = [];
function coordsOf(place) { return (D.places && D.places.get(String(place || '').trim().toLowerCase())) || null; }
function lineColor(lin) { const all = [...new Set(allMen().map(m => m.lineage).filter(Boolean))]; return LINE_COLORS[Math.max(0, all.indexOf(lin)) % LINE_COLORS.length]; }
function migrationData(men) {
  const ids = new Set(men.map(m => m.id)), moves = new Map(), places = new Map(), missing = new Set();
  const addMove = (from, to, year, lin, note) => {
    if (!from || !to || from === to) return;
    const k = `${lin}|${from}|${to}`, e = moves.get(k);
    if (!e || (year != null && (e.year == null || year < e.year))) moves.set(k, { from, to, year, lin, note });
  };
  const addPlace = (place, year, m) => {
    if (!place) return;
    if (!coordsOf(place)) { missing.add(place); return; }
    const e = places.get(place) || { place, first: null, men: new Set(), lins: new Set() };
    if (year != null && (e.first == null || year < e.first)) e.first = year;
    e.men.add(m.id); e.lins.add(m.lineage);
    places.set(place, e);
  };
  men.forEach(m => {
    const by = yearNum(m.birth), dy = yearNum(m.death), f = D.men.get(m.father);
    addPlace(m.bplace, by, m); addPlace(m.dplace, dy, m);
    if (f && ids.has(f.id)) addMove(f.bplace, m.bplace, by, m.lineage, `${m.name} born in ${m.bplace}, son of ${f.name} (born in ${f.bplace})`);
    addMove(m.bplace, m.dplace, dy, m.lineage, `${m.name} died in ${m.dplace}`);
  });
  /* SNPs that formed in one of these men, or in a man not in the data, shown where they formed. */
  const sigs = new Set(men.map(m => m.sig));
  const snps = D.snps.filter(s => s.place && coordsOf(s.place) && (ids.has(s.formedIn) || (!D.men.get(s.formedIn) && sigs.has(s.sig))));
  return { moves: [...moves.values()].filter(v => coordsOf(v.from) && coordsOf(v.to)), places: [...places.values()], snps, missing: [...missing] };
}
function mapCard(kind, key) {
  return `<div class="card"><h3>Migration map</h3>
    <p class="hint">Each dot is a place where men of this ${kind === 'sig' ? 'signature' : 'line'} were born or died; the bigger the dot, the more men. Each line is a move between generations. Drag the slider or press Play to watch the family spread over time.</p>
    <div data-map-kind="${kind}" data-map-key="${esc(key)}"></div></div>`;
}
function clearMaps() { liveMaps.forEach(x => { clearInterval(x.timer); x.map.remove(); }); liveMaps = []; }
function setupMaps() { document.querySelectorAll('[data-map-kind]').forEach(buildMap); }
function buildMap(box) {
  if (typeof L === 'undefined') { box.innerHTML = '<p class="muted">The map needs an internet connection to load.</p>'; return; }
  const key = box.dataset.mapKey, men = box.dataset.mapKind === 'sig' ? allMen().filter(m => m.sig === key) : menOf(key);
  const d = migrationData(men);
  if (!d.places.length) { box.innerHTML = '<p class="muted">No places with map positions yet. Add them to barrow-places.csv.</p>'; return; }
  const years = d.moves.map(v => v.year).concat(d.places.map(p => p.first), d.snps.map(s => yearNum(s.year))).filter(y => y != null);
  const lo = Math.min(...years), hi = Math.max(...years);
  const lins = [...new Set(men.map(m => m.lineage))];
  /* Places east of the mid-Atlantic are the Old World; the rest are America. Each can be zoomed to with a button. */
  const pts = d.places.map(p => coordsOf(p.place)), old = pts.filter(c => c[1] > -30), nw = pts.filter(c => c[1] <= -30), both = old.length && nw.length;
  box.innerHTML = `<div class="mig-map" style="height:440px;border-radius:8px;border:1px solid var(--line)"></div>
    <div style="display:flex;align-items:center;gap:12px;margin-top:10px">
      <button class="btn small" data-map-play>▶ Play</button>${both ? `<button class="btn small ghost" data-map-view="all">Whole journey</button><button class="btn small ghost" data-map-view="old">England</button><button class="btn small ghost" data-map-view="new">America</button>` : ''}
      <input type="range" min="${lo}" max="${hi}" value="${hi}" step="1" data-map-year style="flex:1">
      <b data-map-label style="font-family:var(--serif);font-size:20px;min-width:52px;text-align:right">${hi}</b></div>
    <div class="hint" data-map-note style="min-height:20px;margin-top:6px"></div>
    <div class="gdg-key">${lins.length > 1 ? lins.map(l => `<span><i style="background:${lineColor(l)}"></i>${esc(l)}</span>`).join('') : ''}${d.snps.length ? '<span><i style="background:var(--bronze)"></i>Where an SNP formed</span>' : ''}</div>
    ${d.missing.length ? `<p class="hint" style="margin-top:8px">Not yet on the map (add to barrow-places.csv): ${d.missing.map(esc).join('; ')}</p>` : ''}`;
  const map = L.map(box.querySelector('.mig-map'), { scrollWheelZoom: false, worldCopyJump: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 12, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
  const layer = L.layerGroup().addTo(map);
  const fit = list => map.fitBounds(L.latLngBounds(list), { padding: [30, 30], maxZoom: 8 });
  fit(pts);
  box.querySelectorAll('[data-map-view]').forEach(b => b.addEventListener('click', () => fit({ all: pts, old, new: nw }[b.dataset.mapView])));
  const slider = box.querySelector('[data-map-year]'), label = box.querySelector('[data-map-label]'), note = box.querySelector('[data-map-note]'), play = box.querySelector('[data-map-play]');
  const live = { map, timer: null };
  liveMaps.push(live);
  const draw = Y => {
    layer.clearLayers();
    label.textContent = Y;
    d.moves.filter(v => v.year == null || v.year <= Y).forEach(v =>
      L.polyline([coordsOf(v.from), coordsOf(v.to)], { color: lineColor(v.lin), weight: 3, opacity: .85 })
        .bindTooltip(`${v.year != null ? v.year + ' · ' : ''}${esc(v.note)}`).addTo(layer));
    d.places.filter(p => p.first == null || p.first <= Y).forEach(p =>
      L.circleMarker(coordsOf(p.place), { radius: 5 + Math.min(p.men.size, 8), color: '#15303c', weight: 1.5, fillColor: lineColor([...p.lins][0]), fillOpacity: .9 })
        .bindTooltip(`<b>${esc(p.place)}</b><br>First record ${p.first == null ? '—' : p.first} · ${plural(p.men.size, 'man', 'men')}`).addTo(layer));
    d.snps.filter(s => yearNum(s.year) == null || yearNum(s.year) <= Y).forEach(s =>
      L.marker(coordsOf(s.place), { icon: L.divIcon({ className: '', html: `<span class="snp-node target" style="white-space:nowrap;font-size:11px;padding:1px 6px">${esc(s.name)}</span>`, iconAnchor: [-8, 10] }) })
        .bindTooltip(`${esc(s.name)} formed c. ${esc(s.year)} in ${esc(s.place)}`).addTo(layer));
    const recent = d.moves.filter(v => v.year != null && v.year <= Y).sort((a, b) => b.year - a.year)[0];
    note.textContent = recent ? `Latest move by ${Y}: ${recent.year} · ${recent.note}` : '';
  };
  slider.addEventListener('input', () => { clearInterval(live.timer); live.timer = null; play.textContent = '▶ Play'; draw(Number(slider.value)); });
  play.addEventListener('click', () => {
    if (live.timer) { clearInterval(live.timer); live.timer = null; play.textContent = '▶ Play'; return; }
    let Y = Number(slider.value) >= hi ? lo : Number(slider.value);
    const step = Math.max(1, Math.round((hi - lo) / 90));
    play.textContent = '❚❚ Pause';
    live.timer = setInterval(() => {
      Y = Math.min(hi, Y + step); slider.value = Y; draw(Y);
      if (Y >= hi) { clearInterval(live.timer); live.timer = null; play.textContent = '▶ Play'; }
    }, 110);
  });
  draw(hi);
}

/* ---------- Search ---------- */
/* Every word typed must appear somewhere in the man's name, dates, places or SNPs, in any order. */
function wordsOf(q) { return String(q || '').toLowerCase().split(/[\s,]+/).filter(Boolean); }
function hasAll(parts, words) { const t = parts.filter(Boolean).join(' ').toLowerCase(); return words.every(w => t.includes(w)); }
function searchAll(q) {
  const words = wordsOf(q);
  const men = allMen().filter(m => hasAll([m.name, m.birth, m.death, m.bplace, m.dplace, ...m.snps.map(s => s.name)], words))
    .sort((x, y) => (yearNum(x.birth) || 9999) - (yearNum(y.birth) || 9999));
  const snps = D.snps.filter(s => hasAll([s.name, s.year, s.place], words));
  const lins = [...new Set(allMen().map(m => m.lineage).filter(Boolean))].filter(l => hasAll([l], words));
  return { men, snps, lins };
}
function renderSearch(q) {
  const r = searchAll(q), total = r.men.length + r.snps.length + r.lins.length;
  const row = (attrs, cells) => `<tr ${attrs} style="cursor:pointer">${cells.map(c => `<td>${c}</td>`).join('')}</tr>`;
  const go = m => `data-go="lin" data-sig="${esc(m.sig)}" data-lin="${esc(m.lineage)}" data-hl="${esc(m.id)}"`;
  const men = r.men.length ? `<div class="card"><h3>Men (${r.men.length})</h3>
    <p class="hint">Click a man to open his lineage with him highlighted.</p>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Dates</th><th>Born</th><th>Died</th><th>Lineage</th></tr></thead><tbody>
    ${r.men.map(m => row(go(m), [`<b>${esc(m.name)}</b>`, esc(lifeOf(m)) || '—', esc(m.bplace) || '—', esc(m.dplace) || '—', `${esc(m.lineage)}<br><span class="muted">${esc(m.sig)}</span>`])).join('')}
    </tbody></table></div></div>` : '';
  const snps = r.snps.length ? `<div class="card"><h3>SNPs (${r.snps.length})</h3>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>SNP</th><th>Formed in</th><th>Formed</th><th>Place</th></tr></thead><tbody>
    ${r.snps.map(s => { const m = D.men.get(s.formedIn); return row(m ? go(m) : `data-go="sig" data-sig="${esc(s.sig)}"`, [`<span class="snp-node target">${esc(s.name)}</span>`, m ? esc(m.name) : '—', s.year ? 'c. ' + esc(s.year) : '—', esc(s.place) || '—']); }).join('')}
    </tbody></table></div></div>` : '';
  const lins = r.lins.length ? `<div class="card"><h3>Lineages (${r.lins.length})</h3>
    <div class="anc-cards">${r.lins.map(l => lineageCard(menOf(l)[0].sig, l)).join('')}</div></div>` : '';
  return `<h1>Search</h1>
  <p class="muted">${total ? `${plural(total, 'result')} for “${esc(q)}”` : `Nothing found for “${esc(q)}”.`}</p>
  ${total ? men + snps + lins : '<div class="card"><p class="hint" style="margin:0">Try fewer words, or part of a word: a surname spelling such as “Bennet”, a county such as “Surry”, a state, a year such as “1739”, or an SNP such as “Y91124”. Living generations and testers are not searchable.</p></div>'}`;
}

/* ---------- Find my Barrow line ----------
   The member enters his or her Barrow line, earliest known Barrow man first. Each man is compared with the
   documented men: the given name must agree, and at least one more detail (birth year, death year or place)
   must support it. Nothing entered here is saved or sent anywhere. */
let mine = [{ name: '', birth: '', death: '', place: '' }];
/* How the member is connected: 'son' = a Barrow man (or entering for one), 'woman' = a woman whose father's line is Barrow,
   'daughter' = the line passes through a Barrow daughter. Women do not carry Y-DNA, so a male Barrow relative has to test. */
let mineMode = 'son', mineDaughter = '';
function pill(c, text) { return `<span class="pill ${c}">${esc(text)}</span>`; }
const STATE_ABBR = { va: 'virginia', nc: 'north carolina', sc: 'south carolina', ga: 'georgia', la: 'louisiana', tn: 'tennessee', ky: 'kentucky', al: 'alabama', ms: 'mississippi', tx: 'texas', md: 'maryland', pa: 'pennsylvania', ny: 'new york', fl: 'florida', ar: 'arkansas', mo: 'missouri', wv: 'west virginia', nj: 'new jersey', ct: 'connecticut', ma: 'massachusetts', il: 'illinois', ca: 'california' };
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function firstName(n) { return String(n || '').toLowerCase().replace(/[^a-z\s]/g, ' ').trim().split(/\s+/)[0] || ''; }
/* Given names agree when they are the same, one is the start of the other (Benj / Benjamin), or one letter differs (Bennet / Bennett). */
function nameClose(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a))) return true;
  return Math.min(a.length, b.length) >= 4 && lev(a, b) <= 1;
}
function placeText(p) { return ' ' + String(p || '').toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').replace(/\b([a-z]{2})\b/g, (w, s) => STATE_ABBR[s] || w) + ' '; }
/* 2 = same county or parish, 1 = same state or country, 0 = no agreement. */
function placeHit(userPlace, m) {
  const u = placeText(userPlace);
  if (!u.trim()) return 0;
  let best = 0;
  [m.bplace, m.dplace].filter(Boolean).forEach(pl => {
    const parts = pl.split(',').map(s => s.trim().toLowerCase());
    const region = regionOf(pl).toLowerCase().split(',')[0];
    const county = parts.length > 1 ? parts[0].replace(/ (county|parish)$/, '') : '';
    if (county && u.includes(' ' + county + ' ')) best = Math.max(best, 2);
    else if (region && u.includes(' ' + region + ' ')) best = Math.max(best, 1);
  });
  return best;
}
function realMen() { return allMen().filter(m => !/^father of/i.test(m.name)); }
function matchPerson(p, m) {
  if (!nameClose(firstName(p.name), firstName(m.name))) return null;
  let score = 3, why = ['name'], conflict = false;
  [[p.birth, m.birth, 'birth year', 4], [p.death, m.death, 'death year', 3]].forEach(([a, b, label, pts]) => {
    const x = yearNum(a), y = yearNum(b);
    if (x == null || y == null) return;
    const d = Math.abs(x - y);
    if (d <= 2) { score += pts; why.push(label); }
    else if (d <= 10) { score += 1; why.push(`${label} within 10 years`); }
    else if (d > 15) conflict = true;
  });
  const ph = placeHit(p.place, m);
  if (ph === 2) { score += 3; why.push('county'); } else if (ph === 1) { score += 1; why.push('state or country'); }
  /* A name alone is not enough, and dates far apart rule the man out. */
  if (conflict || score <= 3) return null;
  return { m, score, why };
}
function ancestorsOf(m) { const out = []; let x = m; while (x) { out.push(x); x = D.men.get(x.father); } return out; }
/* The SNPs a man carries: those formed in him or in any of his forefathers, oldest first. */
function snpsCarried(m) { return ancestorsOf(m).reverse().flatMap(x => x.snps.map(s => s.name)); }
function findLine() {
  const rows = mine.map((p, i) => ({ p, i })).filter(r => r.p.name.trim());
  const cands = rows.map(r => ({ r, list: realMen().map(m => matchPerson(r.p, m)).filter(Boolean) }));
  /* A father and son who both match, in the same order as the member's line, support each other. */
  for (let k = 0; k + 1 < cands.length; k++) cands[k + 1].list.forEach(son => {
    const dad = cands[k].list.find(c => c.m.id === son.m.father);
    if (dad) { son.score += 3; dad.score += 3; son.why.push('his father also matches'); }
  });
  const byLin = new Map();
  cands.forEach(c => c.list.forEach(x => {
    const e = byLin.get(x.m.lineage) || { lin: x.m.lineage, sig: x.m.sig, hits: [] };
    const prev = e.hits.find(h => h.r === c.r);
    if (!prev) e.hits.push({ r: c.r, x }); else if (x.score > prev.x.score) prev.x = x;
    byLin.set(x.m.lineage, e);
  }));
  const found = [...byLin.values()].map(e => ({ ...e, best: Math.max(...e.hits.map(h => h.x.score)) })).sort((a, b) => b.best - a.best);
  return { rows, found };
}
function findCard(e, rows) {
  const strong = e.best >= 7;
  const hits = e.hits.slice().sort((a, b) => a.r.i - b.r.i);
  const join = hits[hits.length - 1].x.m;
  const after = rows.filter(r => r.i > hits[hits.length - 1].r.i);
  const under = testersUnder(join);
  const tested = ancestorsOf(join).find(x => testersUnder(x).length);
  const carried = snpsCarried(join);
  const snpList = list => [...new Set(list.map(t => t.snp))].map(esc).join(', ');
  const nearest = tested ? (tested === join ? ` Other descendants of ${esc(join.name)} have tested` : ` The nearest tested branch is under ${esc(tested.name)}`) + ` (${plural(testersUnder(tested).length, 'tester')}, ${snpList(testersUnder(tested))}).` : '';
  const branch = after.length
    ? `Your line continues below ${esc(join.name)} through ${esc(after[0].p.name)}, who is not among the documented men, so your own branch has not tested yet.${nearest}`
    : under.length ? `<b>${mineMode === 'daughter' ? 'His male line has tested' : 'Your branch has tested'}:</b> ${plural(under.length, 'tester')} ${under.length === 1 ? 'descends' : 'descend'} from ${esc(join.name)} (${snpList(under)}).`
    : `No tester descends from ${esc(join.name)} yet.${nearest}`;
  return `<div class="card">
    <div class="card-head"><h3>${esc(e.lin)} <span class="muted" style="font-weight:normal">· ${esc(e.sig)}</span></h3>${pill(strong ? 'green' : 'amber', strong ? 'Strong match' : 'Possible match')}</div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Your ancestor</th><th>Documented man</th><th>Agrees on</th></tr></thead><tbody>
      ${hits.map(h => `<tr><td>${esc(h.r.p.name)}${h.r.p.birth || h.r.p.death ? ` <span class="muted">(${esc([h.r.p.birth, h.r.p.death].filter(Boolean).join('–'))})</span>` : ''}</td><td><b>${esc(h.x.m.name)}</b> <span class="muted">${esc(lifeOf(h.x.m))}</span>${h.x.m.bplace ? `<br><span class="muted">b. ${esc(h.x.m.bplace)}</span>` : ''}</td><td>${esc(h.x.why.join(', '))}</td></tr>`).join('')}
    </tbody></table></div>
    ${carried.length ? `<p style="margin:12px 0 6px">${mineMode === 'son' ? 'If your line is his, your Barrow men carry' : mineMode === 'woman' ? 'If your line is his, your father and his Barrow forefathers carry' : 'If your line is his, your Barrow forefathers carried'} <b>${carried.map(esc).join(' › ')}</b>.</p>` : ''}
    ${mineMode === 'daughter' ? `<p class="hint" style="margin:6px 0">Your line leaves the Barrow men at ${esc(rows[rows.length - 1].p.name)}${mineDaughter ? ` through his daughter ${esc(mineDaughter)}` : ' through a daughter'}. Y-DNA does not pass through a daughter, so neither she nor her descendants carry this Barrow Y-DNA, but the Barrow men above her did.</p>` : ''}
    <p class="hint" style="margin:6px 0">${branch}</p>
    <p class="hint" style="margin:6px 0">This is a match on the records, not on DNA. Only a Y-DNA test of a Barrow man from your line can confirm it.</p>
    <div class="tbl-actions"><button class="btn small" data-go="lin" data-sig="${esc(e.sig)}" data-lin="${esc(e.lin)}" data-hl="${esc(join.id)}">Open this lineage</button></div>
  </div>`;
}
/* No name agrees: lineages whose men lived in the same county within 50 years of the member's earliest ancestor. */
function samePlaceTime(rows) {
  const r = rows.find(x => x.p.place.trim()) || null;
  if (!r) return [];
  const y = yearNum(r.p.birth) || yearNum(r.p.death);
  const out = new Map();
  realMen().forEach(m => {
    if (placeHit(r.p.place, m) < 2) return;
    const my = yearNum(m.birth) || yearNum(m.death);
    if (y != null && my != null && Math.abs(y - my) > 50) return;
    if (!out.has(m.lineage)) out.set(m.lineage, m);
  });
  return [...out.values()];
}
function findResults() {
  const { rows, found } = findLine();
  if (!rows.length) return '<p class="hint">Enter at least your earliest known Barrow ancestor to see where your line fits.</p>';
  const earliest = rows[0].p.name;
  const last = rows[rows.length - 1].p.name;
  const who = mineMode === 'woman'
    ? `Women do not carry Y-DNA, so a male Barrow relative has to test for you: your father, a brother, your father's brother, or a male Barrow cousin who descends from ${esc(earliest)} through sons only.`
    : mineMode === 'daughter'
    ? `Y-DNA does not pass through a daughter, so the test has to be taken by a living Barrow man who descends from ${esc(last)} through sons only, such as a male-line descendant of one of ${mineDaughter ? esc(mineDaughter) + '’s' : 'her'} brothers. An autosomal test (AncestryDNA, 23andMe, MyHeritage or Family Finder) can support your own link to her when she is within about five or six generations of you.`
    : `Y-DNA passes from father to son, so the test has to be taken by a living Barrow man who descends from ${esc(earliest)} through sons only.`;
  const testCard = `<div class="card"><h3>Confirming your line with Y-DNA</h3>
    <p class="hint" style="margin:0">${who} A Big Y-700 test places him exactly on the Barrow SNP tree; a Y-37 or larger test shows which Barrow lineage he matches.</p></div>`;
  if (found.length) return found.map(e => findCard(e, rows)).join('') + (found[0].best >= 7 && mineMode === 'son' ? '' : testCard);
  const near = samePlaceTime(rows);
  if (near.length) return `<div class="card"><div class="card-head"><h3>No documented man matches your ancestors</h3>${pill('amber', 'Same place and time')}</div>
    <p class="hint">But these lineages had men in the same county within about 50 years of your earliest ancestor, so your line may connect to one of them:</p>
    <ul>${near.map(m => `<li><a href="#" data-go="lin" data-sig="${esc(m.sig)}" data-lin="${esc(m.lineage)}" data-hl="${esc(m.id)}">${esc(m.lineage)}</a> · ${esc(m.name)} (${esc(lifeOf(m))}), ${esc(m.bplace || m.dplace)}</li>`).join('')}</ul>
    <p class="hint" style="margin:0">Living in the same place points to where to look in the records. It is not evidence of descent on its own.</p></div>${testCard}`;
  return `<div class="card"><div class="card-head"><h3>Your line has not matched a tested Barrow lineage yet</h3>${pill('', 'Not matched')}</div>
    <p class="hint" style="margin:0">None of your ancestors match a documented man by name and dates, and none lived in the same county at the same time. That does not mean your line is unrelated, only that it is not represented yet. Check the spellings and dates you entered, and try adding the places your ancestors lived.</p></div>${testCard}`;
}
function renderFind() {
  const inp = (i, f, ph, w) => `<td${w ? ` style="width:${w}px"` : ''}><input data-mine="${i}" data-f="${f}" value="${esc(mine[i][f])}" placeholder="${esc(ph)}"${f === 'birth' || f === 'death' ? ' inputmode="numeric"' : ''}></td>`;
  return `<h1>Find my Barrow line</h1>
  <p class="muted">Enter your Barrow line to see which documented lineage it fits, which Y-DNA signature it belongs to, and whether your branch has tested.</p>
  <div class="card"><h3>How are you connected to the Barrows?</h3>
    <div class="grid2"><div class="field"><label>My connection</label><select id="mine-mode">${[
      ['son', 'I am a Barrow man, or I am entering a Barrow man’s line'],
      ['woman', 'I am a Barrow woman: my father’s line is Barrow'],
      ['daughter', 'My line passes through a Barrow daughter']
    ].map(o => `<option value="${o[0]}"${mineMode === o[0] ? ' selected' : ''}>${o[1]}</option>`).join('')}</select></div>
    ${mineMode === 'daughter' ? `<div class="field"><label>The Barrow daughter you descend from (optional)</label><input id="mine-daughter" value="${esc(mineDaughter)}" placeholder="e.g. Martha Barrow"></div>` : ''}</div>
  </div>
  <div class="card"><h3>Your Barrow line</h3>
    <p class="hint">${mineMode === 'woman'
      ? 'Start with your earliest known Barrow man, then his son, and so on down to your father.'
      : mineMode === 'daughter'
      ? 'Start with your earliest known Barrow man, then his son, and so on down to the last Barrow man in your line: the father of the daughter you descend from.'
      : 'Start with your earliest known Barrow man, then his son, and so on toward you.'} Use the father-to-son line only. Estimates are fine for years. Nothing you enter is saved or sent anywhere.</p>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>Name</th><th>Born</th><th>Died</th><th>Where he lived</th><th></th></tr></thead><tbody>
      ${mine.map((r, i) => `<tr><td class="calc">${i + 1}${i === 0 ? ' <span class="muted">(earliest)</span>' : ''}</td>${inp(i, 'name', i === 0 ? 'e.g. Josiah Barrow' : 'e.g. his son Elias Barrow')}${inp(i, 'birth', 'e.g. 1745', 90)}${inp(i, 'death', 'e.g. 1810', 90)}${inp(i, 'place', 'e.g. Bertie County, NC')}<td>${mine.length > 1 ? `<button class="row-btn" data-act="mine-del" data-i="${i}" title="Remove">✕</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="tbl-actions"><button class="btn small" data-act="mine-add">+ Add the next generation</button>${mine.some(r => r.name || r.birth || r.death || r.place) ? '<button class="btn small ghost" data-act="mine-clear">Clear</button>' : ''}</div>
  </div>
  <div id="find-out">${findResults()}</div>`;
}

/* ---------- Pages ---------- */
function renderHome() {
  const cards = D.sigs.map(sig => {
    const men = allMen().filter(m => m.sig === sig), first = earliestOf(men);
    return `<div class="anc-card" data-go="sig" data-sig="${esc(sig)}">
      <h3>${esc(sig)}</h3>
      <div class="hint">${plural(lineagesOf(sig).length, 'lineage')} · ${plural(testersOfSig(sig).length, 'tester')}</div>
      ${first ? `<div class="hint" style="margin-top:8px">Earliest dated ancestor: ${esc(first.name)} (${esc(lifeOf(first))})${first.bplace ? ', b. ' + esc(first.bplace) : ''}</div>` : ''}</div>`;
  }).join('');
  return `<div class="hero">
    <h1>Barrow Y-DNA Lineages</h1>
    <p>The Barrows are not one family. Y-DNA testing shows that the surname is carried by separate paternal families, each with its own Y-DNA signature. Choose a signature to see its lineages, where its men lived and how the family spread.</p>
    <button class="btn" data-go="find" style="background:var(--bronze)">Find my Barrow line</button>
  </div>
  <h2>Y-DNA signatures</h2>
  <div class="anc-cards">${cards}</div>
  ${D.sigs.length < 2 ? '<p class="hint" style="margin-top:12px">The second signature will appear here once its data is added.</p>' : ''}`;
}
function renderSig(sig) {
  const lins = lineagesOf(sig);
  return `<h1>${esc(sig)}</h1>
  <p class="muted">${plural(lins.length, 'lineage')} · ${plural(testersOfSig(sig).length, 'tester')}</p>
  <div class="card"><h3>Lineages</h3>
    <p class="hint">Each lineage is a documented line descending from a known ancestor. Click one to see its men, its SNPs and its testers.</p>
    <div class="anc-cards">${lins.map(l => lineageCard(sig, l)).join('')}</div></div>
  <div class="card"><h3>SNP tree</h3>
    <p class="hint">Each SNP formed in one man and is carried by all his male-line descendants. Oldest SNP at the top. Click a man to open his lineage.</p>
    ${snpTree(sig)}</div>
  ${mapCard('sig', sig)}
  <div class="card"><h3>Regional presence</h3>
    <p class="hint">Where the documented men of this signature were born and died, in order of the first record in each region. Read from top to bottom, it traces how the family spread.</p>
    ${presenceTable(allMen().filter(m => m.sig === sig))}</div>`;
}
function renderLin(sig, lin) {
  const ts = testersOfLin(lin);
  return `<h1>${esc(lin)}</h1>
  <p class="muted">${esc(sig)} · ${plural(ts.length, 'tester')}</p>
  <div class="card"><h3>The documented line</h3>
    <p class="hint">Father to son, oldest man at the top. A bronze SNP beside a man means that SNP formed in him, so every male-line descendant of his carries it. Testers are shown under their great-grandfather by their terminal SNP; living generations and testers' names are not shown.</p>
    ${lineTree(lin)}</div>
  ${mapCard('lin', lin)}
  <div class="card"><h3>Regional presence</h3>
    <p class="hint">Where the men of this line were born and died, in order of the first record in each region.</p>
    ${presenceTable(menOf(lin))}</div>`;
}
function renderNav() {
  const on = (page, sig, lin) => view.page === page && view.sig === (sig || '') && view.lin === (lin || '') ? ' active' : '';
  return `<a data-go="home" class="${on('home')}">Home</a>
    <a data-go="find" class="${on('find')}">Find my Barrow line</a>
    ${D.sigs.map(sig => `<div class="side-head" style="margin-top:14px"><span>${esc(sig)}</span></div>
      <a data-go="sig" data-sig="${esc(sig)}" class="${on('sig', sig)}">Overview</a>
      ${lineagesOf(sig).map(l => `<a data-go="lin" data-sig="${esc(sig)}" data-lin="${esc(l)}" class="${on('lin', sig, l)}">${esc(l)}</a>`).join('')}`).join('')}`;
}
function render() {
  clearMaps();
  const main = document.getElementById('main'), crumb = document.getElementById('crumb');
  if (view.page === 'lin') {
    crumb.innerHTML = `<a data-go="home">Home</a> › <a data-go="sig" data-sig="${esc(view.sig)}">${esc(view.sig)}</a> › ${esc(view.lin)}`;
    main.innerHTML = renderLin(view.sig, view.lin);
  } else if (view.page === 'sig') {
    crumb.innerHTML = `<a data-go="home">Home</a> › ${esc(view.sig)}`;
    main.innerHTML = renderSig(view.sig);
  } else if (view.page === 'find') {
    crumb.textContent = 'Find my Barrow line';
    main.innerHTML = renderFind();
  } else if (view.page === 'search') {
    crumb.textContent = 'Search';
    main.innerHTML = renderSearch(view.q);
  } else {
    crumb.textContent = 'Home';
    main.innerHTML = renderHome();
  }
  document.getElementById('nav').innerHTML = renderNav();
  setupMaps();
}

/* ---------- Events ---------- */
document.addEventListener('click', e => {
  const app = document.querySelector('.app');
  const act = e.target.closest('[data-act]');
  if (act) {
    if (act.dataset.act === 'open-menu') app.classList.add('menu-open');
    if (act.dataset.act === 'close-menu') app.classList.remove('menu-open');
    if (act.dataset.act === 'mine-add') { mine.push({ name: '', birth: '', death: '', place: '' }); render(); }
    if (act.dataset.act === 'mine-del') { mine.splice(Number(act.dataset.i), 1); render(); }
    if (act.dataset.act === 'mine-clear') { mine = [{ name: '', birth: '', death: '', place: '' }]; render(); }
    return;
  }
  const go = e.target.closest('[data-go]');
  if (!go || !D) return;
  view = { page: go.dataset.go, sig: go.dataset.sig || '', lin: go.dataset.lin || '', hl: go.dataset.hl || '' };
  app.classList.remove('menu-open');
  render();
  /* A man chosen from the search results is scrolled into view; any other page opens at the top. */
  const man = view.hl && document.querySelector(`[data-man="${CSS.escape(view.hl)}"]`);
  if (man) man.scrollIntoView({ block: 'center' }); else window.scrollTo(0, 0);
});
/* Search runs as you type; clearing the box returns to Home. */
document.addEventListener('input', e => {
  if (e.target.id !== 'q' || !D) return;
  const q = e.target.value.trim();
  view = q ? { page: 'search', sig: '', lin: '', q } : { page: 'home', sig: '', lin: '' };
  render();
});

/* Find my Barrow line: the results update as the member types, without redrawing the boxes being typed in. */
document.addEventListener('input', e => {
  const d = e.target.dataset;
  if (!D) return;
  if (e.target.id === 'mine-mode') { mineMode = e.target.value; render(); return; }
  if (e.target.id === 'mine-daughter') { mineDaughter = e.target.value; const o = document.getElementById('find-out'); if (o) o.innerHTML = findResults(); return; }
  if (d.mine == null) return;
  mine[Number(d.mine)][d.f] = e.target.value;
  const out = document.getElementById('find-out');
  if (out) out.innerHTML = findResults();
});

/* ---------- Start ---------- */
loadData().then(d => { D = d; render(); }).catch(() => {
  document.getElementById('main').innerHTML = `<div class="card"><h3>The Barrow data could not be loaded</h3>
    <p class="hint">Check that barrow-ancestors.csv, barrow-testers.csv and barrow-snps.csv are in the same folder as index.html. If you opened index.html by double-clicking it, open it with Live Server in Visual Studio Code instead: browsers only let a page read the CSV files when it is served that way, or from the website.</p></div>`;
});