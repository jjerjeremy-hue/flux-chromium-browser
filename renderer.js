const $ = s => document.querySelector(s);
let state = { tabs: [], activeId: null, bookmarks: [], settings: {}, groups: [], splitIds: [] };
let downloads = [];
let assistantOpen = false;

function toast(message) {
  const el = $('#toast'); el.textContent = message; el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2400);
}
function render() {
  const root = $('#tabs'); root.innerHTML = '';
  for (const tab of state.tabs) {
    const el = document.createElement('div');
    el.className = 'tab' + (tab.id === state.activeId ? ' active' : '');
    if (tab.groupColor) { el.dataset.groupColor = 'true'; el.style.setProperty('--group-color', tab.groupColor); }
    el.innerHTML = '<span class="tab-glyph"></span><span class="tab-name"></span><button class="tab-close" title="Close tab">×</button>';
    el.querySelector('.tab-glyph').textContent = tab.isPrivate ? '◐' : '◈';
    const group = (state.groups || []).find(x => x.id === tab.groupId);
    if (group) { el.title = group.name; el.querySelector('.tab-glyph').style.color = group.color; const badge = document.createElement('span'); badge.textContent = group.name; badge.style.cssText = `max-width:58px;overflow:hidden;text-overflow:ellipsis;color:${group.color};font-size:9px;border:1px solid ${group.color}55;border-radius:5px;padding:2px 4px`; el.insertBefore(badge, el.querySelector('.tab-name')); }
    el.querySelector('.tab-name').textContent = (tab.loading ? 'Loading…' : (tab.title || 'Flux Home')) + (tab.isPrivate ? ' · Private' : '');
    el.onclick = e => e.target.closest('.tab-close') ? window.flux.closeTab(tab.id) : window.flux.activate(tab.id);
    root.appendChild(el);
  }
  const tab = state.tabs.find(x => x.id === state.activeId);
  $('#address').value = tab?.url || '';
  $('#page-name').textContent = tab?.title || 'Flux Home';
  if (state.profile) {
    $('.profile-title').textContent = state.profile.name;
    $('.profile-sub').textContent = state.syncConfigured ? 'Sync enabled · this device' : 'Local profile';
    $('.avatar').textContent = (state.profile.name || 'F').slice(0, 1).toUpperCase();
  }
  document.body.classList.toggle('vertical-tabs', !!state.settings.verticalTabs);
  $('#vertical-tabs-button').classList.toggle('active', !!state.settings.verticalTabs);
  $('#split-view-button').classList.toggle('active', (state.splitIds || []).length === 2);
  $('#reader-button').classList.toggle('reader-active', !!state.tabs.find(x => x.id === state.activeId)?.readerOn);
  $('#lock').textContent = tab?.url ? '◉' : '⌕';
  $('#back').disabled = !tab?.canGoBack;
  $('#forward').disabled = !tab?.canGoForward;
  $('#bookmark').textContent = state.bookmarks.some(b => b.url === tab?.url && tab?.url) ? '★' : '☆';
  renderPinned();
  if (assistantOpen) setAssistantHeader(true);
}
function renderPinned() {
  const list = $('#pinned'); list.innerHTML = '';
  for (const b of state.bookmarks.slice(0, 8)) {
    const el = document.createElement('button'); el.className = 'side-link';
    el.innerHTML = '<span class="side-icon">☆</span><span></span>';
    el.querySelector('span:last-child').textContent = b.title || b.url; el.title = b.url;
    el.onclick = () => window.flux.openPage(b.url); list.appendChild(el);
  }
  $('#pin-empty').classList.toggle('hidden', state.bookmarks.length > 0);
}
function setAssistantHeader(open) {
  $('#page-name').textContent = open ? 'AI assistant' : (state.tabs.find(t => t.id === state.activeId)?.title || 'Flux Home');
  $('#content-hint').textContent = open ? 'Flux AI' : 'Chromium';
  $('#ai-open').classList.toggle('hidden', !open);
  document.querySelector('[data-panel="ai"]').classList.toggle('selected', open);
}
window.flux.onState(s => { state = { ...state, ...s }; render(); });

function openTabSearch() { $('#tab-search-overlay').classList.add('show'); $('#tab-search-input').value = ''; drawTabSearch(''); $('#tab-search-input').focus(); }
function closeTabSearch() { $('#tab-search-overlay').classList.remove('show'); }
function drawTabSearch(query) {
  const root = $('#tab-search-results'); root.innerHTML = '';
  const q = String(query || '').trim().toLowerCase();
  const entries = [
    ...state.tabs.map(tab => ({ kind: tab.isPrivate ? 'Private tab' : 'Open tab', title: tab.title || 'Flux Home', url: tab.url, action: () => window.flux.activate(tab.id) })),
    ...(state.bookmarks || []).map(bookmark => ({ kind: 'Bookmark', title: bookmark.title || bookmark.url, url: bookmark.url, action: () => window.flux.openPage(bookmark.url) }))
  ].filter(item => !q || `${item.title} ${item.url} ${item.kind}`.toLowerCase().includes(q));
  if (/^@drive\s+/i.test(query)) {
    const term = query.replace(/^@drive\s+/i, '').trim();
    const drive = document.createElement('button'); drive.className = 'search-result'; drive.innerHTML = '<span></span><small>Google Drive search</small>'; drive.querySelector('span').textContent = term ? `Search Google Drive for “${term}”` : 'Open Google Drive';
    drive.onclick = () => { window.flux.openPage(term ? `@drive ${term}` : 'https://drive.google.com/drive/my-drive'); closeTabSearch(); }; root.appendChild(drive);
  }
  if (!entries.length && !root.childElementCount) { const empty = document.createElement('div'); empty.className = 'search-tip'; empty.textContent = 'No matching tabs or bookmarks.'; root.appendChild(empty); }
  for (const item of entries.slice(0, 30)) { const button = document.createElement('button'); button.className = 'search-result'; button.innerHTML = '<span></span><small></small>'; button.querySelector('span').textContent = `${item.kind} · ${item.title}`; button.querySelector('small').textContent = item.url || 'Flux Home'; button.onclick = () => { item.action(); closeTabSearch(); }; root.appendChild(button); }
}
$('#tab-search-button').onclick = openTabSearch;
$('#tab-search-input').addEventListener('input', e => drawTabSearch(e.target.value));
$('#tab-search-input').addEventListener('keydown', e => { if (e.key === 'Escape') closeTabSearch(); if (e.key === 'Enter') $('#tab-search-results .search-result')?.click(); });
$('#tab-search-overlay').addEventListener('click', e => { if (e.target === $('#tab-search-overlay')) closeTabSearch(); });
$('#group-tab-button').onclick = async () => { const tab = state.tabs.find(x => x.id === state.activeId); if (!tab || tab.isPrivate) { toast('Private tabs cannot be grouped'); return; } const current = state.groups.find(g => g.id === tab.groupId); const name = prompt('Create or join a tab group. Leave blank to remove this tab from its group.', current?.name || ''); if (name === null) return; const result = await window.flux.tabGroup(tab.id, name); toast(result.ok ? (name.trim() ? `Tab added to ${name.trim()}` : 'Tab removed from group') : 'Could not update tab group'); };
$('#split-view-button').onclick = async () => { const active = await window.flux.toggleSplit(); toast(active ? 'Split view enabled' : 'Split view closed'); };
$('#vertical-tabs-button').onclick = async () => { const enabled = await window.flux.setVerticalTabs(!state.settings.verticalTabs); toast(enabled ? 'Vertical tabs enabled' : 'Horizontal tabs enabled'); };
$('#reopen-tab-button').onclick = async () => { const result = await window.flux.reopenTab(); toast(result.ok ? `Reopened ${result.title || 'tab'}` : 'No recently closed tabs'); };
$('#private-tab-button').onclick = async () => { closeDrawer(); await window.flux.newPrivateTab(); toast('Private tab opened. It is not saved to history or restore.'); };
$('#reader-button').onclick = async () => { const enabled = await window.flux.toggleReader(state.activeId); toast(enabled ? 'Immersive reading mode on' : 'Immersive reading mode off'); };

function closeDrawer() {
  $('#drawer').classList.remove('show'); window.flux.panelWidth(assistantOpen ? 390 : 0);
  document.querySelectorAll('.side-action').forEach(x => x.classList.remove('selected'));
}
async function toggleAssistant() {
  if (!assistantOpen) closeDrawer();
  assistantOpen = await window.flux.aiToggle();
  setAssistantHeader(assistantOpen);
}
async function showPanel(name) {
  const drawer = $('#drawer'), body = $('#drawer-body');
  if (name === 'ai') { await toggleAssistant(); return; }
  if (assistantOpen) { await window.flux.aiToggle(); assistantOpen = false; setAssistantHeader(false); }
  if (name === 'home') { closeDrawer(); window.flux.newTab(); return; }
  drawer.classList.add('show'); window.flux.panelWidth(Math.min(385, window.innerWidth - 250));
  $('#drawer-title').textContent = { bookmarks: 'Bookmarks', history: 'History', downloads: 'Downloads', media: 'Media controls', settings: 'Settings' }[name] || name;
  document.querySelectorAll('.side-action').forEach(x => x.classList.toggle('selected', x.dataset.panel === name));
  body.innerHTML = '';
  if (name === 'bookmarks' || name === 'history') {
    const list = await window.flux.getPages(name);
    if (!list.length) { body.innerHTML = '<div class="row-sub">Nothing here yet.</div>'; return; }
    for (const p of list) {
      const item = document.createElement('div'); item.className = 'drawer-item'; item.innerHTML = '<span></span><small></small>';
      item.querySelector('span').textContent = p.title || p.url; item.querySelector('small').textContent = p.url;
      item.onclick = () => { window.flux.openPage(p.url); closeDrawer(); }; body.appendChild(item);
    }
    return;
  }
  if (name === 'downloads') {
    if (!downloads.length) { body.innerHTML = '<div class="row-sub">Downloads you save will appear here.</div>'; return; }
    for (const d of downloads) {
      const x = document.createElement('div'); x.className = 'drawer-item';
      const title = document.createElement('div'); title.textContent = d.name;
      const status = document.createElement('small'); status.textContent = d.state === 'completed' ? 'Download complete' : `Download ${d.state}`;
      x.append(title, status);
      if (d.state === 'completed' && d.path) {
        const actions = document.createElement('div'); actions.style.cssText = 'display:flex;gap:6px;margin-top:8px';
        for (const [label, action] of [['Open', 'open'], ['Show in folder', 'show']]) {
          const button = document.createElement('button'); button.className = 'btn btn-secondary'; button.textContent = label;
          button.onclick = async e => { e.stopPropagation(); const result = await window.flux.downloadAction(d.path, action); if (!result.ok) toast(result.message || 'Could not access this download'); };
          actions.appendChild(button);
        }
        x.appendChild(actions);
      }
      body.appendChild(x);
    }
    return;
  }
  if (name === 'media') {
    body.innerHTML = '<div class="row"><div class="row-sub">Control audio and video playing in any open Flux tab. Refresh to update the list.</div><button class="btn btn-secondary" id="refresh-media" style="margin-top:10px">Refresh media</button></div><div id="media-list"></div>';
    const draw = async () => {
      const list = $('#media-list'); list.innerHTML = '';
      const items = await window.flux.mediaList();
      if (!items.length) { list.innerHTML = '<div class="row-sub" style="padding:12px 0">No media is playing or loaded in open tabs.</div>'; return; }
      for (const media of items) {
        const row = document.createElement('div'); row.className = 'drawer-item';
        const title = document.createElement('span'); title.textContent = media.title;
        const sub = document.createElement('small'); sub.textContent = `${media.tabTitle}${media.private ? ' · Private' : ''}`;
        const actions = document.createElement('span'); actions.style.cssText = 'display:flex;gap:6px;margin-top:8px';
        const play = document.createElement('button'); play.className = 'btn btn-secondary'; play.textContent = media.paused ? 'Play' : 'Pause'; play.onclick = async e => { e.stopPropagation(); await window.flux.mediaAction(media.tabId, media.index, media.paused ? 'play' : 'pause'); draw(); };
        actions.appendChild(play);
        if (media.video) { const pip = document.createElement('button'); pip.className = 'btn btn-secondary'; pip.textContent = 'Picture-in-picture'; pip.onclick = e => { e.stopPropagation(); window.flux.mediaAction(media.tabId, media.index, 'pip'); }; actions.appendChild(pip); }
        row.append(title, sub, actions); list.appendChild(row);
      }
    };
    $('#refresh-media').onclick = draw; await draw(); return;
  }
  if (name === 'profile') {
    const data = await window.flux.profiles();
    body.innerHTML = '<div class="row"><div class="row-title">Browser profiles</div><div class="row-sub">Each profile has separate cookies, sign-ins, bookmarks, history, settings, and open tabs.</div><div id="profile-list" style="display:grid;gap:7px;margin-top:10px"></div></div><div class="row"><div class="row-title">Create a profile</div><input class="input" id="new-profile-name" placeholder="Profile name"><button class="btn btn-primary" id="create-profile">Create profile</button></div><div class="row"><div class="row-title">Sync this profile</div><div class="row-sub">Connect a WebDAV sync file URL to keep bookmarks, history, and browser settings in sync across Flux installations. Site cookies, passwords, and sign-ins stay on this device.</div><input class="input" id="sync-url" placeholder="https://cloud.example/dav/flux-profile.json"><input class="input" id="sync-user" placeholder="WebDAV username (optional)"><input class="input" id="sync-pass" type="password" placeholder="WebDAV password (saved securely)"><div style="display:flex;gap:7px"><button class="btn btn-secondary" id="save-sync">Save sync settings</button><button class="btn btn-primary" id="sync-now">Sync now</button></div><div id="sync-status" class="row-sub" style="margin-top:9px"></div></div>';
    const list = $('#profile-list');
    for (const profile of data.profiles) {
      const button = document.createElement('button');
      button.className = 'btn ' + (profile.active ? 'btn-primary' : 'btn-secondary');
      button.textContent = (profile.active ? '✓  ' : '') + profile.name + (profile.syncLastAt ? ' · synced' : '');
      button.onclick = async () => { if (profile.active) return; const result = await window.flux.switchProfile(profile.id); if (result.ok) { toast('Switched to ' + profile.name); showPanel('profile'); } };
      list.appendChild(button);
    }
    $('#sync-url').value = data.current.syncUrl || '';
    $('#sync-user').value = data.current.syncUsername || '';
    $('#sync-status').textContent = state.syncLastAt ? 'Last synced ' + new Date(state.syncLastAt).toLocaleString() : (state.syncConfigured ? 'Ready to sync' : 'Not connected');
    $('#create-profile').onclick = async () => { const name = $('#new-profile-name').value.trim(); if (!name) { toast('Enter a profile name'); return; } const result = await window.flux.createProfile(name); if (result.ok) { toast('Profile created'); showPanel('profile'); } else toast(result.message); };
    $('#save-sync').onclick = async () => { const result = await window.flux.saveSync({ url: $('#sync-url').value.trim(), username: $('#sync-user').value, password: $('#sync-pass').value }); if (!result.ok) { toast(result.message); return; } $('#sync-pass').value = ''; $('#sync-status').textContent = 'Sync settings saved securely.'; toast('Sync settings saved'); };
    $('#sync-now').onclick = async () => { const status = $('#sync-status'); status.textContent = 'Syncing…'; const result = await window.flux.syncProfile(); status.textContent = result.ok ? `Synced ${result.bookmarks} bookmarks and ${result.history} history entries.` : result.message; toast(result.ok ? 'Profile synced' : 'Sync failed: ' + result.message); };
    return;
  }
  if (name === 'settings') {
    const st = await window.flux.settings();
    body.innerHTML = `<div class="row"><div class="row-title">Search engine</div><div class="row-sub">Used when you search from the address bar or Flux Home.</div><select class="select" id="search-engine"><option value="https://www.google.com/search?q=%s">Flux Search (Google)</option><option value="https://www.bing.com/search?q=%s">Bing</option><option value="https://duckduckgo.com/?q=%s">DuckDuckGo</option></select></div><div class="row"><div class="row-title">New tab page</div><div class="row-sub">Choose Flux Home or set a custom start page.</div><select class="select" id="home-page"><option value="flux://home">Flux Home</option><option value="https://www.google.com">Flux Search homepage</option><option value="custom">Custom URL</option></select><input class="input hidden" id="custom-home" placeholder="https://example.com"><button class="btn btn-primary" id="save-settings">Save settings</button></div><div class="row"><div class="row-title">Import and export</div><div class="row-sub">Merge bookmarks, history, and settings from Chrome or a Flux backup. HTML bookmark files add bookmarks only.</div><div style="display:grid;gap:7px;margin-top:10px"><button class="btn btn-secondary" id="import-chrome-now">Import from Chrome</button><button class="btn btn-secondary" id="import-file-now">Choose an import file…</button><button class="btn btn-secondary" id="export-backup">Export Flux backup…</button></div></div><div class="row"><div class="row-title">Profile data</div><div class="row-sub">Bookmarks and browsing history are stored in this Flux profile on your device.</div><button class="btn btn-secondary" id="clear-data" style="margin-top:10px">Clear browsing data</button></div><div class="row"><div class="row-title">Accessibility</div><div class="row-sub">The toolbar provides full-page zoom controls. High contrast changes page colors for better readability.</div><button class="btn btn-secondary" id="high-contrast" style="margin-top:10px">Toggle high contrast page style</button></div><div class="row"><div class="row-title">Flux AI</div><div class="row-sub">The AI side panel opens ChatGPT in this browser. Sign-in is handled by ChatGPT.</div></div>`;
    $('#high-contrast').textContent = st.highContrast ? 'Turn off high contrast page style' : 'Turn on high contrast page style';
    $('#high-contrast').onclick = async () => { const enabled = await window.flux.setHighContrast(!state.settings.highContrast); $('#high-contrast').textContent = enabled ? 'Turn off high contrast page style' : 'Turn on high contrast page style'; toast(enabled ? 'High contrast enabled' : 'High contrast disabled'); };
    $('#search-engine').value = st.search;
    const choices = ['flux://home', 'https://www.google.com'];
    $('#home-page').value = choices.includes(st.home) ? st.home : 'custom';
    $('#custom-home').value = $('#home-page').value === 'custom' ? st.home : '';
    $('#custom-home').classList.toggle('hidden', $('#home-page').value !== 'custom');
    $('#home-page').onchange = () => $('#custom-home').classList.toggle('hidden', $('#home-page').value !== 'custom');
    $('#save-settings').onclick = async () => {
      const home = $('#home-page').value === 'custom' ? $('#custom-home').value.trim() : $('#home-page').value;
      if (!home) { toast('Enter a home page address'); return; }
      await window.flux.saveSettings({ search: $('#search-engine').value, home }); toast('Settings saved');
    };
    $('#import-chrome-now').onclick = async () => {
      const r = await window.flux.importChrome();
      if (!r.ok) { toast(r.message); return; }
      toast(`Imported ${r.imported.bookmarks} bookmarks and ${r.imported.history} history entries${r.imported.settings ? ' and browser settings' : ''}`);
      showPanel('settings');
    };
    $('#import-file-now').onclick = async () => {
      const r = await window.flux.importFile(); if (r.canceled) return;
      if (!r.ok) { toast('Import failed: ' + r.message); return; }
      toast(`Imported ${r.result.bookmarks} bookmarks and ${r.result.history} history entries${r.result.settings ? ' plus settings' : ''}`);
      showPanel('settings');
    };
    $('#export-backup').onclick = async () => {
      const r = await window.flux.exportBackup(); if (r.canceled) return;
      toast(r.ok ? 'Backup saved: ' + r.file : 'Export failed: ' + r.message);
    };
    $('#clear-data').onclick = async () => {
      if (confirm('Clear bookmarks, history, cookies, and cached site data?')) { await window.flux.clearData(); toast('Browsing data cleared'); showPanel('settings'); }
    };
  }
}

document.querySelectorAll('[data-panel]').forEach(b => b.addEventListener('click', () => showPanel(b.dataset.panel)));
$('#drawer-close').onclick = closeDrawer;
$('#new-tab').onclick = () => { if (assistantOpen) toggleAssistant(); closeDrawer(); window.flux.newTab(); };
$('#back').onclick = () => window.flux.navAction(state.activeId, 'back');
$('#forward').onclick = () => window.flux.navAction(state.activeId, 'forward');
$('#reload').onclick = () => window.flux.navAction(state.activeId, 'reload');
$('#home').onclick = () => window.flux.navAction(state.activeId, 'home');
$('#full').onclick = () => window.flux.fullscreen();
$('#bookmark').onclick = async () => toast((await window.flux.bookmark(state.activeId)) ? 'Bookmark added' : 'Bookmark removed');
$('#save-pdf').onclick = async () => { const result = await window.flux.savePdf(state.activeId); if (result?.ok) toast('PDF saved: ' + result.file); else if (!result?.canceled) toast(result?.message || 'Could not save this page as PDF'); };
$('#address').addEventListener('keydown', e => { if (e.key === 'Enter') { window.flux.navigate(state.activeId, e.target.value); e.target.blur(); } });
$('#address').addEventListener('focus', e => e.target.select());
$('#profile').onclick = () => showPanel('profile');
$('#ai-open').onclick = () => window.flux.openExternal('https://chatgpt.com/');
function showFind() { $('#findbar').classList.add('show'); $('#find-input').focus(); }
$('#find-input').addEventListener('input', e => window.flux.find(e.target.value));
$('#find-close').onclick = () => { $('#findbar').classList.remove('show'); window.flux.stopFind(); };
window.flux.onCommand(cmd => {
  if (cmd === 'focus-address') { $('#address').focus(); $('#address').select(); }
  if (cmd === 'new-tab') window.flux.newTab();
  if (cmd === 'close-tab') window.flux.closeTab(state.activeId);
  if (cmd === 'history') showPanel('history');
  if (cmd === 'bookmarks') showPanel('bookmarks');
  if (cmd === 'downloads') showPanel('downloads');
  if (cmd === 'assistant') toggleAssistant();
  if (cmd === 'bookmark') window.flux.bookmark(state.activeId);
  if (cmd === 'find') showFind();
  if (cmd === 'reload') window.flux.navAction(state.activeId, 'reload');
  if (cmd === 'zoom-in') window.flux.zoom(.5);
  if (cmd === 'zoom-out') window.flux.zoom(-.5);
  if (cmd === 'zoom-reset') window.flux.zoom(0);
  if (cmd === 'reopen-tab') window.flux.reopenTab().then(r => toast(r.ok ? `Reopened ${r.title || 'tab'}` : 'No recently closed tabs'));
  if (cmd === 'search-tabs') openTabSearch();
});
window.flux.onDownload(d => { downloads.unshift(d); toast(d.state === 'completed' ? 'Download complete' : 'Download ' + d.state); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeDrawer(); $('#findbar').classList.remove('show'); window.flux.stopFind(); }
  if (!(e.ctrlKey || e.metaKey)) return; const k = e.key.toLowerCase();
  if (k === 't') { e.preventDefault(); window.flux.newTab(); }
  else if (k === 'w') { e.preventDefault(); window.flux.closeTab(state.activeId); }
  else if (k === 'l') { e.preventDefault(); $('#address').focus(); $('#address').select(); }
  else if (k === 'h') { e.preventDefault(); showPanel('history'); }
  else if (k === 'j') { e.preventDefault(); showPanel('downloads'); }
  else if (k === 'f') { e.preventDefault(); showFind(); }
  else if (k === 'd') { e.preventDefault(); window.flux.bookmark(state.activeId); }
  else if (k === 'r') { e.preventDefault(); window.flux.navAction(state.activeId, 'reload'); }
  else if (k === '+' || k === '=') { e.preventDefault(); window.flux.zoom(.5); }
  else if (k === '-') { e.preventDefault(); window.flux.zoom(-.5); }
  else if (k === '0') { e.preventDefault(); window.flux.zoom(0); }
});
async function setup() {
  const s = await window.flux.setupStatus(); if (s.imported) return;
  $('#setup').style.display = 'flex';
  if (!s.chromeFound) { $('#import-chrome').disabled = true; $('#chrome-status').textContent = 'Chrome was not found on this device. You can start fresh.'; }
  else $('#import-chrome').checked = true;
}
$('#import-chrome').addEventListener('change', () => { if ($('#import-chrome').checked) $('#chrome-status').textContent = 'Chrome bookmarks, browsing history, homepage, and search preference will be imported when you continue.'; });
async function finishSetup() {
  const btn = $('#finish-setup'); btn.disabled = true; btn.textContent = 'Setting up…';
  if ($('#import-chrome').checked) {
    const result = await window.flux.importChrome();
    if (!result.ok) { $('#chrome-status').textContent = result.message; $('#import-chrome').checked = false; btn.disabled = false; btn.textContent = 'Continue to Flux'; return; }
    $('#chrome-status').textContent = `Imported ${result.imported.bookmarks} bookmarks and ${result.imported.history} history entries from ${result.imported.profile}.`;
  }
  const settings = await window.flux.settings(); await window.flux.finishSetup(settings); $('#setup').style.display = 'none'; render();
}
$('#finish-setup').onclick = finishSetup;
$('#skip-setup').onclick = finishSetup;
setup();
