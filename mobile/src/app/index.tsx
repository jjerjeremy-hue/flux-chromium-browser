import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  Keyboard,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import WebView, { type WebViewNavigation } from 'react-native-webview';

type BrowserTab = {
  id: number;
  url: string;
  title: string;
  isPrivate: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
};
type SavedPage = { url: string; title: string; visitedAt: number };
type Panel = 'menu' | 'tabs' | 'bookmarks' | 'history' | null;
type WebViewHandle = Pick<WebView, 'goBack' | 'goForward' | 'reload'>;

const HOME = 'flux://home';
const SEARCH = 'https://www.google.com/search?q=';
const BOOKMARKS_KEY = 'flux.mobile.bookmarks.v1';
const HISTORY_KEY = 'flux.mobile.history.v1';
const palette = {
  bg: '#111318',
  surface: '#1b1d25',
  raised: '#242631',
  border: '#343746',
  text: '#f6f5ff',
  muted: '#a9acbd',
  accent: '#9a8cff',
  accent2: '#6b67f5',
};

function makeTab(id: number, url = HOME, isPrivate = false): BrowserTab {
  return { id, url, title: url === HOME ? 'Flux Home' : url, isPrivate, canGoBack: false, canGoForward: false };
}

function normalizeAddress(input: string): string {
  const value = input.trim();
  if (!value) return HOME;
  if (/^(https?):\/\//i.test(value)) return value;
  if (/^(mailto|tel|sms):/i.test(value)) return value;
  if (/^[\w-]+\.[a-z]{2,}(?::\d+)?(?:\/.*)?$/i.test(value)) return `https://${value}`;
  return `${SEARCH}${encodeURIComponent(value)}`;
}

function Action({ label, title, onPress, disabled = false, primary = false }: {
  label: string; title: string; onPress: () => void; disabled?: boolean; primary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.action, primary && styles.actionPrimary, disabled && styles.actionDisabled, pressed && styles.pressed]}
    >
      <Text style={[styles.actionText, disabled && styles.disabledText]}>{label}</Text>
    </Pressable>
  );
}

export default function BrowserScreen() {
  const nextId = useRef(1);
  const webViews = useRef<Record<number, WebViewHandle | null>>({});
  const [tabs, setTabs] = useState<BrowserTab[]>([makeTab(0)]);
  const [activeId, setActiveId] = useState(0);
  const [address, setAddress] = useState('');
  const [isEditingAddress, setIsEditingAddress] = useState(false);
  const [bookmarks, setBookmarks] = useState<SavedPage[]>([]);
  const [history, setHistory] = useState<SavedPage[]>([]);
  const [panel, setPanel] = useState<Panel>(null);
  const [loading, setLoading] = useState(false);
  const [webError, setWebError] = useState('');
  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0];
  const bookmarked = useMemo(
    () => !!activeTab && bookmarks.some((entry) => entry.url === activeTab.url),
    [activeTab, bookmarks],
  );

  useEffect(() => {
    let mounted = true;
    Promise.all([AsyncStorage.getItem(BOOKMARKS_KEY), AsyncStorage.getItem(HISTORY_KEY)])
      .then(([savedBookmarks, savedHistory]) => {
        if (!mounted) return;
        if (savedBookmarks) setBookmarks(JSON.parse(savedBookmarks) as SavedPage[]);
        if (savedHistory) setHistory(JSON.parse(savedHistory) as SavedPage[]);
      })
      .catch(() => undefined);
    return () => { mounted = false; };
  }, []);

  const addTab = useCallback((url = HOME, isPrivate = false) => {
    const id = ++nextId.current;
    const tab = makeTab(id, url, isPrivate);
    setTabs((current) => [...current, tab]);
    setActiveId(id);
    setPanel(null);
    setAddress(url === HOME ? '' : url);
    setWebError('');
    return id;
  }, []);

  const activateTab = useCallback((id: number) => {
    const tab = tabs.find((entry) => entry.id === id);
    if (!tab) return;
    setActiveId(id);
    setAddress(tab.url === HOME ? '' : tab.url);
    setIsEditingAddress(false);
    setPanel(null);
    setWebError('');
  }, [tabs]);

  const closeTab = useCallback((id: number) => {
    setTabs((current) => {
      const next = current.filter((tab) => tab.id !== id);
      if (next.length === 0) {
        const fresh = makeTab(++nextId.current);
        setActiveId(fresh.id);
        setAddress('');
        return [fresh];
      }
      if (id === activeId) {
        const replacement = next[next.length - 1];
        setActiveId(replacement.id);
        setAddress(replacement.url === HOME ? '' : replacement.url);
      }
      return next;
    });
  }, [activeId]);

  const navigate = useCallback((raw: string) => {
    const url = normalizeAddress(raw);
    Keyboard.dismiss();
    setIsEditingAddress(false);
    setWebError('');
    setAddress(url === HOME ? '' : url);
    setTabs((current) => current.map((tab) => tab.id === activeId ? { ...tab, url, title: url === HOME ? 'Flux Home' : url, canGoBack: false, canGoForward: false } : tab));
  }, [activeId]);

  const onNavigation = useCallback((tab: BrowserTab, state: WebViewNavigation) => {
    setTabs((current) => current.map((entry) => entry.id === tab.id
      ? { ...entry, url: state.url, title: state.title || state.url, canGoBack: state.canGoBack, canGoForward: state.canGoForward }
      : entry));
    if (tab.id === activeId && !isEditingAddress) setAddress(state.url === HOME ? '' : state.url);
    setLoading(state.loading);
    if (!tab.isPrivate && /^https?:/i.test(state.url)) {
      const visited = { url: state.url, title: state.title || state.url, visitedAt: Date.now() };
      setHistory((current) => {
        if (current[0]?.url === visited.url) return current;
        const next = [visited, ...current.filter((item) => item.url !== visited.url)].slice(0, 300);
        void AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next)).catch(() => undefined);
        return next;
      });
    }
  }, [activeId, isEditingAddress]);

  const toggleBookmark = useCallback(() => {
    if (!activeTab || activeTab.isPrivate || activeTab.url === HOME || !/^https?:/i.test(activeTab.url)) return;
    setBookmarks((current) => {
      const exists = current.some((entry) => entry.url === activeTab.url);
      const next = exists
        ? current.filter((entry) => entry.url !== activeTab.url)
        : [{ url: activeTab.url, title: activeTab.title, visitedAt: Date.now() }, ...current];
      void AsyncStorage.setItem(BOOKMARKS_KEY, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  }, [activeTab]);

  const clearHistory = useCallback(() => {
    setHistory([]);
    void AsyncStorage.removeItem(HISTORY_KEY).catch(() => undefined);
  }, []);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (panel) { setPanel(null); return true; }
      if (activeTab?.canGoBack) { webViews.current[activeId]?.goBack(); return true; }
      if (activeId !== tabs[0]?.id) { activateTab(tabs[0].id); return true; }
      return false;
    });
    return () => subscription.remove();
  }, [activeId, activeTab?.canGoBack, activateTab, panel, tabs]);

  const shouldStart = useCallback((request: WebViewNavigation) => {
    const url = request.url;
    if (url === 'about:blank' || /^https?:/i.test(url)) return true;
    if (/^(mailto|tel|sms):/i.test(url)) {
      void Linking.openURL(url).catch(() => undefined);
    }
    return false;
  }, []);

  const openSaved = (url: string) => { navigate(url); setPanel(null); };
  const titleForPanel = panel === 'tabs' ? 'Open tabs' : panel === 'bookmarks' ? 'Bookmarks' : panel === 'history' ? 'History' : 'Flux menu';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <View style={styles.brandMark}><Text style={styles.brandGlyph}>›</Text></View>
          <Text style={styles.brand}>Flux</Text>
          {activeTab?.isPrivate ? <Text style={styles.privatePill}>PRIVATE</Text> : null}
        </View>
        <Action label={`${tabs.length}`} title="Show tabs" onPress={() => setPanel('tabs')} />
        <Action label="＋" title="New tab" onPress={() => addTab()} primary />
      </View>

      <View style={styles.addressRow}>
        <TextInput
          accessibilityLabel="Search or enter web address"
          style={styles.addressInput}
          value={address}
          onChangeText={(value) => { setAddress(value); setIsEditingAddress(true); }}
          onFocus={() => setIsEditingAddress(true)}
          onSubmitEditing={() => navigate(address)}
          placeholder="Search or enter address"
          placeholderTextColor={palette.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          selectTextOnFocus
        />
        <Action label="↗" title="Go" onPress={() => navigate(address)} primary />
      </View>

      <View style={styles.page}>
        {tabs.map((tab) => tab.url === HOME ? (
          <View key={tab.id} style={[styles.home, { display: tab.id === activeId ? 'flex' : 'none' }]}>
            <View style={styles.homeGlow} />
            <View style={styles.homeMark}><Text style={styles.homeGlyph}>›</Text></View>
            <Text style={styles.homeTitle}>A little more room to browse.</Text>
            <Text style={styles.homeCopy}>Your tabs and saved pages stay on this device.</Text>
            <View style={styles.quickRow}>
              <Pressable style={styles.quickCard} onPress={() => setPanel('bookmarks')}><Text style={styles.quickIcon}>☆</Text><Text style={styles.quickLabel}>Bookmarks</Text></Pressable>
              <Pressable style={styles.quickCard} onPress={() => setPanel('history')}><Text style={styles.quickIcon}>◷</Text><Text style={styles.quickLabel}>History</Text></Pressable>
              <Pressable style={styles.quickCard} onPress={() => addTab(HOME, true)}><Text style={styles.quickIcon}>◐</Text><Text style={styles.quickLabel}>Private tab</Text></Pressable>
            </View>
            <Text style={styles.homeHint}>Type a search or website above to get started.</Text>
          </View>
        ) : (
          <View key={tab.id} style={[styles.webHolder, { display: tab.id === activeId ? 'flex' : 'none' }]}>
            <WebView
              ref={(view) => { webViews.current[tab.id] = view; }}
              source={{ uri: tab.url }}
              style={styles.webview}
              incognito={tab.isPrivate}
              sharedCookiesEnabled={!tab.isPrivate}
              javaScriptEnabled
              domStorageEnabled
              setSupportMultipleWindows={false}
              allowsBackForwardNavigationGestures
              onNavigationStateChange={(state) => onNavigation(tab, state)}
              onShouldStartLoadWithRequest={shouldStart}
              onLoadStart={() => { if (tab.id === activeId) { setLoading(true); setWebError(''); } }}
              onLoadEnd={() => { if (tab.id === activeId) setLoading(false); }}
              onError={(event) => { if (tab.id === activeId) { setLoading(false); setWebError(event.nativeEvent.description || 'This page could not be loaded. Check your connection and try again.'); } }}
              onOpenWindow={(event) => addTab(event.nativeEvent.targetUrl)}
              onContentProcessDidTerminate={() => webViews.current[tab.id]?.reload()}
              startInLoadingState={false}
              allowsInlineMediaPlayback
            />
            {webError ? (
              <View style={styles.errorCard}>
                <Text style={styles.errorTitle}>Page didn’t load</Text>
                <Text style={styles.errorText}>{webError}</Text>
                <Pressable style={styles.retryButton} onPress={() => webViews.current[tab.id]?.reload()}><Text style={styles.retryText}>Try again</Text></Pressable>
              </View>
            ) : null}
          </View>
        ))}
        {loading ? <View style={styles.loadingBar} /> : null}
      </View>

      <View style={styles.toolbar}>
        <Action label="‹" title="Go back" disabled={!activeTab?.canGoBack} onPress={() => webViews.current[activeId]?.goBack()} />
        <Action label="›" title="Go forward" disabled={!activeTab?.canGoForward} onPress={() => webViews.current[activeId]?.goForward()} />
        <Action label="⌂" title="Flux Home" onPress={() => navigate(HOME)} />
        <Action label={bookmarked ? '★' : '☆'} title={bookmarked ? 'Remove bookmark' : 'Bookmark page'} disabled={activeTab?.url === HOME || activeTab?.isPrivate} onPress={toggleBookmark} />
        <Action label="•••" title="Open Flux menu" onPress={() => setPanel('menu')} />
      </View>

      <Modal transparent visible={panel !== null} animationType="slide" onRequestClose={() => setPanel(null)}>
        <Pressable style={styles.modalShade} onPress={() => setPanel(null)}>
          <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{titleForPanel}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setPanel(null)}><Text style={styles.closeText}>×</Text></Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.sheetContent}>
              {panel === 'menu' ? (
                <>
                  <MenuItem icon="▣" title="Tabs" subtitle={`${tabs.length} open`} onPress={() => setPanel('tabs')} />
                  <MenuItem icon="☆" title="Bookmarks" subtitle={`${bookmarks.length} saved`} onPress={() => setPanel('bookmarks')} />
                  <MenuItem icon="◷" title="History" subtitle={`${history.length} recent pages`} onPress={() => setPanel('history')} />
                  <MenuItem icon="＋" title="New tab" onPress={() => addTab()} />
                  <MenuItem icon="◐" title="New private tab" subtitle="Pages stay out of Flux history" onPress={() => addTab(HOME, true)} />
                </>
              ) : null}
              {panel === 'tabs' ? tabs.map((tab) => (
                <View key={tab.id} style={styles.listRow}>
                  <Pressable style={styles.listMain} onPress={() => activateTab(tab.id)}>
                    <Text style={styles.listTitle} numberOfLines={1}>{tab.isPrivate ? 'Private · ' : ''}{tab.title}</Text>
                    <Text style={styles.listUrl} numberOfLines={1}>{tab.url === HOME ? 'Flux Home' : tab.url}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel="Close tab" style={styles.closeTab} onPress={() => closeTab(tab.id)}><Text style={styles.closeTabText}>×</Text></Pressable>
                </View>
              )) : null}
              {panel === 'bookmarks' ? bookmarks.length ? bookmarks.map((item) => <PageItem key={item.url} item={item} onPress={() => openSaved(item.url)} />) : <EmptyState text="Pages you save will appear here." /> : null}
              {panel === 'history' ? (
                <>
                  {history.length ? history.map((item) => <PageItem key={`${item.url}-${item.visitedAt}`} item={item} onPress={() => openSaved(item.url)} />) : <EmptyState text="Pages you visit will appear here. Private tabs are not recorded." />}
                  {history.length ? <Pressable style={styles.clearButton} onPress={clearHistory}><Text style={styles.clearText}>Clear history on this device</Text></Pressable> : null}
                </>
              ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function MenuItem({ icon, title, subtitle, onPress }: { icon: string; title: string; subtitle?: string; onPress: () => void }) {
  return (
    <Pressable style={styles.menuItem} onPress={onPress}>
      <View style={styles.menuIcon}><Text style={styles.menuIconText}>{icon}</Text></View>
      <View style={styles.menuCopy}><Text style={styles.listTitle}>{title}</Text>{subtitle ? <Text style={styles.listUrl}>{subtitle}</Text> : null}</View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

function PageItem({ item, onPress }: { item: SavedPage; onPress: () => void }) {
  return (
    <Pressable style={styles.pageItem} onPress={onPress}>
      <View style={styles.favicon}><Text style={styles.faviconText}>{item.title.slice(0, 1).toUpperCase()}</Text></View>
      <View style={styles.menuCopy}><Text style={styles.listTitle} numberOfLines={1}>{item.title}</Text><Text style={styles.listUrl} numberOfLines={1}>{item.url}</Text></View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

function EmptyState({ text }: { text: string }) {
  return <View style={styles.emptyState}><Text style={styles.emptyIcon}>⌕</Text><Text style={styles.emptyText}>{text}</Text></View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  header: { height: 56, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9 },
  brandMark: { width: 30, height: 30, borderRadius: 10, backgroundColor: palette.accent2, alignItems: 'center', justifyContent: 'center' },
  brandGlyph: { color: '#fff', fontSize: 27, fontWeight: '800', lineHeight: 30, marginTop: -3 },
  brand: { color: palette.text, fontSize: 17, fontWeight: '800', letterSpacing: 0.3 },
  privatePill: { overflow: 'hidden', borderRadius: 8, backgroundColor: '#302a47', color: '#d5caff', paddingHorizontal: 8, paddingVertical: 4, fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
  action: { width: 42, height: 42, borderRadius: 14, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, alignItems: 'center', justifyContent: 'center' },
  actionPrimary: { backgroundColor: palette.accent2, borderColor: palette.accent2 },
  actionDisabled: { opacity: 0.38 },
  actionText: { color: palette.text, fontSize: 21, fontWeight: '700' },
  disabledText: { color: palette.muted },
  pressed: { opacity: 0.7 },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 14, marginTop: 5, marginBottom: 10 },
  addressInput: { flex: 1, height: 46, paddingHorizontal: 16, borderRadius: 15, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, color: palette.text, fontSize: 14 },
  page: { flex: 1, overflow: 'hidden' },
  home: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, overflow: 'hidden' },
  homeGlow: { position: 'absolute', top: '14%', width: 270, height: 270, borderRadius: 135, backgroundColor: '#242343', opacity: 0.5 },
  homeMark: { width: 66, height: 66, borderRadius: 22, backgroundColor: palette.accent2, alignItems: 'center', justifyContent: 'center', marginBottom: 22 },
  homeGlyph: { color: '#fff', fontSize: 58, lineHeight: 64, fontWeight: '800', marginTop: -6 },
  homeTitle: { color: palette.text, fontSize: 25, fontWeight: '800', letterSpacing: -0.6, textAlign: 'center', maxWidth: 360 },
  homeCopy: { color: palette.muted, fontSize: 14, marginTop: 9, textAlign: 'center', lineHeight: 21 },
  quickRow: { width: '100%', maxWidth: 460, flexDirection: 'row', gap: 10, marginTop: 30 },
  quickCard: { flex: 1, height: 86, borderRadius: 18, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center', gap: 8 },
  quickIcon: { color: palette.accent, fontSize: 22 },
  quickLabel: { color: palette.text, fontSize: 11, fontWeight: '700' },
  homeHint: { color: '#73778a', fontSize: 11, marginTop: 22, textAlign: 'center' },
  webHolder: { flex: 1, position: 'relative' },
  webview: { flex: 1, backgroundColor: '#fff' },
  loadingBar: { position: 'absolute', top: 0, left: 0, right: 0, height: 2, backgroundColor: palette.accent },
  errorCard: { position: 'absolute', top: '35%', left: 24, right: 24, padding: 22, borderRadius: 20, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  errorTitle: { color: palette.text, fontWeight: '800', fontSize: 18 },
  errorText: { color: palette.muted, fontSize: 13, lineHeight: 19, marginTop: 8 },
  retryButton: { alignSelf: 'flex-start', paddingVertical: 10, paddingHorizontal: 15, marginTop: 15, borderRadius: 12, backgroundColor: palette.accent2 },
  retryText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  toolbar: { minHeight: 64, paddingHorizontal: 15, paddingTop: 8, paddingBottom: Platform.OS === 'android' ? 8 : 4, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: '#15171e' },
  modalShade: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0009' },
  sheet: { maxHeight: '82%', minHeight: 270, paddingTop: 10, paddingHorizontal: 17, paddingBottom: 26, borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: palette.bg },
  sheetHandle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 3, backgroundColor: '#5a5d6e', marginBottom: 18 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 13, borderBottomWidth: 1, borderBottomColor: palette.border },
  sheetTitle: { color: palette.text, fontSize: 19, fontWeight: '800' },
  closeText: { color: palette.muted, fontSize: 27, paddingHorizontal: 6 },
  sheetContent: { paddingTop: 10, paddingBottom: 15 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 68, borderBottomWidth: 1, borderBottomColor: '#272a34' },
  menuIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#242343' },
  menuIconText: { color: palette.accent, fontSize: 19, fontWeight: '700' },
  menuCopy: { flex: 1 },
  listRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#272a34', minHeight: 67 },
  listMain: { flex: 1, justifyContent: 'center', paddingVertical: 11 },
  listTitle: { color: palette.text, fontSize: 14, fontWeight: '700' },
  listUrl: { color: palette.muted, fontSize: 11, marginTop: 4 },
  chevron: { color: '#7a7e90', fontSize: 25, paddingHorizontal: 7 },
  closeTab: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: palette.raised },
  closeTabText: { color: palette.muted, fontSize: 23, lineHeight: 26 },
  pageItem: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 65, borderBottomWidth: 1, borderBottomColor: '#272a34' },
  favicon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#302f58' },
  faviconText: { color: '#c6beff', fontWeight: '800', fontSize: 15 },
  emptyState: { alignItems: 'center', paddingVertical: 44, paddingHorizontal: 24 },
  emptyIcon: { color: palette.accent, fontSize: 36, marginBottom: 11 },
  emptyText: { color: palette.muted, fontSize: 13, lineHeight: 20, textAlign: 'center' },
  clearButton: { alignSelf: 'center', paddingVertical: 12, paddingHorizontal: 16, marginTop: 16, borderRadius: 12, backgroundColor: palette.raised },
  clearText: { color: '#ff8f9d', fontWeight: '700', fontSize: 12 },
});
