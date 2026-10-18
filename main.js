const { app, BrowserWindow, WebContentsView, ipcMain, session, Menu, dialog, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { DatabaseSync } = require('node:sqlite');
const { pathToFileURL } = require('url');

app.setName('Flux');
let win;
let tabs = [];
let activeId = null;
let nextId = 1;
let recentlyClosed = [];
let splitIds = [];
let tabGroups = [];
let panelWidth = 0;
let aiView = null;
let aiOpen = false;
let storePath;
let profileIndexPath;
let profileIndex = { activeProfileId: 'default', profiles: [{ id: 'default', name: 'Default', color: '#9d8cff' }] };
let attachedDownloadSessions = new WeakSet();
let permissionSessions = new WeakSet();
function profileMeta() { return profileIndex.profiles.find(p => p.id === profileIndex.activeProfileId) || profileIndex.profiles[0]; }
function profileDataPath(id) { return path.join(app.getPath('userData'), 'profiles', id, 'flux-data.json'); }
function saveProfileIndex() { try { fs.writeFileSync(profileIndexPath, JSON.stringify(profileIndex, null, 2)); } catch {} }
function attachDownloadHandler(sess) { if (attachedDownloadSessions.has(sess)) return; attachedDownloadSessions.add(sess); sess.on('will-download', (_event, item) => { const file = dialog.showSaveDialogSync(win, { defaultPath: path.join(app.getPath('downloads'), item.getFilename()) }); if (!file) { item.cancel(); return; } item.setSavePath(file); item.on('done', (_e, state) => win && win.webContents.send('downloads:done', { name: item.getFilename(), state, path: file })); }); }
function configurePermissions(sess) { if (permissionSessions.has(sess)) return; permissionSessions.add(sess); sess.setPermissionRequestHandler((_wc, permission, callback) => { if (permission !== 'media') { callback(false); return; } dialog.showMessageBox(win, { type: 'question', buttons: ['Allow microphone', 'Block'], defaultId: 1, cancelId: 1, title: 'Flux voice search', message: 'Allow Flux to use your microphone?', detail: 'The microphone is used only after you start voice search.' }).then(result => callback(result.response === 0)).catch(() => callback(false)); }); }
function saveOpenTabs() { store.openTabs=tabs.filter(t=>!t.private).map(t=>t.url).filter(u=>/^https?:/i.test(u));store.lastActiveUrl=(tabs.find(t=>t.id===activeId&&!t.private)||{}).url||''; persist(); }
function loadProfileStore(id) { storePath=profileDataPath(id); store={bookmarks:[],history:[],settings:{search:'https://www.google.com/search?q=%s',home:'flux://home'},imported:false}; try { if(fs.existsSync(storePath)) store={...store,...JSON.parse(fs.readFileSync(storePath,'utf8'))}; } catch {} if(store.settings.home==='https://www.google.com')store.settings.home='flux://home'; }
const homeFile = path.join(__dirname, 'home.html');
const homeUrl = pathToFileURL(homeFile).href;
let store = { bookmarks: [], history: [], settings: { search: 'https://www.google.com/search?q=%s', home: 'flux://home' }, imported: false };
function chromeRoots() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return [path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Google', 'Chrome', 'User Data')];
  }
  if (process.platform === 'darwin') {
    const support = path.join(home, 'Library', 'Application Support');
    return [path.join(support, 'Google', 'Chrome'), path.join(support, 'Chromium')];
  }
  const config = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  return [path.join(config, 'google-chrome'), path.join(config, 'chromium'), path.join(config, 'google-chrome-beta')];
}

function persist() { store.updatedAt=Date.now(); try { fs.mkdirSync(path.dirname(storePath),{recursive:true}); fs.writeFileSync(storePath, JSON.stringify(store, null, 2)); } catch {} }
function publicTab(t) { return { id: t.id, title: t.title, url: t.url, loading: t.loading, isPrivate: !!t.private, readerOn: !!t.readerOn, groupId: t.groupId || '', groupColor: t.groupColor || '', canGoBack: t.view.webContents.canGoBack(), canGoForward: t.view.webContents.canGoForward() }; }
function sendState() { if (win && !win.isDestroyed()) win.webContents.send('browser:state', { tabs: tabs.map(publicTab), activeId, bookmarks: store.bookmarks.slice(0, 30), settings: store.settings, profile: profileMeta(), profiles: profileIndex.profiles, groups: tabGroups, splitIds, recentlyClosedCount: recentlyClosed.length, syncConfigured: !!profileMeta().syncUrl, syncLastAt: profileMeta().syncLastAt || 0 }); }
function fitViews() {
  if (!win || win.isDestroyed()) return;
  const [width, height] = win.getContentSize();
  const left = store.settings.verticalTabs ? 210 : 228;
  const top = 137;
  const availableWidth = Math.max(0, width - left - panelWidth);
  const viewHeight = Math.max(0, height - top);
  const split = splitIds.length === 2 && splitIds.every(id => tabs.some(t => t.id === id));
  for (const t of tabs) {
    if (split && splitIds.includes(t.id)) {
      const index = splitIds.indexOf(t.id);
      t.view.setBounds({ x: left + Math.floor(availableWidth * index / 2), y: top, width: Math.floor(availableWidth / 2), height: viewHeight });
      t.view.setVisible(true);
    } else {
      t.view.setBounds({ x: left, y: top, width: availableWidth, height: viewHeight });
      t.view.setVisible(!split && t.id === activeId);
    }
  }
  if (aiView) aiView.setBounds({ x: Math.max(left, width - panelWidth), y: top, width: panelWidth, height: viewHeight });
}
function readerCss() { return `html{background:#f4f1e9!important;color:#24211d!important}body{max-width:780px!important;margin:40px auto!important;padding:36px 54px!important;background:#fffdf8!important;color:#24211d!important;font:20px/1.8 Georgia,serif!important;box-shadow:0 8px 36px #0002!important}header,nav,aside,footer,[role="navigation"],[role="complementary"],.advert,.advertisement,.ads,.ad-container,[id*="cookie"],[class*="cookie"],[id*="newsletter"],[class*="newsletter"],[class*="social-share"]{display:none!important}article,main,[role="main"]{max-width:100%!important;margin:0 auto!important;padding:0!important;background:transparent!important;color:inherit!important;font:inherit!important}h1,h2,h3{line-height:1.25!important}img,video{max-width:100%!important;height:auto!important}@media(max-width:700px){body{margin:0!important;padding:24px!important;font-size:18px!important}}`; }
async function applyReader(t) { if (!t.readerOn || !t.view || t.view.webContents.isDestroyed()) return; try { t.readerCssKey = await t.view.webContents.insertCSS(readerCss()); } catch {} }
function contrastCss() { return `html,body{background:#000!important;color:#fff!important}body,body *{color:#fff!important;border-color:#aaa!important;text-shadow:none!important;box-shadow:none!important}a{color:#8fd3ff!important;text-decoration:underline!important}button,input,select,textarea{background:#111!important;color:#fff!important;border:2px solid #fff!important}img,video,canvas{filter:contrast(1.15)!important}`; }
async function applyContrast(t) { if (!store.settings.highContrast || !t.view || t.view.webContents.isDestroyed()) return; try { t.contrastCssKey = await t.view.webContents.insertCSS(contrastCss()); } catch {} }
function normalise(value) {
  const raw = String(value || '').trim(); if (!raw) return '';
  if (raw === 'flux://home') return homeUrl;
  if (/^@gemini(?:\s+|$)/i.test(raw)) return `https://gemini.google.com/app?prompt=${encodeURIComponent(raw.replace(/^@gemini\s*/i, ''))}`;
  if (/^@drive(?:\s+|$)/i.test(raw)) return `https://drive.google.com/drive/search?q=${encodeURIComponent(raw.replace(/^@drive\s*/i, ''))}`;
  const conversion = raw.match(/^(-?\d+(?:\.\d+)?)\s*(km|m|cm|mm|mi|ft|kg|g|lb|c|f)\s+(?:to|in)\s+(km|m|cm|mm|mi|ft|kg|g|lb|c|f)$/i);
  if (conversion) {
    const units = { km:['length',1000], m:['length',1], cm:['length',.01], mm:['length',.001], mi:['length',1609.344], ft:['length',.3048], kg:['mass',1], g:['mass',.001], lb:['mass',.45359237], c:['temp',1], f:['temp',1] };
    const amount = Number(conversion[1]), from = conversion[2].toLowerCase(), to = conversion[3].toLowerCase();
    if (units[from][0] === units[to][0]) {
      let result = amount;
      if (units[from][0] === 'temp') result = from === to ? amount : (from === 'c' ? amount * 9 / 5 + 32 : (amount - 32) * 5 / 9);
      else result = amount * units[from][1] / units[to][1];
      return resultPage(`${amount} ${from.toUpperCase()} = ${Number(result.toPrecision(8))} ${to.toUpperCase()}`);
    }
  }
  if (raw.length <= 120 && /^[\d\s()+\-*/%.^]+$/.test(raw) && /\d/.test(raw)) {
    try { const value = Function(`"use strict"; return (${raw.replace(/\^/g, '**')})`)(); if (Number.isFinite(value)) return resultPage(`${raw} = ${Number(value.toPrecision(12))}`); } catch {}
  }
  if (/^(https?|file|ftp):\/\//i.test(raw)) return raw;
  if (/^(localhost|127\.0\.0\.1)(:\d+)?([/?#].*)?$/i.test(raw)) return 'http://' + raw;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?([/?#].*)?$/i.test(raw) && !/\s/.test(raw)) return 'https://' + raw;
  return store.settings.search.replace('%s', encodeURIComponent(raw));
}
function resultPage(text) { const safe = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><meta charset="utf-8"><title>Flux Search</title><style>body{margin:0;background:#202127;color:#eee;font:24px system-ui;display:grid;place-items:center;height:100vh}.card{padding:40px 55px;border:1px solid #444;border-radius:18px;background:#2b2d35;box-shadow:0 20px 70px #0005}small{display:block;color:#a89aff;font-size:13px;letter-spacing:.1em;margin-bottom:14px}</style><div class="card"><small>FLUX QUICK ANSWER</small>${safe}</div>`)}`; }
function logVisit(t, url) {
  if(url===homeUrl){t.url='';t.isHome=true;return;}t.url = url; if (t.private) return; try { if (!/^flux:/.test(url) && !/^data:/.test(url) && !url.startsWith('file:')) { store.history.unshift({ url, title: t.title || url, visited: Date.now() }); store.history = store.history.slice(0, 2500); persist(); } } catch {}
}
function addTab(url = store.settings.home, background = false, isPrivate = false) {
  const id = nextId++;
  const partition = isPrivate ? `flux-private-${id}-${Date.now()}` : 'persist:flux-'+profileIndex.activeProfileId;
  const view = new WebContentsView({ webPreferences: { preload:path.join(__dirname,'tab-preload.js'),partition,contextIsolation: true, sandbox: true, nodeIntegration: false } });
  configurePermissions(view.webContents.session);
  const t = { id, view, title: isPrivate ? 'Private tab' : 'Flux Home', url: '', loading: true, isHome: false, private: isPrivate, groupId: '', groupColor: '' };
  tabs.push(t); win.contentView.addChildView(view); fitViews();
  const wc = view.webContents;
  wc.setWindowOpenHandler(({ url: target }) => { addTab(target); return { action: 'deny' }; });
  wc.on('page-title-updated', (_e, title) => { t.title = title || t.url || 'Flux Home'; sendState(); });
  wc.on('did-start-navigation', (_e, target, isInPlace, isMainFrame) => { if (isMainFrame) { t.loading = true; t.isHome=target===homeUrl; t.url=t.isHome?'':target; sendState(); } });
  wc.on('did-navigate', (_e, target) => { t.loading = false; t.isHome=target===homeUrl; t.url=t.isHome?'':target; logVisit(t, target); sendState(); });
  wc.on('did-navigate-in-page', (_e, target) => { t.url = target; sendState(); });
  wc.on('did-stop-loading', () => { t.loading = false; sendState(); });
  wc.on('did-finish-load', () => { applyReader(t); applyContrast(t); });
  wc.on('render-process-gone', (_e, details) => { t.title = 'Page crashed'; sendState(); });
  wc.on('before-input-event', browserShortcut);
  wc.on('page-favicon-updated', (_e, favicons) => { t.favicon = favicons[0] || ''; sendState(); });
  wc.on('context-menu', (_e, params) => {
    const items = [];
    if (params.srcURL && ['image','video'].includes(params.mediaType)) items.push({ label: 'Search image with Flux Lens', click: () => shell.openExternal(`https://lens.google.com/uploadbyurl?url=${encodeURIComponent(params.srcURL)}`) });
    if (params.selectionText) items.push({ label: 'Search selection on Google', click: () => shell.openExternal(`https://www.google.com/search?q=${encodeURIComponent(params.selectionText)}`) });
    if (params.mediaType === 'video') items.push({ label: 'Open video in Picture-in-Picture', click: () => wc.executeJavaScript('(()=>{const v=document.elementFromPoint('+params.x+','+params.y+');const video=v?.closest?.("video")||document.querySelector("video");return video?.requestPictureInPicture?.()})()').catch(()=>{}) });
    if (params.linkURL) items.push({ label: 'Open link in new tab', click: () => addTab(params.linkURL) });
    items.push({ label: 'Back', enabled: wc.canGoBack(), click: () => wc.goBack() }, { label: 'Forward', enabled: wc.canGoForward(), click: () => wc.goForward() }, { label: 'Reload', click: () => wc.reload() }, { type: 'separator' }, { label: 'Inspect', click: () => wc.inspectElement(params.x, params.y) });
    Menu.buildFromTemplate(items).popup({ window: win });
  });
  if (!background) activeId = id;
  for (const other of tabs) other.view.setVisible(!background && other.id===id);
  const destination=normalise(url||'flux://home');t.isHome=destination===homeUrl;wc.loadURL(destination);
  sendState();
  return id;
}
function browserShortcut(event,input){if(input.type!=='keyDown'||!(input.control||input.meta)||!win)return;const key=input.key.toLowerCase();const commands={l:'focus-address',t:'new-tab',w:'close-tab',h:'history',j:'downloads',d:'bookmark',f:'find',r:'reload',plus:'zoom-in','=':'zoom-in','-':'zoom-out',0:'zoom-reset'};let cmd;if(input.shift&&key==='t')cmd='reopen-tab';else if(input.shift&&key==='a')cmd='search-tabs';else if(input.shift&&key==='g')cmd='assistant';else cmd=commands[key];if(cmd){event.preventDefault();win.webContents.send('ui:command',cmd);}}
function activate(id) { const t = tabs.find(x => x.id === id); if (!t) return; activeId = id; fitViews(); sendState(); }
function closeTab(id) { const i = tabs.findIndex(x => x.id === id); if (i < 0) return; const [t] = tabs.splice(i, 1); if (!t.private && (t.isHome || /^https?:/i.test(t.url))) { recentlyClosed.unshift({ url: t.url || 'flux://home', title: t.title }); recentlyClosed = recentlyClosed.slice(0, 12); } if (splitIds.includes(id)) splitIds = []; win.contentView.removeChildView(t.view); t.view.webContents.close(); if (!tabs.length) addTab(); else if (activeId === id) activeId=tabs[Math.min(i, tabs.length - 1)].id; fitViews(); sendState(); }
function reopenClosedTab() { const recent = recentlyClosed.shift(); if (!recent) return { ok: false }; addTab(recent.url); return { ok: true, title: recent.title }; }
function toggleSplit() { if (splitIds.length === 2) splitIds = []; else { const current = tabs.find(t => t.id === activeId); let other = tabs.find(t => t.id !== activeId); if (!other) { const keep = activeId; const created = addTab('flux://home', true); other = tabs.find(t => t.id === created); activeId = keep; } splitIds = [activeId, other.id]; } fitViews(); sendState(); return splitIds.length === 2; }
function assignGroup(id, name) { const tab = tabs.find(t => t.id === id); if (!tab || tab.private) return { ok: false }; const clean = String(name || '').trim().slice(0, 32); if (!clean) { tab.groupId = ''; tab.groupColor = ''; sendState(); return { ok: true }; } let group = tabGroups.find(g => g.name.toLowerCase() === clean.toLowerCase()); if (!group) { const palette = ['#8b78e6','#e17b91','#41b992','#e0a547','#42a7c8','#c16ec2']; group = { id: `group-${Date.now()}`, name: clean, color: palette[tabGroups.length % palette.length] }; tabGroups.push(group); } tab.groupId = group.id; tab.groupColor = group.color; sendState(); return { ok: true, group }; }
async function toggleReader(id) { const t = tabs.find(x => x.id === id); if (!t || t.private && !t.url) return false; t.readerOn = !t.readerOn; if (!t.readerOn && t.readerCssKey) { try { await t.view.webContents.removeInsertedCSS(t.readerCssKey); } catch {} t.readerCssKey = null; } else await applyReader(t); sendState(); return t.readerOn; }

function walkBookmarks(node, result) {
  if (!node) return;
  if (node.type === 'url' && node.url && /^https?:/i.test(node.url)) result.push({ title: node.name || node.url, url: node.url });
  for (const child of node.children || []) walkBookmarks(child, result);
}
function mergeBookmarks(items) {
  let count=0;
  for(const item of items){if(!item||typeof item.url!=='string'||!/^https?:\/\//i.test(item.url))continue;const url=item.url.trim();if(!store.bookmarks.some(x=>x.url===url)){store.bookmarks.push({title:String(item.title||item.name||url).slice(0,500),url});count++;}}
  return count;
}
function mergeHistory(items) {
  const seen=new Set(store.history.map(x=>`${x.url}|${x.visited}`));let count=0;
  for(const item of items){if(!item||typeof item.url!=='string'||!/^https?:\/\//i.test(item.url))continue;const visited=Number(item.visited)||Date.now(),key=`${item.url}|${visited}`;if(seen.has(key))continue;seen.add(key);store.history.push({url:item.url,title:String(item.title||item.url).slice(0,500),visited});count++;}
  store.history.sort((a,b)=>b.visited-a.visited);store.history=store.history.slice(0,2500);return count;
}
function decodeHtml(text){return String(text).replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&#(\d+);/g,(_m,n)=>String.fromCodePoint(Number(n))).replace(/&#x([\da-f]+);/gi,(_m,n)=>String.fromCodePoint(parseInt(n,16)));}
function importSelectedFile(filePath){const ext=path.extname(filePath).toLowerCase();let result={bookmarks:0,history:0,settings:false,file:path.basename(filePath)};
  if(ext==='.html'||ext==='.htm'){
    const html=fs.readFileSync(filePath,'utf8');const items=[];const re=/<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a\s*>/gi;let m;
    while((m=re.exec(html))!==null){const title=decodeHtml(m[3].replace(/<[^>]*>/g,'').trim())||m[2];items.push({title,url:decodeHtml(m[2])});}
    result.bookmarks=mergeBookmarks(items);
  }else if(ext==='.json'){
    const data=JSON.parse(fs.readFileSync(filePath,'utf8'));
    if(Array.isArray(data.bookmarks)){result.bookmarks=mergeBookmarks(data.bookmarks);}else if(data.roots){const items=[];walkBookmarks(data.roots,items);result.bookmarks=mergeBookmarks(items);}else throw new Error('This JSON file is not a Flux backup or Chrome bookmarks file.');
    if(Array.isArray(data.history))result.history=mergeHistory(data.history);
    if(data.settings&&typeof data.settings==='object'){const s=data.settings;if(typeof s.home==='string'&&(s.home==='flux://home'||/^https?:\/\//i.test(s.home)))store.settings.home=s.home;if(typeof s.search==='string'&&s.search.includes('%s')&&/^https?:\/\//i.test(s.search))store.settings.search=s.search;result.settings=true;}
  }else throw new Error('Choose an HTML bookmarks export or a Flux JSON backup.');
  store.imported=true;persist();sendState();return {ok:true,result};
}
function importChrome() {
  const profileNames = ['Default', ...Array.from({ length: 12 }, (_, i) => `Profile ${i + 1}`)];
  const profiles = chromeRoots().flatMap(root => profileNames.map(name => ({ name, dir: path.join(root, name) }))).filter(p => fs.existsSync(p.dir));
  if (!profiles.length) return { ok: false, message: 'Chrome profile folder was not found on this device.' };
  const imported = { bookmarks: 0, history: 0, profile: profiles[0].name, settings: false };
  for (const profile of profiles) {
    const bookmarkFile = path.join(profile.dir, 'Bookmarks');
    try { const json = JSON.parse(fs.readFileSync(bookmarkFile, 'utf8')); const items = []; walkBookmarks(json.roots, items); imported.bookmarks+=mergeBookmarks(items); } catch {}
    const historyFile = path.join(profile.dir, 'History');
    if (fs.existsSync(historyFile)) {
      const copy = path.join(app.getPath('temp'), `flux-chrome-history-${Date.now()}.sqlite`);
      try {
        fs.copyFileSync(historyFile, copy);
        const db = new DatabaseSync(copy, { readOnly: true });
        const rows = db.prepare('SELECT url, title, last_visit_time FROM urls ORDER BY last_visit_time DESC LIMIT 1000').all();
        const epoch = 11644473600000000;
        const items=rows.filter(row=>row.url&&/^https?:/i.test(row.url)).map(row=>({url:row.url,title:row.title,visited:Math.max(0,Math.floor((Number(row.last_visit_time)-epoch)/1000))}));imported.history+=mergeHistory(items);
        db.close(); fs.unlinkSync(copy);
      } catch { try { fs.unlinkSync(copy); } catch {} }
    }
    const prefPath = path.join(profile.dir, 'Preferences');
    try { const pref = JSON.parse(fs.readFileSync(prefPath, 'utf8')); const home = pref.homepage; if (typeof home === 'string' && /^https?:\/\//i.test(home)) store.settings.home = home; const template = pref.default_search_provider_data && pref.default_search_provider_data.template_url_data && pref.default_search_provider_data.template_url_data.url; if (typeof template === 'string' && template.includes('{searchTerms}')) store.settings.search = template.replace('{searchTerms}', '%s'); imported.settings = true; } catch {}
  }
  store.imported = true; persist(); sendState(); return { ok: true, imported };
}

function createWindow() {
  win = new BrowserWindow({ width: 1440, height: 920, minWidth: 900, minHeight: 620, backgroundColor: '#202020', title: 'Flux', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.on('before-input-event', browserShortcut);
  win.on('resize', fitViews);
  win.on('close', () => { store.openTabs=tabs.filter(t=>!t.private).map(t=>t.url).filter(u=>/^https?:/i.test(u));store.lastActiveUrl=(tabs.find(t=>t.id===activeId&&!t.private)||{}).url||'';persist(); });
  win.on('closed', () => { tabs = []; win = null; });
  win.webContents.on('did-finish-load', () => { if (store.imported&&!tabs.length) { const saved=Array.isArray(store.openTabs)?store.openTabs.filter(u=>/^https?:/i.test(u)):[]; if(saved.length){ for(const u of saved)addTab(u,true); const last=tabs.find(t=>t.url===store.lastActiveUrl)||tabs[0]; activate(last.id); } else addTab(store.settings.home); } if (tabs.length) { activate(activeId); sendState(); } });
  attachDownloadHandler(session.fromPartition('persist:flux-'+profileIndex.activeProfileId));
}

app.whenReady().then(() => {
  profileIndexPath=path.join(app.getPath('userData'),'flux-profiles.json');
  try { if(fs.existsSync(profileIndexPath)) profileIndex={...profileIndex,...JSON.parse(fs.readFileSync(profileIndexPath,'utf8'))}; } catch {}
  const oldPath=path.join(app.getPath('userData'),'flux-data.json');
  if(!fs.existsSync(profileDataPath('default'))&&fs.existsSync(oldPath)){fs.mkdirSync(path.dirname(profileDataPath('default')),{recursive:true});try{fs.copyFileSync(oldPath,profileDataPath('default'));}catch{}}
  if(!profileIndex.profiles.some(p=>p.id===profileIndex.activeProfileId))profileIndex.activeProfileId=profileIndex.profiles[0].id;
  loadProfileStore(profileIndex.activeProfileId); saveProfileIndex();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) { createWindow(); } });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

function profileList() { return profileIndex.profiles.map(({ id, name, color, syncUrl, syncUsername, syncLastAt }) => ({ id, name, color, syncUrl: syncUrl || '', syncUsername: syncUsername || '', syncLastAt: syncLastAt || 0, active: id === profileIndex.activeProfileId })); }
function createProfile(name) {
  const clean=String(name||'').trim().slice(0,40); if(!clean) return {ok:false,message:'Enter a profile name.'};
  const id=clean.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,24)||'profile';
  let unique=id,n=2; while(profileIndex.profiles.some(p=>p.id===unique)) unique=`${id}-${n++}`;
  profileIndex.profiles.push({id:unique,name:clean,color:'#9d8cff'}); fs.mkdirSync(path.dirname(profileDataPath(unique)),{recursive:true});
  const empty={bookmarks:[],history:[],settings:{search:'https://www.google.com/search?q=%s',home:'flux://home'},imported:true,updatedAt:Date.now()}; fs.writeFileSync(profileDataPath(unique),JSON.stringify(empty,null,2)); saveProfileIndex(); switchProfile(unique); return {ok:true};
}
function switchProfile(id) {
  if(!profileIndex.profiles.some(p=>p.id===id))return {ok:false,message:'Profile not found.'};
  if(id===profileIndex.activeProfileId)return {ok:true};
  saveOpenTabs(); for(const t of tabs){try{win.contentView.removeChildView(t.view);t.view.webContents.close();}catch{}} tabs=[];activeId=null;splitIds=[];
  if(aiView){try{win.contentView.removeChildView(aiView);aiView.webContents.close();}catch{} aiView=null;aiOpen=false;panelWidth=0;}
  profileIndex.activeProfileId=id;saveProfileIndex();loadProfileStore(id);attachDownloadHandler(session.fromPartition('persist:flux-'+id));
  const saved=Array.isArray(store.openTabs)?store.openTabs.filter(u=>/^https?:/i.test(u)):[];
  if(saved.length){for(const u of saved)addTab(u,true);activate(tabs[0].id);}else addTab(store.settings.home);
  sendState();return {ok:true};
}
function saveSyncConfig(input) {
  const meta=profileMeta();const url=String(input?.url||'').trim();
  if(url){let parsed;try{parsed=new URL(url);}catch{return {ok:false,message:'Enter a valid WebDAV sync file URL.'};}if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password)return {ok:false,message:'Use an HTTPS WebDAV file URL; credentials go in the fields below.'};if(parsed.protocol==='http:'&&!['localhost','127.0.0.1'].includes(parsed.hostname))return {ok:false,message:'WebDAV sync requires HTTPS except on localhost.'};}
  meta.syncUrl=url;
  if(input?.username!==undefined)meta.syncUsername=String(input.username).slice(0,200);
  if(input?.password){if(!safeStorage.isEncryptionAvailable())return {ok:false,message:'Secure credential storage is unavailable on this system.'};meta.syncPassword=safeStorage.encryptString(String(input.password)).toString('base64');}
  saveProfileIndex();sendState();return {ok:true};
}
async function syncProfile() {
  const meta=profileMeta();if(!meta.syncUrl)return {ok:false,message:'Add your WebDAV sync file URL first.'};
  try {
    const headers={};if(meta.syncUsername||meta.syncPassword){if(!safeStorage.isEncryptionAvailable())throw new Error('Secure credential storage is unavailable on this system.');const password=meta.syncPassword?safeStorage.decryptString(Buffer.from(meta.syncPassword,'base64')):'';headers.Authorization='Basic '+Buffer.from(`${meta.syncUsername||''}:${password}`).toString('base64');}
    const response=await fetch(meta.syncUrl,{headers,signal:AbortSignal.timeout(20000)});let remote=null;
    if(response.ok){remote=await response.json();if(remote.format!=='flux-sync'||remote.version!==1)throw new Error('Remote file is not a Flux sync file.');}
    else if(response.status!==404)throw new Error(`WebDAV read failed (${response.status}).`);
    const localUpdated=Number(store.updatedAt)||0, remoteUpdated=Number(remote?.updatedAt)||0;
    if(remote){mergeBookmarks(remote.bookmarks||[]);mergeHistory(remote.history||[]);if(remoteUpdated>localUpdated&&remote.settings&&typeof remote.settings==='object')store.settings={...store.settings,...remote.settings};store.openTabs=[...new Set([...(store.openTabs||[]),...(remote.openTabs||[])].filter(u=>/^https?:/i.test(u)))].slice(0,30);}
    store.updatedAt=Math.max(Date.now(),localUpdated,remoteUpdated);persist();
    store.openTabs=[...new Set([...tabs.filter(t=>!t.private).map(t=>t.url),...(store.openTabs||[])].filter(u=>/^https?:/i.test(u)))].slice(0,30);
    persist();
    const payload={format:'flux-sync',version:1,updatedAt:store.updatedAt,bookmarks:store.bookmarks,history:store.history,settings:store.settings,openTabs:store.openTabs};
    const put=await fetch(meta.syncUrl,{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)});
    if(!put.ok)throw new Error(`WebDAV write failed (${put.status}). Check that this URL allows PUT.`);
    meta.syncLastAt=Date.now();saveProfileIndex();sendState();return {ok:true,bookmarks:store.bookmarks.length,history:store.history.length};
  }catch(error){return {ok:false,message:error.message||'Sync failed.'};}
}
ipcMain.handle('flux:profiles', () => ({current:profileMeta(),profiles:profileList()}));
ipcMain.handle('flux:create-profile', (_e,name) => createProfile(name));
ipcMain.handle('flux:switch-profile', (_e,id) => switchProfile(id));
ipcMain.handle('flux:save-sync', (_e,input) => saveSyncConfig(input));
ipcMain.handle('flux:sync-profile', () => syncProfile());
ipcMain.handle('flux:setup-status', () => { if (!store.imported) for (const t of tabs) t.view.setVisible(false); return ({ imported: store.imported, chromeFound: fs.existsSync(chromeRoot), profile: app.getPath('userData') }); });
ipcMain.handle('flux:import-chrome', () => importChrome());
ipcMain.handle('flux:import-file', async () => {const pick=await dialog.showOpenDialog(win,{title:'Import browser data',properties:['openFile'],filters:[{name:'Flux backup or bookmarks',extensions:['json','html','htm']}]});if(pick.canceled||!pick.filePaths.length)return {canceled:true};try{return importSelectedFile(pick.filePaths[0]);}catch(error){return {ok:false,message:error.message};}});
ipcMain.handle('flux:export-backup', async () => {const target=await dialog.showSaveDialog(win,{title:'Export Flux backup',defaultPath:path.join(app.getPath('documents'),'Flux-backup.json'),filters:[{name:'Flux backup',extensions:['json']}]});if(target.canceled||!target.filePath)return {canceled:true};const backup={format:'flux-backup',version:1,exportedAt:new Date().toISOString(),bookmarks:store.bookmarks,history:store.history,settings:store.settings};try{fs.writeFileSync(target.filePath,JSON.stringify(backup,null,2),'utf8');return {ok:true,file:path.basename(target.filePath)};}catch(error){return {ok:false,message:error.message};}});
ipcMain.handle('flux:finish-setup', (_e, settings) => { if (settings && settings.search) store.settings.search = settings.search; if (settings && settings.home) store.settings.home = settings.home; store.imported = true; persist(); if (!tabs.length) addTab(store.settings.home); activate(activeId); return store.settings; });
ipcMain.handle('flux:new-tab', () => addTab('flux://home'));
ipcMain.handle('flux:new-private-tab', () => addTab('flux://home', false, true));
ipcMain.handle('flux:activate', (_e, id) => activate(id));
ipcMain.handle('flux:close-tab', (_e, id) => closeTab(id));
ipcMain.handle('flux:reopen-tab', () => reopenClosedTab());
ipcMain.handle('flux:toggle-split', () => toggleSplit());
ipcMain.handle('flux:tab-group', (_e, id, name) => assignGroup(id, name));
ipcMain.handle('flux:toggle-reader', (_e, id) => toggleReader(id));
ipcMain.handle('flux:set-vertical-tabs', (_e, enabled) => { store.settings.verticalTabs = !!enabled; persist(); fitViews(); sendState(); return store.settings.verticalTabs; });
ipcMain.handle('flux:set-high-contrast', async (_e, enabled) => { store.settings.highContrast=!!enabled; persist(); for(const t of tabs){if(!store.settings.highContrast&&t.contrastCssKey){try{await t.view.webContents.removeInsertedCSS(t.contrastCssKey);}catch{}t.contrastCssKey=null;}else if(store.settings.highContrast)await applyContrast(t);}sendState();return store.settings.highContrast; });
ipcMain.handle('flux:download-action', async (_e, filePath, action) => {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || !['open', 'show'].includes(action) || !fs.existsSync(filePath)) return { ok: false };
  if (action === 'show') shell.showItemInFolder(filePath);
  else { const error = await shell.openPath(filePath); if (error) return { ok: false, message: error }; }
  return { ok: true };
});
ipcMain.handle('flux:media-list', async () => {
  const items=[];
  for(const t of tabs){try{const media=await t.view.webContents.executeJavaScript(`Array.from(document.querySelectorAll('video,audio')).map((m,index)=>({index,title:(m.getAttribute('aria-label')||m.title||m.currentSrc||m.src||'Media').slice(0,180),paused:m.paused,video:m.tagName==='VIDEO',private:${!!t.private}})).slice(0,20)`);for(const item of media)if(item.title||item.video)items.push({tabId:t.id,tabTitle:t.title,...item});}catch{}}
  return items;
});
ipcMain.handle('flux:media-action', async (_e,id,index,action) => {const t=tabs.find(x=>x.id===id);const i=Number(index);if(!t||!Number.isInteger(i)||i<0||!['play','pause','pip'].includes(action))return {ok:false};try{const result=await t.view.webContents.executeJavaScript(`(()=>{const m=document.querySelectorAll('video,audio')[${i}];if(!m)return false;if(${JSON.stringify(action)}==='play')m.play();else if(${JSON.stringify(action)}==='pause')m.pause();else if(m.tagName==='VIDEO')m.requestPictureInPicture?.();return true})()`);return {ok:!!result};}catch{return {ok:false};}});
ipcMain.handle('flux:navigate', (_e, id, value) => { const t = tabs.find(x => x.id === id); if (t) { const url = normalise(value); if (url) t.view.webContents.loadURL(url); } });
ipcMain.handle('flux:nav-action', (_e, id, action) => { const t = tabs.find(x => x.id === id); if (!t) return; const wc = t.view.webContents; if (action === 'back' && wc.canGoBack()) wc.goBack(); else if (action === 'forward' && wc.canGoForward()) wc.goForward(); else if (action === 'reload') wc.reload(); else if (action === 'home') wc.loadURL(normalise(store.settings.home)); });
ipcMain.handle('flux:bookmark', (_e, id) => { const t = tabs.find(x => x.id === id); if (!t || t.private) return false; const i = store.bookmarks.findIndex(b => b.url === t.url); if (i >= 0) store.bookmarks.splice(i, 1); else store.bookmarks.unshift({ title: t.title || t.url, url: t.url }); persist(); sendState(); return i < 0; });
ipcMain.handle('flux:save-pdf', async (_e, id) => {
  const t = tabs.find(x => x.id === id);
  if (!t || t.view.webContents.isDestroyed()) return { ok: false, message: 'There is no active page to save.' };
  const safeTitle = String(t.title || 'Flux page').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').trim().slice(0, 100) || 'Flux page';
  const target = await dialog.showSaveDialog(win, { title: 'Save page as PDF', defaultPath: path.join(app.getPath('downloads'), `${safeTitle}.pdf`), filters: [{ name: 'PDF document', extensions: ['pdf'] }] });
  if (target.canceled || !target.filePath) return { canceled: true };
  try {
    const pdf = await t.view.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
    fs.writeFileSync(target.filePath, pdf);
    return { ok: true, file: path.basename(target.filePath) };
  } catch (error) { return { ok: false, message: error.message || 'PDF export failed.' }; }
});
ipcMain.handle('flux:get-pages', (_e, kind) => kind === 'history' ? store.history.slice(0, 300) : store.bookmarks);
ipcMain.handle('flux:open-page', (_e, url) => { if (activeId != null) { const t = tabs.find(x => x.id === activeId); if (t) t.view.webContents.loadURL(normalise(url)); } });
ipcMain.handle('flux:settings', () => store.settings);
ipcMain.handle('flux:save-settings', (_e, settings) => { store.settings = { ...store.settings, ...settings }; persist(); return store.settings; });
ipcMain.handle('flux:clear-data', async () => { const activeSession=session.fromPartition('persist:flux-'+profileIndex.activeProfileId); await activeSession.clearStorageData(); await activeSession.clearCache(); store.history = []; store.bookmarks = []; persist(); sendState(); return true; });
ipcMain.handle('flux:fullscreen', () => { if (win) win.setFullScreen(!win.isFullScreen()); });
ipcMain.handle('flux:panel-width', (_e, width) => { panelWidth=Math.max(0,Math.min(440,Number(width)||0));fitViews(); });
ipcMain.handle('flux:ai-toggle', () => { if(!aiView){aiView=new WebContentsView({webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false}});win.contentView.addChildView(aiView);aiView.webContents.setWindowOpenHandler(({url})=>{shell.openExternal(url);return {action:'deny'};});aiView.webContents.loadURL('https://chatgpt.com/');} aiOpen=!aiOpen;panelWidth=aiOpen?390:0;aiView.setVisible(aiOpen);fitViews();return aiOpen; });
ipcMain.handle('flux:open-external', (_e,url) => shell.openExternal(url));
ipcMain.handle('flux:home-search', (event,value) => { const t=tabs.find(x=>x.view.webContents===event.sender);if(t&&t.isHome){const url=normalise(value);if(url)t.view.webContents.loadURL(url);} });
ipcMain.handle('flux:home-bookmarks', event => {const t=tabs.find(x=>x.view.webContents===event.sender);return t&&t.isHome?store.bookmarks.slice(0,30):[];});
ipcMain.handle('flux:home-action', event => {const t=tabs.find(x=>x.view.webContents===event.sender);if(t&&t.isHome)win.webContents.send('ui:command','bookmarks');});
ipcMain.handle('flux:find', (_e, text) => { const t = tabs.find(x => x.id === activeId); if (t) t.view.webContents.findInPage(text); });
ipcMain.handle('flux:stop-find', () => { const t = tabs.find(x => x.id === activeId); if (t) t.view.webContents.stopFindInPage('clearSelection'); });
ipcMain.handle('flux:zoom', (_e, step) => { const t = tabs.find(x => x.id === activeId); if (t) t.view.webContents.setZoomLevel(step===0?0:t.view.webContents.getZoomLevel()+step); });
