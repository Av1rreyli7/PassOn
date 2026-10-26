/* PassOn · app logic
   Donation listing platform for Bandra and BKC.
   Data is saved in the browser (localStorage) so one device can play both the donor and the organisation. */

(function () {
  'use strict';

  // ---------- constants ----------
  var HOURS_TO_CLAIM = 48;
  var ORG_NAME = 'Goonj';
  var KG = { Clothes: 0.5, Utensils: 1.0, Books: 0.3, Electronics: 1.5 }; // average weight per item, by category
  var CATS = [['Clothes', 'ti-shirt'], ['Utensils', 'ti-tools-kitchen-2'], ['Books', 'ti-book'], ['Electronics', 'ti-plug']];
  var CONDS = [['Clean and usable', 'Washed, works, nothing missing'], ['Minor wear', 'Small marks or fading, fully usable']];
  var POINTS = [
    { name: 'Carter Road promenade', dist: '0.6 km', when: 'Open daily, 8 am to 8 pm', x: '22%', y: '26%' },
    { name: "Hill Road, near St Peter's", dist: '0.9 km', when: 'Open daily, 9 am to 7 pm', x: '56%', y: '44%' },
    { name: 'Linking Road', dist: '1.3 km', when: 'Open daily, 8 am to 8 pm', x: '76%', y: '14%' }
  ];
  var DATES = ['Mon 27', 'Tue 28', 'Wed 29'];
  var DATES_LONG = ['Mon 27 Oct', 'Tue 28 Oct', 'Wed 29 Oct'];
  var SLOTS = ['9 to 11 am', '12 to 2 pm', '4 to 6 pm'];
  var NEED_TYPES = ["Children's clothing", 'Woollens', 'School materials', 'Utensils'];
  var NEED_CAT = { "Children's clothing": 'Clothes', 'Woollens': 'Clothes', 'School materials': 'Books', 'Utensils': 'Utensils' };
  var DEADLINES = [['In 3 days', 3], ['In 1 week', 7], ['In 2 weeks', 14]];

  // ---------- starting data ----------
  // The site starts empty. Donors create listings, organisations claim them and post needs.
  function seed() { return { role: 'donor', listings: [], needs: [], createdAt: Date.now() }; }

  // ---------- storage ----------
  var KEY = 'passon-v1';
  var db;
  function load() {
    try { db = JSON.parse(localStorage.getItem(KEY)); } catch (e) { db = null; }
    if (!db || !db.listings) { db = seed(); save(); }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* storage full or blocked, keep going in memory */ }
  }

  // ---------- helpers ----------
  var state = { draft: freshDraft(), filter: 'All', claimedOpen: null, justPosted: null, need: { type: 0, qty: 20, deadline: 1 }, pulsed: false, counted: false };
  function freshDraft() { return { photo: null, status: 'none', cat: null, cond: null, hand: 'drop', point: 0, date: 1, slot: 1 }; }
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function left(l) { return (l.expiresAt - Date.now()) / 1000; }
  function isExpired(l) { return l.stage === 1 && left(l) <= 0; }
  function fmt(s) {
    if (s <= 0) return 'Expired';
    s = Math.floor(s);
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    return h > 0 ? h + 'h ' + String(m).padStart(2, '0') + 'm left' : m + 'm ' + String(ss).padStart(2, '0') + 's left';
  }
  function catIcon(cat) { for (var i = 0; i < CATS.length; i++) if (CATS[i][0] === cat) return CATS[i][1]; return 'ti-package'; }
  function photoStyle(l) { return l.photo ? ' style="background-image:url(' + l.photo + ')"' : ''; }
  function photoLabel(l) { return l.photo ? '' : '<span class="mono">' + esc(l.photoLabel || 'photo') + '</span>'; }
  function num(n) { return n.toLocaleString('en-IN'); }
  function handoverText(l) { return l.hand === 'drop' ? 'Drop off at ' + l.where : 'Pickup, ' + l.when; }
  function statusText(l) {
    if (l.stage === 3) return 'Received by ' + l.claimedBy;
    if (l.stage === 2) return 'Claimed by ' + l.claimedBy + ' · ' + (l.hand === 'drop' ? 'drop off at ' + l.where : 'pickup ' + l.when);
    if (left(l) <= 0) return 'Expired · not claimed in ' + HOURS_TO_CLAIM + 'h';
    var hrs = Math.ceil(left(l) / 3600);
    return 'Listed · waiting for an NGO · ' + hrs + 'h to claim';
  }
  function myListings() { return db.listings.filter(function (l) { return l.owner === 'me'; }); }
  function activeMine() { return myListings().filter(function (l) { return l.stage < 3 && !isExpired(l); }); }
  function feedListings() {
    return db.listings.filter(function (l) {
      if (state.removed[l.id]) return false;
      if (l.stage === 1) return left(l) > 0 || state.fading[l.id];
      return l.stage === 2 && l.claimedBy === ORG_NAME;
    });
  }
  state.removed = {};

  function trailHTML(stage, animate) {
    var labels = ['Listed', 'Claimed', 'Received'], out = '<div class="trail">';
    for (var i = 0; i < 3; i++) {
      var done = i < stage, d = i * 380;
      out += '<div class="trail-step' + (done ? ' done' : '') + (done && animate ? ' anim' : '') + '" style="--d:' + d + 'ms;--d2:' + Math.max(0, d - 200) + 'ms">' +
        (i > 0 ? '<div class="trail-line"><div></div></div>' : '') +
        '<div class="trail-dot"><i class="ti ' + (done ? 'ti-check' : 'ti-point') + '"></i></div>' +
        '<span class="trail-label">' + labels[i] + '</span></div>';
    }
    return out + '</div>';
  }
  function countdownHTML(l, extra) {
    var s = left(l), amber = s < 7200;
    return '<span class="countdown' + (amber ? ' amber' : '') + (extra ? ' ' + extra : '') + '" data-countdown="' + l.id + '"><i class="ti ti-hourglass"></i>' + fmt(s) + '</span>';
  }
  function topbarHTML() {
    var donor = db.role === 'donor';
    return '<div class="topbar"><div class="logo"><div class="logo-mark"><i class="ti ti-arrow-forward-up"></i></div><span class="logo-text">PassOn</span></div>' +
      '<div class="role-switch" role="group" aria-label="Account type">' +
      '<button class="' + (donor ? 'on' : '') + '" data-action="switch" data-role="donor"><i class="ti ti-user"></i>Donor</button>' +
      '<button class="' + (!donor ? 'on' : '') + '" data-action="switch" data-role="org"><i class="ti ti-building-community"></i>Organisation</button></div></div>';
  }
  function toast(msg, icon) {
    var old = $('.toast'); if (old) old.remove();
    var t = document.createElement('div');
    t.className = 'toast'; t.innerHTML = '<i class="ti ' + (icon || 'ti-circle-check') + '"></i>' + esc(msg);
    $('#app').appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }

  // ---------- routing ----------
  function route() { return location.hash.replace('#', '') || (db.role === 'donor' ? 'home' : 'feed'); }
  function go(r) { if (route() === r) render(); else location.hash = r; }
  window.addEventListener('hashchange', render);

  function render() {
    var r = route(), donor = db.role === 'donor';
    var donorOnly = ['home', 'give', 'give-details', 'give-handover', 'posted', 'listings'];
    var orgOnly = ['feed', 'needs'];
    if (!donor && (donorOnly.indexOf(r) >= 0 || r.indexOf('listing/') === 0)) { location.hash = 'feed'; return; }
    if (donor && orgOnly.indexOf(r) >= 0) { location.hash = 'home'; return; }

    var screen = $('#screen'), html = '', tabs = true, scroll = true;
    if (r === 'home') html = homeHTML();
    else if (r === 'give') { html = step1HTML(); tabs = false; scroll = false; }
    else if (r === 'give-details') { html = step2HTML(); tabs = false; scroll = false; }
    else if (r === 'give-handover') { html = step3HTML(); tabs = false; scroll = false; }
    else if (r === 'posted') { html = postedHTML(); tabs = false; scroll = false; }
    else if (r === 'listings') html = listingsHTML();
    else if (r.indexOf('listing/') === 0) { html = detailHTML(r.slice(8)); tabs = false; }
    else if (r === 'account') html = accountHTML();
    else if (r === 'feed') html = feedHTML();
    else if (r === 'needs') html = needsHTML();
    else { location.hash = donor ? 'home' : 'feed'; return; }

    var fresh = screen.cloneNode(false);
    fresh.className = 'screen' + (scroll ? ' scroll' : '');
    fresh.innerHTML = html;
    screen.replaceWith(fresh);
    fresh.scrollTop = 0;
    renderTabs(tabs, r);
    afterRender(r);
  }

  function renderTabs(show, r) {
    var bar = $('#tabbar');
    if (!show) { bar.className = 'tabbar hidden'; return; }
    var donor = db.role === 'donor';
    var items = donor
      ? [['home', 'ti-home', 'Home'], ['give', 'ti-gift', 'Give'], ['listings', 'ti-list-check', 'Listings'], ['account', 'ti-user-circle', 'Account']]
      : [['feed', 'ti-layout-grid', 'Feed'], ['needs', 'ti-clipboard-list', 'Needs'], ['account', 'ti-user-circle', 'Account']];
    bar.className = 'tabbar' + (donor ? '' : ' three');
    bar.innerHTML = items.map(function (t) {
      var on = r === t[0] || (t[0] === 'listings' && r.indexOf('listing/') === 0);
      return '<a href="#' + t[0] + '" class="' + (on ? 'on' : '') + '"' + (on ? ' aria-current="page"' : '') + '><i class="ti ' + t[1] + '"></i>' + t[2] + '</a>';
    }).join('');
  }

  // ---------- screens ----------
  function homeHTML() {
    var items = activeMine();
    var received = db.listings.filter(function (l) { return l.stage === 3; });
    var totalItems = received.length;
    var totalKg = Math.round(received.reduce(function (a, l) { return a + l.kg; }, 0) * 10) / 10;
    var cards = items.map(function (l, i) {
      var isNew = state.justPosted === l.id;
      return '<a href="#listing/' + l.id + '" class="card ' + (isNew ? 'drop' : 'rise') + '" style="animation-delay:' + (isNew ? 0 : 300 + i * 90) + 'ms">' +
        '<div class="row" style="gap:12px"><div class="thumb"' + photoStyle(l) + '>' + (l.photo ? '' : 'photo') + '</div>' +
        '<div class="grow" style="display:flex;flex-direction:column;gap:2px"><span class="card-title">' + esc(l.title) + '</span><span class="card-status">' + esc(statusText(l)) + '</span></div></div>' +
        trailHTML(l.stage, true) + '</a>';
    }).join('');
    if (!items.length) cards = '<div class="empty" style="padding:24px"><div class="ic"><i class="ti ti-gift"></i></div><span class="section-title">Nothing listed yet</span><span class="sub">Tap Give an item to pass on your first thing.</span></div>';
    var needs = db.needs.map(function (n, i) {
      return '<div class="need" style="--d:' + (200 + i * 110) + 'ms"><div class="need-photo">' + esc(n.photoLabel || 'photo') + '</div><div class="need-body">' +
        '<span class="need-org"><i class="ti ti-rosette-discount-check"></i>' + esc(n.org) + '</span><span class="need-title">' + esc(n.need) + '</span><span class="small">' + esc(n.detail) + '</span>' +
        '<button class="btn-tint" style="margin-top:4px" data-action="donate-need" data-cat="' + esc(NEED_CAT[n.need] || '') + '"><i class="ti ti-gift"></i>Donate this</button></div></div>';
    }).join('');
    if (!db.needs.length) needs = '<div class="need" style="--d:200ms;width:100%;padding:20px 16px;align-items:center;text-align:center;gap:8px"><div class="ic" style="width:48px;height:48px;border-radius:50%;background:var(--tint);color:var(--green);display:flex;align-items:center;justify-content:center"><i class="ti ti-clipboard-list" style="font-size:24px"></i></div><span class="card-title">No needs posted yet</span><span class="small">When an NGO posts what it needs, it shows here.</span></div>';
    return topbarHTML() +
      '<div style="padding:8px 16px 0;display:flex;flex-direction:column;gap:4px"><div class="title">Hi Riya, what can you pass on today?</div><div class="row" style="font-size:15px;color:var(--muted);gap:4px"><i class="ti ti-map-pin" style="font-size:16px"></i>Bandra West</div></div>' +
      '<div style="padding:20px 16px 0"><a href="#give" class="btn-give"><i class="ti ti-gift"></i>Give an item</a></div>' +
      '<div class="counters"><div class="counter"><i class="ti ti-package"></i><span class="num" data-count="' + totalItems + '">0</span><span class="lbl">Items donated</span></div>' +
      '<div class="counter"><i class="ti ti-leaf"></i><span class="num"><span data-count="' + totalKg + '">0</span> kg</span><span class="lbl">Kg diverted from landfill</span></div></div>' +
      '<div style="padding:28px 16px 0" class="col"><div class="section-title">Your Active Listings</div>' + cards + '</div>' +
      '<div style="padding:28px 0 0" class="col"><div class="needs-head"><span class="section-title">Needs board</span><span class="small">Posted by NGOs nearby</span></div><div class="needs-scroll">' + needs + '</div></div>' +
      '<div style="padding:28px 16px 112px" class="col"><div class="section-title">How it works</div><div class="how">' +
      '<div><div class="ic"><i class="ti ti-camera"></i></div><span>1. Snap a photo</span></div>' +
      '<div><div class="ic"><i class="ti ti-arrows-exchange"></i></div><span>2. Choose handover</span></div>' +
      '<div><div class="ic"><i class="ti ti-heart-handshake"></i></div><span>3. An NGO collects it</span></div></div></div>';
  }

  function wizHead(step, back, title, sub) {
    return '<div class="wiz-head"><div class="wiz-top"><a href="#' + back + '" class="back"><i class="ti ti-arrow-left"></i>Back</a><span class="small">Step ' + step + ' of 3</span></div>' +
      '<div class="progress"><div style="width:' + (step * 33.3).toFixed(1) + '%"></div></div>' +
      (title ? '<div class="title-22" style="margin-top:8px">' + title + '</div>' : '') + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>';
  }
  function photoBlock(big) {
    var d = state.draft;
    if (d.status === 'loading') return big
      ? '<div class="shimmer"><span class="row" style="font-size:15px;color:var(--muted)"><i class="ti ti-loader-2 spin" style="font-size:18px"></i>Preparing preview</span></div>'
      : '<div class="shimmer sm"></div><span class="grow" style="font-size:15px;color:var(--muted)">Uploading…</span>';
    if (d.status === 'done') return big
      ? '<div class="grow col"><div class="preview" style="background-image:url(' + d.photo + ')"><span></span><span class="pill"><i class="ti ti-check"></i>Looks good</span></div><button class="btn-small" style="align-self:flex-start" data-action="retake"><i class="ti ti-refresh"></i>Retake photo</button></div>'
      : '<div class="photo-mini" style="background-image:url(' + d.photo + ')"></div><span class="grow row" style="font-size:15px;font-weight:500"><i class="ti ti-circle-check" style="font-size:18px;color:var(--green)"></i>Photo added</span>';
    return big
      ? '<button class="upload" data-action="pick-photo"><div class="circle"><i class="ti ti-camera"></i></div><span class="t">Take or upload a photo</span><span class="s">Tap anywhere in this area</span></button>'
      : '<span class="grow" style="font-size:15px;color:var(--muted)">No photo yet</span><button class="btn-small tint" data-action="pick-photo"><i class="ti ti-camera"></i>Add photo</button>';
  }
  function step1HTML() {
    return wizHead(1, 'home', 'Add a photo of your item', 'One clear photo in daylight helps NGOs decide fast.') +
      '<div style="flex:1;padding:20px 16px;display:flex;flex-direction:column" id="photoArea">' + photoBlock(true) + '</div>' +
      '<div style="padding:0 16px 24px"><a href="#give-details" class="btn"><i class="ti ti-arrow-right"></i>Next: details</a></div>';
  }
  function missing() {
    var d = state.draft, m = [];
    if (d.status !== 'done') m.push('photo');
    if (!d.cat) m.push('category');
    if (!d.cond) m.push('condition');
    return m;
  }
  function nextLabel() {
    var m = missing();
    if (!m.length) return 'Next: handover';
    return (m[0] === 'category' ? 'Choose a ' : 'Add ') + (m.length === 1 ? m[0] : m.length === 2 ? m[0] + ' and ' + m[1] : m[0] + ', ' + m[1] + ' and ' + m[2]);
  }
  function step2HTML() {
    var d = state.draft, ok = !missing().length;
    var chips = CATS.map(function (c) { return '<button class="chip' + (d.cat === c[0] ? ' on' : '') + '" data-action="cat" data-cat="' + c[0] + '" aria-pressed="' + (d.cat === c[0]) + '"><i class="ti ' + c[1] + '"></i>' + c[0] + '</button>'; }).join('');
    var conds = CONDS.map(function (c) {
      var on = d.cond === c[0];
      return '<button class="cond' + (on ? ' on' : '') + '" data-action="cond" data-cond="' + c[0] + '" role="radio" aria-checked="' + on + '"><span class="ring">' +
        (on ? '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" stroke="#2E7D32" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="24"/></svg>' : '') +
        '</span><span style="display:flex;flex-direction:column;gap:2px"><span class="name">' + c[0] + '</span><span class="desc">' + c[1] + '</span></span></button>';
    }).join('');
    return wizHead(2, 'give') +
      '<div class="wiz-body"><div class="photo-row" id="photoArea">' + photoBlock(false) + '</div>' +
      '<div class="col" style="gap:10px"><span class="section-title">Category</span><div class="chips">' + chips + '</div></div>' +
      '<div class="col" style="gap:10px" role="radiogroup" aria-label="Condition"><span class="section-title">Condition</span>' +
      '<span class="guide"><i class="ti ti-heart"></i>If you would not give it to a friend, do not donate it.</span>' + conds +
      '<span class="note"><i class="ti ti-ban"></i>Damaged, broken or stained items cannot be listed.</span></div></div>' +
      '<div class="wiz-foot"><button id="nextBtn" class="btn' + (ok ? '' : ' disabled') + '" data-action="next-handover" aria-disabled="' + !ok + '"><i class="ti ti-arrow-right"></i><span>' + nextLabel() + '</span></button></div>';
  }
  function step3HTML() {
    var d = state.draft;
    var pins = POINTS.map(function (p, i) { return '<div class="pin" style="left:' + p.x + ';top:' + p.y + ';--d:' + (150 + i * 200) + 'ms"><div><span>' + (i + 1) + '</span></div></div>'; }).join('');
    var pts = POINTS.map(function (p, i) { return '<button class="point' + (d.point === i ? ' on' : '') + '" data-action="point" data-i="' + i + '"><b>' + (i + 1) + '</b>' + esc(p.name) + ' · ' + p.dist + (d.point === i ? '<i class="ti ti-check"></i>' : '') + '</button>'; }).join('');
    var dates = DATES.map(function (x, i) { return '<button class="opt' + (d.date === i ? ' on' : '') + '" data-action="date" data-i="' + i + '">' + x + '</button>'; }).join('');
    var slots = SLOTS.map(function (x, i) { return '<button class="opt sm' + (d.slot === i ? ' on soft' : '') + '" data-action="slot" data-i="' + i + '">' + x + '</button>'; }).join('');
    return wizHead(3, 'give-details', 'How should it reach the NGO?') +
      '<div class="wiz-body" style="padding:16px;gap:12px">' +
      '<div class="hand' + (d.hand === 'drop' ? ' on' : '') + '"><button class="hand-btn" data-action="hand" data-hand="drop"><div class="hand-ic"><i class="ti ti-map-pin"></i></div><span style="display:flex;flex-direction:column;gap:2px"><span class="hand-title">Drop off</span><span class="small">Leave it at a PassOn point near you</span></span></button>' +
      (d.hand === 'drop' ? '<div class="hand-body"><div class="map"><span class="lbl">map · Bandra West</span>' + pins + '</div><div class="points">' + pts + '</div></div>' : '') + '</div>' +
      '<div class="hand' + (d.hand === 'pick' ? ' on' : '') + '"><button class="hand-btn" data-action="hand" data-hand="pick"><div class="hand-ic"><i class="ti ti-truck"></i></div><span style="display:flex;flex-direction:column;gap:2px"><span class="hand-title">Pickup</span><span class="small">A volunteer collects from your door</span></span></button>' +
      (d.hand === 'pick' ? '<div class="hand-body" style="gap:12px"><span class="lab"><i class="ti ti-calendar"></i>Date</span><div class="opts">' + dates + '</div><span class="lab"><i class="ti ti-clock"></i>Time slot</span><div class="opts">' + slots + '</div></div>' : '') + '</div></div>' +
      '<div class="wiz-foot" style="background:transparent"><button class="btn" data-action="post"><i class="ti ti-send"></i>Post item</button></div>';
  }
  function postedHTML() {
    var l = db.listings.filter(function (x) { return x.id === state.justPosted; })[0] || activeMine()[0];
    if (!l) { location.hash = 'home'; return ''; }
    return '<div style="height:100%;display:flex;flex-direction:column;padding:24px 16px;gap:20px">' +
      '<div class="done-hero"><div class="done-check"><i class="ti ti-check"></i></div><div class="h-poppins" style="font-size:26px">Your item is listed</div><div class="sub" style="max-width:280px;text-wrap:pretty">Verified NGOs in Bandra &amp; BKC can see it now. We\'ll tell you the moment it\'s claimed.</div></div>' +
      '<div class="big-card"><div class="big-photo"' + photoStyle(l) + '>' + photoLabel(l) + countdownHTML(l, 'abs') + '</div>' +
      '<div style="padding:14px;display:flex;flex-direction:column;gap:14px"><div style="display:flex;flex-direction:column;gap:2px"><span style="font-weight:600;font-size:17px">' + esc(l.title) + '</span><span class="small">' + esc(l.cat + ' · ' + l.cond + ' · ' + handoverText(l)) + '</span></div>' + trailHTML(1, true) + '</div></div>' +
      '<div style="margin-top:auto;display:flex;flex-direction:column;gap:10px"><a href="#home" class="btn"><i class="ti ti-home"></i>Back to Home</a><a href="#listing/' + l.id + '" class="btn-outline"><i class="ti ti-route"></i>View status trail</a></div></div>';
  }
  function listingsHTML() {
    var mine = myListings().slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
    var cards = mine.map(function (l, i) {
      return '<a href="#listing/' + l.id + '" class="card rise" style="animation-delay:' + (120 + i * 70) + 'ms;opacity:' + (isExpired(l) ? '.6' : '1') + '">' +
        '<div class="row" style="gap:12px"><div class="thumb"' + photoStyle(l) + '>' + (l.photo ? '' : 'photo') + '</div><div class="grow" style="display:flex;flex-direction:column;gap:2px"><span class="card-title">' + esc(l.title) + '</span><span class="card-status">' + esc(statusText(l)) + '</span></div></div>' +
        trailHTML(l.stage, false) + '</a>';
    }).join('');
    if (!mine.length) cards = '<div class="empty" style="padding:32px 16px"><div class="ic"><i class="ti ti-list-check"></i></div><span class="section-title">No listings yet</span><span class="sub">Items you give will show up here with their status.</span><a href="#give" class="btn" style="max-width:240px"><i class="ti ti-gift"></i>Give an item</a></div>';
    return topbarHTML() + '<div style="padding:8px 16px 112px" class="col"><div class="title">Your listings</div><div class="small">Every item you have passed on, with its status.</div>' + cards + '</div>';
  }
  function detailHTML(id) {
    var l = db.listings.filter(function (x) { return x.id === id; })[0];
    if (!l) return '<div class="empty"><span class="section-title">Listing not found</span><a href="#home" class="btn-outline">Back to Home</a></div>';
    var exp = isExpired(l);
    var steps = [
      ['Listed', 'Visible to verified NGOs in Bandra and BKC'],
      ['Claimed', l.stage >= 2 ? 'By ' + l.claimedBy : 'Waiting for an organisation to claim it'],
      ['Received', l.stage === 3 ? l.claimedBy + ' has your item' : 'Confirmed by the organisation after handover']
    ];
    var rows = steps.map(function (s, i) {
      var done = i < l.stage;
      return '<div class="drow"><i class="ti ' + (done ? 'ti-circle-check' : 'ti-point') + '"' + (done ? '' : ' style="color:#B9B2A7"') + '></i><span><b style="display:block;font-size:16px;font-weight:600;color:var(--text)">' + s[0] + '</b>' + esc(s[1]) + '</span></div>';
    }).join('');
    return '<div class="wiz-head" style="padding-bottom:0"><div class="wiz-top"><button class="back" data-action="back"><i class="ti ti-arrow-left"></i>Back</button>' + (l.stage === 1 && !exp ? countdownHTML(l) : '') + '</div></div>' +
      '<div class="col" style="padding:12px 16px 32px;gap:16px">' +
      '<div class="big-card" style="animation-delay:0ms"><div class="big-photo"' + photoStyle(l) + '>' + photoLabel(l) + '<span class="badge"><i class="ti ' + catIcon(l.cat) + '"></i>' + esc(l.cat) + '</span></div>' +
      '<div style="padding:14px;display:flex;flex-direction:column;gap:14px"><div style="display:flex;flex-direction:column;gap:2px"><span class="h-poppins" style="font-size:20px">' + esc(l.title) + '</span><span class="small">' + esc(statusText(l)) + '</span></div>' + trailHTML(l.stage, true) + '</div></div>' +
      '<div class="big-card" style="animation-delay:450ms;padding:14px;display:flex;flex-direction:column;gap:12px">' + rows + '</div>' +
      '<div class="counters" style="padding:0"><div class="counter"><i class="ti ti-weight"></i><span class="num">' + l.kg + ' kg</span><span class="lbl">Estimated weight saved</span></div>' +
      '<div class="counter"><i class="ti ' + (l.hand === 'drop' ? 'ti-map-pin' : 'ti-truck') + '"></i><span class="num" style="font-size:18px;line-height:1.3">' + (l.hand === 'drop' ? 'Drop off' : 'Pickup') + '</span><span class="lbl">' + esc(l.hand === 'drop' ? l.where : l.when) + '</span></div></div>' +
      '<span class="note"><i class="ti ti-leaf"></i>Weight uses the PassOn average for ' + esc(l.cat.toLowerCase()) + ' (' + KG[l.cat] + ' kg per item).</span></div>';
  }
  function accountHTML() {
    var donor = db.role === 'donor';
    var mine = myListings().length, claimed = db.listings.filter(function (l) { return l.stage >= 2 && l.claimedBy === ORG_NAME; }).length;
    return topbarHTML() + '<div class="col" style="padding:8px 16px 112px;gap:14px">' +
      '<div class="title">Account</div><div class="small">Choose how you use PassOn. Only verified organisations can see and claim listings.</div>' +
      '<div class="role-card' + (donor ? ' on' : '') + '"><div class="role-head"><div class="hand-ic"><i class="ti ti-user"></i></div><div><div class="hand-title">Donor</div><div class="small">Riya · Bandra West · ' + mine + ' listings</div></div></div>' +
      '<div class="role-list"><span><i class="ti ti-circle-check"></i>List items in under 30 seconds</span><span><i class="ti ti-circle-check"></i>Track every donation on a status trail</span><span><i class="ti ti-circle-check"></i>See what NGOs need right now</span><span class="no"><i class="ti ti-ban"></i>No browsing or claiming other listings</span></div>' +
      (donor ? '<div class="tag" style="align-self:flex-start"><i class="ti ti-check"></i>Signed in as donor</div>' : '<button class="btn-outline" data-action="switch" data-role="donor"><i class="ti ti-switch-horizontal"></i>Switch to donor</button>') + '</div>' +
      '<div class="role-card' + (!donor ? ' on' : '') + '"><div class="role-head"><div class="hand-ic"><i class="ti ti-building-community"></i></div><div><div class="hand-title">Organisation</div><div class="small">' + ORG_NAME + ' · verified NGO · ' + claimed + ' claimed</div></div></div>' +
      '<div class="role-list"><span><i class="ti ti-circle-check"></i>See every unclaimed listing nearby</span><span><i class="ti ti-circle-check"></i>Claim items with full handover details</span><span><i class="ti ti-circle-check"></i>Post what your community needs</span><span class="no"><i class="ti ti-ban"></i>No chat, no payments</span></div>' +
      (!donor ? '<div class="tag" style="align-self:flex-start"><i class="ti ti-check"></i>Signed in as ' + ORG_NAME + '</div>' : '<button class="btn-outline" data-action="switch" data-role="org"><i class="ti ti-switch-horizontal"></i>Switch to organisation</button>') + '</div>' +
      '<div class="demo"><span class="section-title" style="font-size:16px">Testing tools</span><span class="small">For checking the expiry rule and starting fresh.</span>' +
      '<button class="btn-small" data-action="test-listing"><i class="ti ti-hourglass"></i>Add a listing that expires in 2 minutes</button>' +
      '<button class="btn-small" data-action="reset"><i class="ti ti-trash"></i>Reset demo data</button></div></div>';
  }
  function feedHTML() {
    var items = feedListings().filter(function (l) { return state.filter === 'All' || l.cat === state.filter; });
    var filters = [['All', 'ti-layout-grid']].concat(CATS).map(function (f) { return '<button class="filter' + (state.filter === f[0] ? ' on' : '') + '" data-action="filter" data-f="' + f[0] + '"><i class="ti ' + f[1] + '"></i>' + f[0] + '</button>'; }).join('');
    var cards = items.map(function (l, i) {
      var open = state.claimedOpen === l.id, claimed = l.stage >= 2;
      return '<div class="fcard" data-card="' + l.id + '" style="--d:' + (120 + i * 90) + 'ms"><div class="fphoto"' + photoStyle(l) + '>' + photoLabel(l) + '<span class="badge"><i class="ti ' + catIcon(l.cat) + '"></i>' + esc(l.cat) + '</span>' + countdownHTML(l, 'abs') + '</div>' +
        '<div class="fbody"><span class="h-poppins" style="font-size:17px">' + esc(l.title) + '</span>' +
        '<div class="meta"><span><i class="ti ti-map-pin"></i>' + esc(l.dist) + ' away</span><span><i class="ti ti-weight"></i>' + l.kg + ' kg est.</span><span class="tag' + (l.cond === 'Minor wear' ? ' wear' : '') + '">' + esc(l.cond) + '</span></div>' +
        '<button class="btn' + (claimed ? '' : '') + '" style="height:48px;font-size:16px;' + (claimed ? 'background:var(--tint);color:var(--green-dark)' : '') + '" data-action="claim" data-id="' + l.id + '"><i class="ti ' + (claimed ? 'ti-circle-check' : 'ti-hand-grab') + '"></i>' + (claimed ? 'Claimed · ' + (open ? 'hide' : 'show') + ' details' : 'Claim') + '</button>' +
        '<div class="details' + (open ? ' open' : '') + '"><div><div class="details-in">' +
        '<div class="drow"><i class="ti ' + (l.hand === 'drop' ? 'ti-map-pin' : 'ti-truck') + '"></i><span><b>' + (l.hand === 'drop' ? 'Drop off point' : 'Pickup address') + '</b>' + esc(l.where) + '</span></div>' +
        '<div class="drow"><i class="ti ' + (l.hand === 'drop' ? 'ti-clock' : 'ti-calendar') + '"></i><span><b>' + (l.hand === 'drop' ? 'Open hours' : 'Pickup slot') + '</b>' + esc(l.when) + '</span></div>' +
        '<button class="btn-tint" data-action="received" data-id="' + l.id + '"><i class="ti ti-heart-handshake"></i>Mark as received</button></div></div></div></div></div>';
    }).join('');
    if (!items.length) cards = '<div class="empty"><div class="ic"><i class="ti ti-inbox"></i></div><span class="section-title">Nothing here right now</span><span class="sub">No donor has listed anything yet. When someone in Bandra or BKC gives an item, it appears here to claim.</span></div>';
    var count = items.length;
    return topbarHTML() +
      '<div style="padding:8px 16px 4px;display:flex;flex-direction:column;gap:4px"><div class="title">Listings near ' + ORG_NAME + '</div><div class="small" id="feedCount">' + count + ' item' + (count === 1 ? '' : 's') + ' waiting · claim before they expire</div></div>' +
      '<div class="filters">' + filters + '</div><div class="feed">' + cards + '</div>';
  }
  function needsHTML() {
    var n = state.need;
    var types = NEED_TYPES.map(function (t, i) { return '<button class="opt' + (n.type === i ? ' on' : '') + '" style="font-size:14px" data-action="need-type" data-i="' + i + '">' + t + '</button>'; }).join('');
    var dls = DEADLINES.map(function (d, i) { return '<button class="opt sm' + (n.deadline === i ? ' on soft' : '') + '" data-action="need-deadline" data-i="' + i + '">' + d[0] + '</button>'; }).join('');
    var list = db.needs.map(function (x, i) {
      return '<div class="need-row" style="--d:' + (i * 80) + 'ms"><span class="need-org"><i class="ti ti-rosette-discount-check"></i>' + esc(x.org) + '</span><span style="font-weight:600;font-size:16px">' + esc(x.need) + '</span><span class="small">' + esc(x.detail) + '</span></div>';
    }).join('');
    if (!db.needs.length) list = '<span class="small">Nothing posted yet. Your first need will appear here and on every donor\'s home screen.</span>';
    return topbarHTML() + '<div class="col" style="padding:8px 16px 112px;gap:16px">' +
      '<div class="title">Post a need</div><div class="small">Tell donors what your community needs. It shows on their home screen.</div>' +
      '<div class="col" style="gap:10px"><span class="lab"><i class="ti ti-clipboard-list"></i>Item type</span><div class="opts" style="grid-template-columns:1fr 1fr">' + types + '</div></div>' +
      '<div class="col" style="gap:10px"><span class="lab"><i class="ti ti-package"></i>Quantity</span><div class="stepper"><button data-action="qty" data-d="-5" aria-label="Fewer"><i class="ti ti-minus"></i></button><span class="q">' + n.qty + '</span><button data-action="qty" data-d="5" aria-label="More"><i class="ti ti-plus"></i></button><span class="small">pieces</span></div></div>' +
      '<div class="col" style="gap:10px"><span class="lab"><i class="ti ti-calendar"></i>Deadline</span><div class="opts">' + dls + '</div></div>' +
      '<button class="btn" data-action="post-need"><i class="ti ti-send"></i>Post need</button>' +
      '<div class="col" style="gap:10px;padding-top:12px"><span class="section-title">On the needs board</span><div class="need-list">' + list + '</div></div></div>';
  }

  // ---------- after render: animations and timers ----------
  function afterRender(r) {
    if (r === 'home') {
      var start = performance.now(), els = $$('[data-count]');
      (function step(t) {
        var p = Math.min(1, (t - start) / 1600), e = 1 - Math.pow(1 - p, 3);
        els.forEach(function (el) { el.textContent = num(Math.round(+el.getAttribute('data-count') * e)); });
        if (p < 1 && $('[data-count]')) requestAnimationFrame(step);
      })(start);
      state.justPosted = null;
    }
    if (r === 'give-details' && state.pulseNext) {
      state.pulseNext = false;
      var b = $('#nextBtn'); if (b) b.classList.add('pulse');
    }
  }

  function tick() {
    var r = route();
    $$('[data-countdown]').forEach(function (el) {
      var l = db.listings.filter(function (x) { return x.id === el.getAttribute('data-countdown'); })[0];
      if (!l) return;
      var s = left(l);
      el.lastChild.nodeValue = fmt(s);
      el.classList.toggle('amber', s < 7200);
    });
    if (r === 'feed') {
      feedListings().forEach(function (l) {
        if (l.stage === 1 && left(l) <= 0 && !state.fading[l.id]) {
          state.fading[l.id] = true;
          var card = $('[data-card="' + l.id + '"]');
          if (card) card.classList.add('fade');
          setTimeout(function () { state.removed[l.id] = true; if (route() === 'feed') render(); }, 650);
        }
      });
    }
  }
  state.fading = {};
  setInterval(tick, 1000);

  // ---------- photo upload ----------
  var input = $('#photoInput');
  input.addEventListener('change', function () {
    var f = input.files && input.files[0];
    if (!f) return;
    state.draft.status = 'loading';
    rerenderPhoto();
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 720, s = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        state.draft.photo = c.toDataURL('image/jpeg', 0.8);
        var before = !missing().length;
        setTimeout(function () { state.draft.status = 'done'; rerenderPhoto(); if (!before && !missing().length) unlock(); }, 900);
      };
      img.onerror = function () { state.draft.status = 'none'; rerenderPhoto(); toast('That file is not a photo. Try again.', 'ti-ban'); };
      img.src = reader.result;
    };
    reader.readAsDataURL(f);
    input.value = '';
  });
  function rerenderPhoto() {
    var r = route();
    if (r === 'give' || r === 'give-details') render();
  }
  function unlock() {
    var b = $('#nextBtn');
    if (b) { b.classList.remove('disabled'); b.setAttribute('aria-disabled', 'false'); b.querySelector('span').textContent = nextLabel(); b.classList.remove('pulse'); void b.offsetWidth; b.classList.add('pulse'); }
  }

  // ---------- actions ----------
  function confetti() {
    var cols = ['#2E7D32', '#FAF7F2', '#66BB6A', '#E8F5E9', '#1E5E22'], wrap = document.createElement('div');
    wrap.className = 'confetti';
    for (var i = 0; i < 36; i++) {
      var a = (Math.PI * 2 * i) / 36 + (i % 3) * 0.2, rr = 90 + (i * 37) % 120, s = document.createElement('span');
      s.style.cssText = 'width:' + (i % 2 ? 8 : 6) + 'px;height:' + (i % 2 ? 12 : 6) + 'px;border-radius:' + (i % 3 ? 2 : 6) + 'px;background:' + cols[i % 5] + ';--dx:' + (Math.cos(a) * rr) + 'px;--dy:' + (Math.sin(a) * rr - 120) + 'px;--r:' + ((i * 47) % 360) + 'deg';
      wrap.appendChild(s);
    }
    $('#app').appendChild(wrap);
    setTimeout(function () { wrap.remove(); }, 1000);
  }

  function postItem() {
    var d = state.draft;
    if (missing().length) { toast('Add a photo, category and condition first.', 'ti-ban'); go('give-details'); return; }
    var p = POINTS[d.point];
    var l = {
      id: 'l' + Date.now(), title: d.cat + ' donation', cat: d.cat, cond: d.cond, count: 1, kg: KG[d.cat], owner: 'me', stage: 1,
      photo: d.photo, hand: d.hand,
      where: d.hand === 'drop' ? p.name : 'Bandra West (your address)',
      when: d.hand === 'drop' ? p.when : DATES_LONG[d.date] + ', ' + SLOTS[d.slot],
      dist: d.hand === 'drop' ? p.dist : '1.0 km',
      createdAt: Date.now(), expiresAt: Date.now() + HOURS_TO_CLAIM * 3600000
    };
    db.listings.unshift(l); save();
    state.justPosted = l.id; state.draft = freshDraft();
    confetti();
    var btn = $('[data-action="post"]'); if (btn) { btn.innerHTML = '<i class="ti ti-circle-check"></i>Posted'; btn.disabled = true; }
    setTimeout(function () { go('posted'); }, 850);
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var a = el.getAttribute('data-action'), d = state.draft;
    if (a === 'switch') { db.role = el.getAttribute('data-role'); save(); state.claimedOpen = null; go(db.role === 'donor' ? 'home' : 'feed'); toast(db.role === 'donor' ? 'Now using PassOn as a donor' : 'Now using PassOn as ' + ORG_NAME, 'ti-switch-horizontal'); }
    else if (a === 'donate-need') { state.draft = freshDraft(); state.draft.cat = el.getAttribute('data-cat') || null; go('give'); }
    else if (a === 'pick-photo') { input.click(); }
    else if (a === 'retake') { d.photo = null; d.status = 'none'; render(); }
    else if (a === 'cat') { var before = !missing().length; d.cat = el.getAttribute('data-cat'); render(); if (!before && !missing().length) unlock(); }
    else if (a === 'cond') { var b2 = !missing().length; d.cond = el.getAttribute('data-cond'); render(); if (!b2 && !missing().length) unlock(); }
    else if (a === 'next-handover') { if (missing().length) { toast('Please ' + nextLabel().toLowerCase() + ' before you continue.', 'ti-ban'); return; } go('give-handover'); }
    else if (a === 'hand') { d.hand = el.getAttribute('data-hand'); render(); }
    else if (a === 'point') { d.point = +el.getAttribute('data-i'); render(); }
    else if (a === 'date') { d.date = +el.getAttribute('data-i'); render(); }
    else if (a === 'slot') { d.slot = +el.getAttribute('data-i'); render(); }
    else if (a === 'post') { postItem(); }
    else if (a === 'back') { if (history.length > 1) history.back(); else go(db.role === 'donor' ? 'home' : 'feed'); }
    else if (a === 'filter') { state.filter = el.getAttribute('data-f'); render(); }
    else if (a === 'claim') {
      var id = el.getAttribute('data-id'), l = db.listings.filter(function (x) { return x.id === id; })[0];
      if (!l) return;
      if (l.stage === 1) { l.stage = 2; l.claimedBy = ORG_NAME; save(); state.claimedOpen = id; render(); toast('Claimed. Handover details are below.', 'ti-hand-grab'); }
      else { state.claimedOpen = state.claimedOpen === id ? null : id; render(); }
    }
    else if (a === 'received') {
      var id2 = el.getAttribute('data-id'), l2 = db.listings.filter(function (x) { return x.id === id2; })[0];
      if (l2) { l2.stage = 3; save(); state.claimedOpen = null; render(); toast('Marked as received. The donor can see it now.', 'ti-heart-handshake'); }
    }
    else if (a === 'need-type') { state.need.type = +el.getAttribute('data-i'); render(); }
    else if (a === 'need-deadline') { state.need.deadline = +el.getAttribute('data-i'); render(); }
    else if (a === 'qty') { state.need.qty = Math.max(5, state.need.qty + (+el.getAttribute('data-d'))); render(); }
    else if (a === 'post-need') {
      var n = state.need, dl = new Date(Date.now() + DEADLINES[n.deadline][1] * 86400000);
      var by = dl.getDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][dl.getMonth()];
      db.needs.unshift({ id: 'n' + Date.now(), org: ORG_NAME, need: NEED_TYPES[n.type], detail: n.qty + ' pieces · by ' + by, photoLabel: 'photo · ' + NEED_TYPES[n.type].toLowerCase() });
      save(); state.need = { type: 0, qty: 20, deadline: 1 }; render(); toast('Posted. Donors can see this need now.');
    }
    else if (a === 'test-listing') {
      db.listings.unshift({ id: 't' + Date.now(), title: 'Test listing', cat: 'Books', cond: 'Clean and usable', count: 1, kg: 0.3, owner: 'other', stage: 1, hand: 'drop', where: 'Carter Road promenade', when: 'Open daily, 8 am to 8 pm', dist: '0.6 km', photoLabel: 'photo · test item', createdAt: Date.now(), expiresAt: Date.now() + 120000 });
      save(); toast('Added. Open the organisation feed to watch it expire.', 'ti-hourglass');
    }
    else if (a === 'reset') { localStorage.removeItem(KEY); state.removed = {}; state.fading = {}; state.filter = 'All'; state.claimedOpen = null; load(); render(); toast('All data cleared.', 'ti-refresh'); }
  });

  // Keep a listing's step 1 photo tap working with the keyboard too
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('upload')) input.click();
  });

  // ---------- start ----------
  load();
  render();
})();
