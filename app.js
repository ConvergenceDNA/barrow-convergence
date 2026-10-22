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
  /* Branches of the same SNP are listed oldest first, so a later branch never looks as if it came before an earlier one. */
  snps.forEach(s => s.kids.sort((a, b) => (yearNum(a.year) || 9999) - (yearNum(b.year) || 9999)));
  const testers = T.map(t => ({ kit: t['Kit'], sig: t['Signature'], lineage: t['Lineage'], snp: t['Terminal SNP'], gg: t['Great-grandfather ID'] }));
  testers.forEach(t => { const m = men.get(t.gg); if (m) m.testers.push(t); });
  const sigs = [...new Set(A.map(a => a['Signature']).concat(S.map(s => s['Signature'])).filter(Boolean))];
  /* A lineage is confirmed by Y-DNA when at least one of its descendants has tested. Only confirmed lineages are shown. */
  const confirmed = new Set(testers.map(t => t.lineage));
  return { men, snps, testers, sigs, confirmed };
}

/* ---------- Questions about the data ---------- */
function allMen() { return [...D.men.values()].filter(m => D.confirmed.has(m.lineage)); }
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
    return `<li><div class="ut-row" data-man="${esc(m.id)}"><span class="anc-node"${hl}>${esc(m.name)}</span>${lifeOf(m) ? `<span class="hint">${esc(lifeOf(m))}</span>` : ''}${m.snps.map(s => `${snpTag(s)}<span class="hint">carried by ${plural(testersUnder(m).length, 'tester')}</span>`).join('')}${testerTags(m.testers)}${shared}</div>
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
  const men = menOf(lin), ts = testersOfLin(lin);
  const regions = presence(men).map(r => esc(r.region));
  return `<div class="anc-card" data-go="lin" data-sig="${esc(sig)}" data-lin="${esc(lin)}">
    <h3>${esc(lin)}</h3>
    <div class="hint">${plural(ts.length, 'tester')} · ${plural(men.length, 'documented man', 'documented men')}</div>
    </div>`;
}

/* ---------- Migration map ----------
   Each place is placed using barrow-places.csv. A line is drawn when a son was born somewhere other than
   his father's birthplace, or a man died somewhere other than where he was born, dated by that birth or death.
   The slider and Play button step through the years, so the family's spread can be watched over time. */
const LINE_COLORS = ['#2f6b85', '#3f7a6a', '#b84a3e', '#6b4f9e', '#15303c', '#5b8fa8'];
let liveMaps = [];
/* ---------- How each SNP spread ----------
   For every SNP, its carriers are the man it began in and all his male-line descendants. Where they were born and
   died shows where the SNP lived: the table lists those regions in order, and the map draws them as circles. */
const SNP_COLORS = ['#a8762f', '#2f6b85', '#3f7a6a', '#b84a3e', '#6b4f9e', '#c98a1e', '#5b8fa8'];
/* An SNP's label on the map shows the SNPs above it, so a branch SNP reads as sitting under its parent:
   R-Y86591
     ↳ R-FT249996 */
function snpChain(s) { const out = []; let x = s; while (x) { out.unshift(x); x = D.snps.find(y => y.name === x.parent && y.sig === x.sig); } return out; }
function snpLabel(s) {
  const chain = snpChain(s);
  return `<div style="display:inline-block;background:#fff;border:1px solid #ddc6a1;border-radius:6px;padding:3px 7px;font-size:11px;line-height:1.4;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.25)">${chain.map((x, i) =>
    `<div style="padding-left:${i * 12}px;${x === s ? `font-weight:700;color:${snpColor(x)}` : 'color:#6b7378'}">${i ? '↳ ' : ''}${esc(x.name)}</div>`).join('')}</div>`;
}
function snpColor(s) { return SNP_COLORS[Math.max(0, D.snps.filter(x => x.sig === s.sig).indexOf(s)) % SNP_COLORS.length]; }
function snpSpread(men) {
  const ids = new Set(men.map(m => m.id)), sigs = new Set(men.map(m => m.sig));
  const list = D.snps.filter(s => sigs.has(s.sig)), order = [];
  const walk = (nodes, depth) => nodes.forEach(s => { order.push({ s, depth }); walk(s.kids, depth + 1); });
  walk(list.filter(s => !list.some(x => x.name === s.parent)), 0);
  return order.map(({ s, depth }) => {
    const man = D.men.get(s.formedIn);
    if (!man) return null;
    const carriers = descendantsOf(man).filter(m => ids.has(m.id));
    if (!carriers.length) return null;
    /* The man an SNP began in was its first carrier, but if he was born in the Old World and died in America, none of
       his descendants carried it in the Old World, so his birthplace there is not counted for this SNP. */
    const oldWorld = p => OLD_WORLD.includes(String(p || '').split(',').pop().trim());
    const emigrated = oldWorld(man.bplace) && man.dplace && !oldWorld(man.dplace);
    const events = carriers.flatMap(m => m === man && emigrated ? [[m.dplace, yearNum(m.death), m]] : [[m.bplace, yearNum(m.birth), m], [m.dplace, yearNum(m.death), m]]).filter(e => e[0]).map(([place, year, m]) => ({ place, year, m }));
    const R = new Map();
    events.forEach(e => {
      const r = regionOf(e.place), x = R.get(r) || { region: r, first: null, last: null, men: new Set() };
      if (e.year != null) { x.first = x.first == null ? e.year : Math.min(x.first, e.year); x.last = x.last == null ? e.year : Math.max(x.last, e.year); }
      x.men.add(e.m.id); R.set(r, x);
    });
    const regions = [...R.values()].sort((a, b) => (a.first == null ? 9999 : a.first) - (b.first == null ? 9999 : b.first));
    return { s, depth, man, carriers, events, regions };
  }).filter(Boolean);
}
function spreadTable(men) {
  const rows = snpSpread(men);
  if (!rows.length) return '<p class="muted">No SNPs with a known man recorded yet.</p>';
  const yrs = r => r.first == null ? '' : r.first === r.last ? ` ${r.first}` : ` ${r.first}–${r.last}`;
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>SNP</th><th>Where it began</th><th>Where its carriers lived, in order</th><th>Documented men</th></tr></thead><tbody>
    ${rows.map(r => `<tr>
      <td style="padding-left:${8 + r.depth * 18}px">${r.depth ? '<span class="muted">↳ </span>' : ''}<i style="display:inline-block;width:11px;height:11px;border-radius:50%;background:${snpColor(r.s)};margin-right:6px;vertical-align:-1px"></i><b>${esc(r.s.name)}</b></td>
      <td style="white-space:normal;min-width:200px">${esc(nameIn(r.man).charAt(0).toUpperCase() + nameIn(r.man).slice(1))}<br><span class="muted">${esc([r.s.year && 'c. ' + r.s.year, r.s.place || r.man.bplace].filter(Boolean).join(' · ') || 'place unknown')}</span></td>
      <td style="white-space:normal">${r.regions.map(x => `<span class="tester-tag" style="margin:2px 0;display:inline-block">${esc(x.region)}${yrs(x)}</span>`).join(' <span class="muted">→</span> ')}</td>
      <td class="calc">${r.carriers.length}</td></tr>`).join('')}
  </tbody></table></div>`;
}
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
    ${helpBox('How to read the map', [
      'Choose an SNP under the map to see where it spread. Each circle covers one region where men who carry that SNP were born or died. Start with the oldest SNP, then click the newer ones under it: each newer SNP covers fewer regions, because only the branch it began in carries it.',
      `Each dark dot is a place where men of this ${kind === 'sig' ? 'signature' : 'line'} were born or died, and each grey line is a move between generations.`,
      'Press Play to watch it happen: the chosen SNP’s circle appears where it began, grows as its carriers fill the region, and new circles appear in each region they move on to. England and America zoom to each side of the ocean.'
    ])}
    <div data-map-kind="${kind}" data-map-key="${esc(key)}"></div></div>`;
}
function clearMaps() { liveMaps.forEach(x => { clearInterval(x.timer); x.map.remove(); }); liveMaps = []; }
function setupMaps() { document.querySelectorAll('[data-map-kind]').forEach(buildMap); }
function buildMap(box) {
  if (typeof L === 'undefined') { box.innerHTML = '<p class="muted">The map needs an internet connection to load.</p>'; return; }
  const key = box.dataset.mapKey, men = box.dataset.mapKind === 'sig' ? allMen().filter(m => m.sig === key) : menOf(key);
  const d = migrationData(men), spread = snpSpread(men);
  if (!d.places.length) { box.innerHTML = '<p class="muted">No places with map positions yet. Add them to barrow-places.csv.</p>'; return; }
  const years = d.moves.map(v => v.year).concat(d.places.map(p => p.first), d.snps.map(s => yearNum(s.year))).filter(y => y != null);
  const lo = Math.min(...years), hi = Math.max(...years);
  /* Places east of the mid-Atlantic are the Old World; the rest are America. Each can be zoomed to with a button. */
  const pts = d.places.map(p => coordsOf(p.place)), old = pts.filter(c => c[1] > -30), nw = pts.filter(c => c[1] <= -30), both = old.length && nw.length;
  box.innerHTML = `<div class="mig-map" style="height:460px;border-radius:8px;border:1px solid var(--line)"></div>
    <div style="display:flex;align-items:center;gap:12px;margin-top:10px;flex-wrap:wrap">
      <button class="btn small" data-map-play>▶ Play</button>${both ? `<button class="btn small ghost" data-map-view="all">Whole journey</button><button class="btn small ghost" data-map-view="old">England</button><button class="btn small ghost" data-map-view="new">America</button>` : ''}
      <input type="range" min="${lo}" max="${hi}" value="${hi}" step="1" data-map-year style="flex:1;min-width:160px">
      <b data-map-label style="font-family:var(--serif);font-size:20px;min-width:52px;text-align:right">${hi}</b></div>
    <div class="hint" data-map-note style="min-height:20px;margin-top:6px"></div>
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:10px"><span class="hint">Show the circles of:</span>${spread.map(r => `<button class="btn small ghost" data-map-snp="${esc(r.s.name)}" style="color:var(--ink);border-color:var(--line)">${r.depth ? '<span class="muted">↳ </span>' : ''}<i style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${snpColor(r.s)};margin-right:5px"></i>${esc(r.s.name)}</button>`).join('')}<button class="btn small ghost" data-map-snp="none" style="color:var(--ink);border-color:var(--line)">None</button></div>
    <div class="gdg-key"><span><i style="background:#15303c;border-radius:50%"></i>Documented men</span></div>
    ${d.missing.length ? `<p class="hint" style="margin-top:8px">Not yet on the map (add to barrow-places.csv): ${d.missing.map(esc).join('; ')}</p>` : ''}`;
  const map = L.map(box.querySelector('.mig-map'), { scrollWheelZoom: false, worldCopyJump: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 12, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
  const layer = L.layerGroup().addTo(map);
  const fit = list => map.fitBounds(L.latLngBounds(list), { padding: [30, 30], maxZoom: 8 });
  fit(pts);
  box.querySelectorAll('[data-map-view]').forEach(b => b.addEventListener('click', () => fit({ all: pts, old, new: nw }[b.dataset.mapView])));
  const slider = box.querySelector('[data-map-year]'), label = box.querySelector('[data-map-label]'), note = box.querySelector('[data-map-note]'), play = box.querySelector('[data-map-play]');
  /* One SNP's circles are shown at a time, starting with the oldest; All SNPs shows every SNP as outlines only. */
  let pick = spread.length ? spread[0].s.name : 'none';
  const live = { map, timer: null };
  liveMaps.push(live);
  /* One circle per SNP in each region its carriers reached by year Y. Older SNPs are drawn as wider rings, so where a
     newer SNP lives inside an older one, its circle sits inside the older circle in that region. */
  const drawCircles = Y => spread.filter(r => pick === 'all' || r.s.name === pick).forEach(r => {
    const c = snpColor(r.s), start = r.s.place && coordsOf(r.s.place), sy = yearNum(r.s.year);
    const spots = r.events.filter(e => e.year == null || e.year <= Y).map(e => ({ ll: coordsOf(e.place), year: e.year, region: regionOf(e.place) })).filter(e => e.ll);
    if (start && (sy == null || sy <= Y)) spots.push({ ll: start, year: sy, region: regionOf(r.s.place) });
    const ring = pick === 'all' ? Math.max(20000, 60000 - r.depth * 15000) : 35000;
    [...new Set(spots.map(e => e.region))].forEach(region => {
      const group = spots.filter(e => e.region === region);
      const lat = group.reduce((t, e) => t + e.ll[0], 0) / group.length, lng = group.reduce((t, e) => t + e.ll[1], 0) / group.length;
      const centre = L.latLng(lat, lng), radius = Math.max(...group.map(e => centre.distanceTo(e.ll))) + ring;
      const ys = group.map(e => e.year).filter(y => y != null), when = ys.length ? (Math.min(...ys) === Math.max(...ys) ? ` · ${Math.min(...ys)}` : ` · ${Math.min(...ys)}–${Math.max(...ys)}`) : '';
      L.circle(centre, { radius, color: c, weight: pick === 'all' ? 1.5 : 2.5, opacity: .9, fillColor: c, fillOpacity: pick === 'all' ? 0 : .2 })
        .bindTooltip(`<b>${esc(r.s.name)}</b> in ${esc(region)}${when}<br>Carried by the descendants of ${esc(nameIn(r.man))}`).addTo(layer);
    });
  });
  const draw = Y => {
    layer.clearLayers();
    label.textContent = Y;
    if (pick !== 'none') drawCircles(Y);
    d.moves.filter(v => v.year == null || v.year <= Y).forEach(v =>
      L.polyline([coordsOf(v.from), coordsOf(v.to)], { color: '#4a5560', weight: 2, opacity: .6 })
        .bindTooltip(`${v.year != null ? v.year + ' · ' : ''}${esc(v.note)}`).addTo(layer));
    d.places.filter(p => p.first == null || p.first <= Y).forEach(p =>
      L.circleMarker(coordsOf(p.place), { radius: 4 + Math.min(p.men.size, 6), color: '#ffffff', weight: 1.5, fillColor: '#15303c', fillOpacity: .95 })
        .bindTooltip(`<b>${esc(p.place)}</b><br>First record ${p.first == null ? '—' : p.first} · ${plural(p.men.size, 'man', 'men')}`).addTo(layer));
    /* SNPs are shown by their circles, chosen with the buttons under the map, so no SNP labels are drawn on the map. */
    const recent = d.moves.filter(v => v.year != null && v.year <= Y).sort((a, b) => b.year - a.year)[0];
    note.textContent = recent ? `Latest move by ${Y}: ${recent.year} · ${recent.note}` : '';
  };
  const chips = box.querySelectorAll('[data-map-snp]');
  const markChips = () => chips.forEach(b => { const on = b.dataset.mapSnp === pick; b.style.background = on ? 'var(--accent-soft)' : ''; b.style.fontWeight = on ? '700' : ''; });
  chips.forEach(b => b.addEventListener('click', () => { pick = b.dataset.mapSnp; markChips(); draw(Number(slider.value)); }));
  markChips();
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
   must support it. The entries are kept on the member's own device so they are there next time, and never sent anywhere. */
let mine = [{ name: '', birth: '', death: '', place: '' }];
/* How the member is connected: 'son' = a Barrow man (or entering for one), 'woman' = a woman whose father's line is Barrow,
   'daughter' = the line passes through a Barrow daughter. Women do not carry Y-DNA, so a male Barrow relative has to test. */
let mineMode = 'son', mineDaughter = '';
/* The member's entries are kept in this browser's own storage, on this device only, so they are still there next time.
   Nothing is sent anywhere, and Clear removes them. */
const MINE_KEY = 'barrow-convergence-my-line';
try {
  const saved = JSON.parse(localStorage.getItem(MINE_KEY) || 'null');
  if (saved && Array.isArray(saved.rows) && saved.rows.length) {
    mine = saved.rows.map(r => ({ name: r.name || '', birth: r.birth || '', death: r.death || '', place: r.place || '' }));
    mineMode = saved.mode || 'son'; mineDaughter = saved.daughter || '';
  }
} catch (e) { /* storage unavailable: start with an empty line */ }
function saveMine() { try { localStorage.setItem(MINE_KEY, JSON.stringify({ rows: mine, mode: mineMode, daughter: mineDaughter })); } catch (e) { /* not kept */ } }
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
/* For a line through a Barrow daughter, she is entered as the last generation; the Barrow men are the generations above her. */
function daughterName() { const named = mine.filter(r => r.name.trim()); return mineMode === 'daughter' && named.length > 1 ? named[named.length - 1].name.trim() : ''; }
function findLine() {
  let rows = mine.map((p, i) => ({ p, i })).filter(r => r.p.name.trim());
  if (daughterName()) rows = rows.slice(0, -1);
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
    ${mineMode === 'daughter' ? `<p class="hint" style="margin:6px 0">Your line leaves the Barrow men at ${esc(rows[rows.length - 1].p.name)}${daughterName() ? ` through his daughter ${esc(daughterName())}` : ' through a daughter'}. Y-DNA does not pass through a daughter, so neither she nor her descendants carry this Barrow Y-DNA, but the Barrow men above her did.</p>` : ''}
    <p class="hint" style="margin:6px 0">${branch}</p>
    <p class="hint" style="margin:6px 0">This is a match on the records, not on DNA. Only a Y-DNA test of a Barrow man from your line can confirm it.</p>
    ${yourLine(join, hits, after)}
    <div class="tbl-actions"><button class="btn small" data-go="lin" data-sig="${esc(e.sig)}" data-lin="${esc(e.lin)}" data-hl="${esc(join.id)}">Open the full lineage</button></div>
  </div>`;
}
/* The member's own line, set out on its own: from the earliest Barrow ancestor in the records, father to son, down to the
   last man who matched, then on through the generations the member entered. Their matched ancestors are marked. */
function yourLine(join, hits, after) {
  const matched = new Set(hits.map(h => h.x.m.id));
  const steps = ancestorsOf(join).reverse().map(m => ({
    name: m.name, life: lifeOf(m), snps: m.snps, mine: matched.has(m.id),
    places: [m.bplace && `b. ${m.bplace}`, m.dplace && `d. ${m.dplace}`].filter(Boolean).join(' · ')
  })).concat(after.map(r => ({ name: r.p.name, life: [r.p.birth, r.p.death].filter(Boolean).join('–'), snps: [], entered: true, places: r.p.place })));
  if (mineMode === 'daughter') steps.push({ name: daughterName() ? `${daughterName()} (his daughter)` : 'His daughter', life: '', snps: [], entered: true, daughter: true, places: '' });
  const node = i => {
    if (i >= steps.length) return '';
    const s = steps[i];
    const look = s.daughter ? 'background:#fff;color:var(--ink);border:1px solid var(--line);border-radius:999px'
      : s.entered ? 'background:#fff;color:var(--ink);border:1px dashed var(--muted)'
      : s.mine ? 'outline:3px solid var(--bronze);outline-offset:2px' : '';
    return `<ul><li><div class="ut-row"><span class="anc-node"${look ? ` style="${look}"` : ''}>${esc(s.name)}</span>${s.life ? `<span class="hint">${esc(s.life)}</span>` : ''}${s.snps.map(snpTag).join('')}${s.mine ? '<span class="pill green">your ancestor</span>' : ''}${s.entered && !s.daughter ? '<span class="hint">from your entry</span>' : ''}</div>
      ${s.places ? `<div class="hint" style="margin:2px 0 0 4px">${esc(s.places)}</div>` : ''}${node(i + 1)}</li></ul>`;
  };
  return `<details class="help-box" open style="margin-top:12px"><summary>Your Barrow line</summary>
    <p class="hint" style="margin:10px 0 4px">This is your paternal line as reconstructed from your entries and the documented lineage, running father to son from the earliest recorded Barrow ancestor to the most recent generation you entered. Ancestors whose details agree with the documented records are outlined in bronze. Men with a dashed outline come only from your entry; they have not yet been documented in this lineage or confirmed by Y-DNA. Each SNP appears beside the man in whom it arose, and every male-line descendant below him on this line inherits it.</p>
    <div class="tree utree">${node(0).replace(/^<ul>/, '<ul style="padding-left:0">')}</div></details>`;
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
    ? `Y-DNA does not pass through a daughter, so the test has to be taken by a living Barrow man who descends from ${esc(last)} through sons only, such as a male-line descendant of one of ${daughterName() ? esc(daughterName()) + '’s' : 'her'} brothers. An autosomal test (AncestryDNA, 23andMe, MyHeritage or Family Finder) can support your own link to her when she is within about five or six generations of you.`
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
  <p class="muted">Enter your Barrow line to see which documented lineage it fits, which Y-DNA signature it belongs to, and whether your branch has tested. Your line is compared only with lineages confirmed by Y-DNA testing.</p>
  <div class="card"><h3>How are you connected to the Barrows?</h3>
    <div class="grid2"><div class="field"><label>My connection</label><select id="mine-mode">${[
      ['son', 'I am a Barrow man, or I am entering a Barrow man’s line'],
      ['woman', 'I am a Barrow woman: my father’s line is Barrow'],
      ['daughter', 'My line passes through a Barrow daughter']
    ].map(o => `<option value="${o[0]}"${mineMode === o[0] ? ' selected' : ''}>${o[1]}</option>`).join('')}</select></div>
    </div>
  </div>
  <div class="card"><h3>Your Barrow line</h3>
    <p class="hint">${mineMode === 'woman'
      ? 'Start with your earliest known Barrow man, then his son, and so on down to your father.'
      : mineMode === 'daughter'
      ? 'Start with your earliest known Barrow man, then his son, and so on down to the last Barrow man in your line, then enter the Barrow daughter you descend from as the last generation.'
      : 'Start with your earliest known Barrow man, then his son, and so on toward you.'} Use the father-to-son line only; estimated years are acceptable. Your entries are kept on this device only, so they will be here when you return, and they are never sent anywhere. Clear removes them.</p>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>Name</th><th>Born</th><th>Died</th><th>Where he lived</th><th></th></tr></thead><tbody>
      ${mine.map((r, i) => `<tr><td class="calc">${i + 1}${i === 0 ? ' <span class="muted">(earliest)</span>' : ''}</td>${inp(i, 'name', i === 0 ? 'e.g. Josiah Barrow' : 'e.g. his son Elias Barrow')}${inp(i, 'birth', 'e.g. 1745', 90)}${inp(i, 'death', 'e.g. 1810', 90)}${inp(i, 'place', 'e.g. Bertie County, NC')}<td>${mine.length > 1 ? `<button class="row-btn" data-act="mine-del" data-i="${i}" title="Remove">✕</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="tbl-actions"><button class="btn small" data-act="mine-add">+ Add the next generation</button>${mine.some(r => r.name || r.birth || r.death || r.place) ? '<button class="btn small ghost" data-act="mine-clear">Clear</button>' : ''}</div>
  </div>
  <div id="find-out">${findResults()}</div>`;
}

/* ---------- Help for beginners ----------
   Every card has a "What am I looking at?" box that opens with a click, and the Learn the basics page
   explains the ideas behind the app one step at a time, in plain words. */
function helpBox(title, paras) {
  return `<details class="help-box"><summary>${esc(title)}</summary><div style="margin-top:10px"><p class="hint" style="margin:0">${paras.join(' ')}</p></div></details>`;
}
function confirmedNote() {
  return `<div class="verdict green" style="display:block;margin:0 0 18px"><b>Y-DNA confirmed lineages only</b>
    <div class="hint" style="margin-top:4px">Every line shown here has at least one male descendant whose Y-DNA test places it on the Barrow SNP tree. Lines that have not tested yet are not shown, not because they are unrelated, but because the DNA has not confirmed them.</div></div>`;
}
/* A man's name as it reads in a sentence: "the father of …" for a man known only by his son. */
function nameIn(m) { return /^father of/i.test(m.name) ? 'the f' + m.name.slice(1) : m.name; }
/* Every man descended from a man, through sons, including the man himself. */
function descendantsOf(m) { return [m].concat(...m.kids.map(descendantsOf)); }
/* How each SNP travelled: where it began, then where the men who carry it were recorded, in order. */
function snpJourneys(sig) {
  const list = D.snps.filter(s => s.sig === sig), order = [];
  const walk = nodes => nodes.forEach(s => { order.push(s); walk(s.kids); });
  walk(list.filter(s => !list.some(x => x.name === s.parent)));
  const items = order.map(s => {
    const m = D.men.get(s.formedIn);
    if (!m) return '';
    const regions = presence(descendantsOf(m)), start = s.place || m.bplace;
    const began = `<span class="snp-node target">${esc(s.name)}</span> began${s.year ? ' c. ' + esc(s.year) : ''} with ${esc(nameIn(m))}${start ? `, ${/^near /i.test(start) ? esc(start.charAt(0).toLowerCase() + start.slice(1)) : 'in ' + esc(start)}` : ''}.`;
    const path = regions.length > 1
      ? ` His male-line descendants carry it with them. They are recorded in ${regions.map(r => `<b>${esc(r.region)}</b>${r.first != null ? ' (' + r.first + ')' : ''}`).join(', then ')}.`
      : regions.length ? ` His male-line descendants in these records stayed in <b>${esc(regions[0].region)}</b>.` : '';
    return `<li style="margin-bottom:10px">${began}${path}</li>`;
  }).filter(Boolean);
  return items.length ? `<ul style="margin:6px 0 0 18px;padding:0">${items.join('')}</ul>` : '<p class="muted">Add the man each SNP formed in to see its journey.</p>';
}
/* A family tree in the same style as Convergence's test introductions: squares are men, circles are women.
   An SNP begins in one man in the homeland, his sons fill it, one line moves on, and a newer SNP begins in the new land. */
function travelDiagram() {
  const A = '#2f6b85', B = '#a8762f', L = '#c9c1b2', T = '#1f2b33', W = '#ffffff', M = '#6b7378';
  const man = (x, y, ring) => `<rect x="${x - 18}" y="${y - 18}" width="36" height="36" rx="5" fill="${A}" stroke="${ring ? B : A}" stroke-width="${ring ? 4 : 1.5}"/>`;
  const woman = (x, y) => `<circle cx="${x}" cy="${y}" r="18" fill="${W}" stroke="${L}" stroke-width="1.5"/>`;
  const link = (x1, y1, x2, y2) => `<path d="M${x1} ${y1 + 44} V${(y1 + y2) / 2 + 8} H${x2} V${y2 - 18}" fill="none" stroke="${L}" stroke-width="2"/>`;
  const txt = (x, y, s, c = T, w = 400, a = 'middle', size = 13) => `<text x="${x}" y="${y}" text-anchor="${a}" font-size="${size}" font-weight="${w}" fill="${c}">${s}</text>`;
  const body = [
    txt(16, 26, 'THE HOMELAND', M, 600, 'start', 11),
    link(400, 40, 240, 150), link(400, 40, 400, 150), link(400, 40, 560, 150),
    link(240, 150, 170, 260), link(240, 150, 310, 260), link(560, 150, 560, 260),
    man(400, 40, true), txt(400, 76, 'Ancestor: SNP A begins', B, 600),
    man(240, 150), txt(240, 186, 'Son'),
    woman(400, 150), txt(400, 186, 'Daughter'),
    man(560, 150), txt(560, 186, 'Son'),
    man(170, 260), txt(170, 296, 'Grandson'),
    man(310, 260), txt(310, 296, 'Grandson'),
    man(560, 260), txt(560, 296, 'Grandson: moves on', B, 600),
    txt(240, 316, 'Stay in the homeland', M, 400, 'middle', 12),
    `<path d="M16 322 H704" stroke="${L}" stroke-width="1.5" stroke-dasharray="6 5"/>`,
    txt(16, 344, 'THE NEW LAND', M, 600, 'start', 11),
    link(560, 260, 480, 380), link(560, 260, 640, 380),
    man(480, 380), txt(480, 416, 'Great-grandson'),
    man(640, 380, true), txt(640, 416, 'New SNP B begins', B, 600),
    man(150, 482), txt(176, 487, 'Carries SNP A', T, 400, 'start'),
    man(330, 482, true), txt(356, 487, 'The man an SNP began in', T, 400, 'start'),
    woman(560, 482), txt(586, 487, 'No Y-DNA', T, 400, 'start')
  ].join('');
  return `<div class="intro-fig"><svg viewBox="0 0 720 510" role="img" aria-label="An SNP begins in one man in the homeland, his sons and grandsons carry it there, one grandson moves to a new land, and a newer SNP begins in one of his sons there" style="width:100%;max-width:720px;height:auto;display:block;margin:14px auto 6px;font-family:inherit">${body}</svg></div>`;
}
const LEARN = [
  ['Y-DNA and the paternal line', [
    'The Y chromosome is the one piece of a man’s DNA that comes from his father alone. It passes from father to son almost unchanged, so it follows the direct paternal line, the patrilineal line, in the same way a surname usually does. Women do not inherit a Y chromosome, so a Y-DNA test speaks only to that single line: a man’s father, his father’s father, and so on back. It says nothing about the many other ancestors in his tree, which is why Y-DNA is especially suited to surname research, where the question is whether men of the same name share a common paternal ancestor.'
  ]],
  ['SNPs: permanent markers of descent', [
    'A single nucleotide polymorphism, or SNP (pronounced “snip”), is a one-letter change in the Y chromosome that occurs when it is copied from a father to a son. Once an SNP arises, it is permanent: the man in whom it first appears passes it to all of his sons, and they to theirs, so every male-line descendant carries it. An SNP therefore marks one specific ancestor, and every man who carries it descends from him. New SNPs arise roughly every three to five generations. A tester’s SNPs form a chain from the oldest to the most recent, and the most recent is his terminal SNP. FamilyTreeDNA names each SNP (for example, R-FT249996) and estimates when it formed, known as its formation date. Formation dates are statistical estimates with a range of uncertainty, so they are best used as a guide alongside the records rather than as exact years.'
  ]],
  ['Y-DNA signatures: separate families of one surname', [
    'Hereditary surnames were adopted independently by unrelated men in different places, so a single surname often conceals several unrelated paternal families. Each family carries its own set of SNPs, inherited from its own founder; that set is its Y-DNA signature, and it places the family on a distinct branch of the wider human Y-DNA tree, its haplogroup. Two Barrow men with different signatures share a surname but not a paternal ancestor within the age of surnames, however similar their family traditions. This is why the app is organised by signature first: the signature determines which Barrow family a man belongs to before any question of lineage can be asked.'
  ]],
  ['Lineages, and what “Y-DNA confirmed” means', [
    'A lineage is a documented father-to-son line from a known ancestor down to men living today. Records alone can mislead: an adoption, an informal change of name, a child raised by a stepfather or an undocumented father can break the biological line while the paper trail continues unbroken. Such a break is known as a non-paternal event. A lineage is shown in this app only when it is confirmed by Y-DNA, meaning at least one male descendant has tested and his results place the line on the Barrow SNP tree, demonstrating that the line carries the Barrow Y-DNA its records claim. Lines that have not yet tested are not shown. Their absence does not mean they are unrelated, only that the DNA has not yet confirmed them.'
  ]],
  ['How SNPs travel: settle, fill, move on', [
    'Because each SNP begins in one man, it also begins in one place. While his descendants remain there, the SNP spreads through the families of that area over several generations, and the region comes to be populated by men who carry it. When some of those men move on, emigrating overseas or migrating to new land, they carry the SNP with them, and it appears in a new region. There, in time, a newer SNP arises in one of the men born in the new place, and only his descendants carry it. The result is a nested pattern: older SNPs are found across every region the family reached, while newer SNPs are confined to the branch, and the places, that came after them. Reading a family’s SNPs from the oldest to the most recent therefore traces the route it took. The diagram below illustrates the pattern, and each signature’s page traces the actual journey of its own SNPs.'
  ]],
  ['Reading the map and the spread of each SNP', [
    'On the migration map, each dark dot is a place where a documented man of the line was born or died, and each grey line is a move between generations: a son born in a new place, or a man who died away from his birthplace. Choosing an SNP beneath the map shows the regions where its carriers were recorded, and pressing Play steps through the years to show that spread over time. The table beneath the map gives the same information for every SNP: where and in whom it began, and each region its carriers reached, in order, with the first and last years they appear there. A first record shows the family was present by that year; the actual arrival may be somewhat earlier, since records begin when an event happened to be written down.'
  ]],
  ['Records and DNA: the convergence of evidence', [
    'No single source proves a line. DNA can show that men share a paternal ancestor and roughly how long ago their lines met, but it cannot name him; records can name him, but they may be incomplete or wrong. Convergence is the point at which these independent lines of evidence, the SNPs, the records and, where available, STR marker comparisons, all point to the same ancestor. The more lines of evidence that agree, the stronger the conclusion, and a conclusion reached this way remains open to revision as new records or test results appear. When you use Find my Barrow line, a match is a match on the records alone; only a Y-DNA test of a man from your own line can confirm it.'
  ]],
  ['Who should take a Y-DNA test?', [
    'Only men carry a Y chromosome, and it reflects only their paternal line. A woman researching her Barrow line therefore needs a male relative from that line to test: her father, a brother, her father’s brother, or a male Barrow cousin who descends from the same ancestor through sons only. For a line that passes through a Barrow daughter, the tester must be a male-line descendant of one of her brothers. FamilyTreeDNA’s Big Y-700 test identifies a man’s SNPs and places him precisely on the Barrow SNP tree. The Y-37, Y-67 and Y-111 tests compare STR markers, which mutate more often than SNPs, and show which Barrow lineage a man matches most closely; they are a useful first step, but they do not place him on the SNP tree.'
  ]]
];
function renderLearn() {
  return `<h1>Learn the basics</h1>
  ${LEARN.map((s, i) => `<div class="card"><h3>${i + 1}. ${esc(s[0])}</h3><p style="line-height:1.6">${esc(s[1].join(' '))}</p>${i === 4 ? travelDiagram() : ''}</div>`).join('')}
  <div class="tbl-actions"><button class="btn" data-go="find">Find my Barrow line</button><button class="btn ghost" data-go="home">Back to the signatures</button></div>`;
}

/* ---------- Pages ---------- */
function renderHome() {
  const cards = D.sigs.map(sig => {
    const men = allMen().filter(m => m.sig === sig);
    /* The signature's origin is the region where its oldest SNP began, or failing that, the earliest region in its records. */
    const root = D.snps.find(s => s.sig === sig && !D.snps.some(x => x.sig === sig && x.name === s.parent));
    const origin = root && root.place ? regionOf(root.place) : (presence(men)[0] || {}).region;
    return `<div class="anc-card" data-go="sig" data-sig="${esc(sig)}">
      <h3>${esc(sig)}</h3>
      <div class="hint">${plural(lineagesOf(sig).length, 'lineage')} · ${plural(testersOfSig(sig).length, 'tester')}</div>
      ${origin ? `<div class="hint" style="margin-top:8px">Origin: ${esc(origin)}</div>` : ''}</div>`;
  }).join('');
  return `<div class="hero">
    <h1>Barrow Y-DNA Lineages</h1>
    <p>The Barrows are not one family. Y-DNA testing shows that the surname is carried by separate paternal families, each with its own Y-DNA signature. Choose a signature to see its lineages, where its men lived and how the family spread.</p>
    <div class="tbl-actions"><button class="btn" data-go="find" style="background:var(--bronze)">Find my Barrow line</button></div>
  </div>
  ${confirmedNote()}
  <h2>Y-DNA signatures</h2>
  ${helpBox('What is a Y-DNA signature?', [
    'Y-DNA passes from father to son, so it follows the surname line. Each separate Barrow family carries its own set of permanent DNA markers, called SNPs, and that set is the family’s Y-DNA signature.',
    'Barrow men with different signatures share a surname but not a paternal ancestor. Open a signature to see its lineages and how it spread. <a href="#" data-go="learn">Learn the basics</a> explains each idea step by step.'
  ])}
  <div class="anc-cards">${cards}</div>
  ${D.sigs.length < 2 ? '<p class="hint" style="margin-top:12px">The second signature will appear here once its data is added.</p>' : ''}`;
}
function renderSig(sig) {
  const lins = lineagesOf(sig);
  return `<h1>${esc(sig)}</h1>
  <p class="muted">${plural(lins.length, 'lineage')} · ${plural(testersOfSig(sig).length, 'tester')} · ${pill('green', 'Y-DNA confirmed lineages only')}</p>
  <div class="card"><h3>Y-DNA confirmed lineages</h3>
    ${helpBox('What is a Y-DNA confirmed lineage?', [
      'A lineage is a documented line, father to son, from a known ancestor down to men living today.',
      'Each lineage shown here is confirmed by Y-DNA: at least one male descendant has tested, and his results place the line on this signature’s SNP tree. Click a lineage to see its men, its SNPs and its testers.'
    ])}
    <div class="anc-cards">${lins.map(l => lineageCard(sig, l)).join('')}</div></div>
  <div class="card"><h3>SNP tree</h3>
    ${helpBox('How to read the SNP tree', [
      'An SNP is a small, permanent change in Y-DNA. It begins in one man and is carried by all his sons, grandsons and later male-line descendants.',
      'The oldest SNP is at the top. Each step down is a newer SNP that began in one man of a later generation. A man carries every SNP above him on his own branch. Where two branches split, the SNP just above the split is the one both lines share: it began in their common ancestor.'
    ])}
    ${snpTree(sig)}</div>
  ${mapCard('sig', sig)}
  <div class="card"><h3>Where each SNP spread</h3>
    ${helpBox('How to read this table', [
      'Each row is one SNP, oldest at the top. An arrow (↳) marks a newer SNP that began inside the one above it, so it is carried by only one branch of that family.',
      '<b>Where it began</b> is the man the SNP first appeared in, and when and where. <b>Where its carriers lived</b> follows his male-line descendants, the men who carry it, region by region in the order they were recorded there, with the first and last year they appear in each. Read along a row to watch one SNP settle in a region, fill it over several generations, and then move on with the sons who left. <b>Men</b> is how many documented men carry it.',
      'Each SNP has the same colour here as its circle on the map above. Only Y-DNA confirmed lineages are counted.'
    ])}
    ${spreadTable(allMen().filter(m => m.sig === sig))}</div>`;
}
function renderLin(sig, lin) {
  const ts = testersOfLin(lin);
  return `<h1>${esc(lin)}</h1>
  <p class="muted">${esc(sig)} · ${plural(ts.length, 'tester')} · ${pill('green', 'Confirmed by Y-DNA')}</p>
  <div class="card"><h3>The documented line</h3>
    ${helpBox('How to read this line', [
      'This is the line father to son, with the oldest man at the top. Each man’s dates and places come from the records.',
      'A bronze SNP beside a man means that SNP began in him, so every male-line descendant of his carries it. A grey tag shows how many testers descend from that man, and their newest SNP. The testers’ results are what confirm this line by Y-DNA. Living generations and testers’ names are never shown.'
    ])}
    ${lineTree(lin)}</div>
  ${mapCard('lin', lin)}
  <div class="card"><h3>Where each SNP spread</h3>
    ${helpBox('How to read this table', [
      'Each row is one SNP this line carries, oldest at the top. An arrow (↳) marks a newer SNP that began inside the one above it.',
      '<b>Where it began</b> is the man the SNP first appeared in, and when and where. <b>Where its carriers lived</b> follows the men of this line who carry it, region by region in the order they were recorded there, with the first and last year they appear in each. <b>Men</b> is how many documented men of this line carry it.',
      'Each SNP has the same colour here as its circle on the map above.'
    ])}
    ${spreadTable(menOf(lin))}</div>`;
}
function renderNav() {
  const on = (page, sig, lin) => view.page === page && view.sig === (sig || '') && view.lin === (lin || '') ? ' active' : '';
  return `<a data-go="home" class="${on('home')}">Home</a>
    <a data-go="find" class="${on('find')}">Find my Barrow line</a>
    <a data-go="learn" class="${on('learn')}">Learn the basics</a>`;
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
  } else if (view.page === 'learn') {
    crumb.textContent = 'Learn the basics';
    main.innerHTML = renderLearn();
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
  labelTables(main);
  setupMaps();
}
/* On a phone, each table row is shown as a small card: every cell gets its column heading as a label (see style.css). */
function labelTables(root) {
  root.querySelectorAll('table.tbl').forEach(t => {
    const heads = [...t.querySelectorAll('thead th')].map(th => th.textContent.trim());
    if (!heads.length) return;
    t.classList.add('stack-tbl');
    t.querySelectorAll('tbody tr').forEach(tr => [...tr.children].forEach((td, i) => { td.dataset.label = heads[i] || ''; }));
  });
}

/* ---------- Events ---------- */
document.addEventListener('click', e => {
  const app = document.querySelector('.app');
  const act = e.target.closest('[data-act]');
  if (act) {
    if (act.dataset.act === 'open-menu') app.classList.add('menu-open');
    if (act.dataset.act === 'close-menu') app.classList.remove('menu-open');
    if (act.dataset.act === 'mine-add') { mine.push({ name: '', birth: '', death: '', place: '' }); saveMine(); render(); }
    if (act.dataset.act === 'mine-del') { mine.splice(Number(act.dataset.i), 1); saveMine(); render(); }
    if (act.dataset.act === 'mine-clear') { mine = [{ name: '', birth: '', death: '', place: '' }]; mineMode = 'son'; mineDaughter = ''; saveMine(); render(); }
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
  if (e.target.id === 'mine-mode') { mineMode = e.target.value; saveMine(); render(); return; }
  if (e.target.id === 'mine-daughter') { mineDaughter = e.target.value; saveMine(); const o = document.getElementById('find-out'); if (o) o.innerHTML = findResults(); return; }
  if (d.mine == null) return;
  mine[Number(d.mine)][d.f] = e.target.value;
  saveMine();
  const out = document.getElementById('find-out');
  if (out) { out.innerHTML = findResults(); labelTables(out); }
});

/* ---------- Start ---------- */
loadData().then(d => { D = d; render(); }).catch(() => {
  document.getElementById('main').innerHTML = `<div class="card"><h3>The Barrow data could not be loaded</h3>
    <p class="hint">Check that barrow-ancestors.csv, barrow-testers.csv and barrow-snps.csv are in the same folder as index.html. If you opened index.html by double-clicking it, open it with Live Server in Visual Studio Code instead: browsers only let a page read the CSV files when it is served that way, or from the website.</p></div>`;
});