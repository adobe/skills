import '@react-spectrum/s2/page.css';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes, useHref, useLocation, useNavigate, type NavigateOptions } from 'react-router-dom';
import { Provider } from '@react-spectrum/s2/Provider';
import { ActionButton } from '@react-spectrum/s2/ActionButton';
import { SideNav, SideNavItem, SideNavItemContent, SideNavItemLink, SideNavSection, SideNavHeader, Text } from '@react-spectrum/s2/SideNav';
import { ToastContainer } from '@react-spectrum/s2/Toast';
import { Tooltip, TooltipTrigger } from '@react-spectrum/s2/Tooltip';
import { AIButton } from '@react-spectrum/ai';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import Contrast from '@react-spectrum/s2/icons/Contrast';
import Home from '@react-spectrum/s2/icons/Home';
import TemplateIcon from '@react-spectrum/s2/icons/Template';
import LayoutIcon from '@react-spectrum/s2/icons/Layout';
import WebPage from '@react-spectrum/s2/icons/WebPage';
import ArrowCurved from '@react-spectrum/s2/icons/ArrowCurved';
import UnLink from '@react-spectrum/s2/icons/UnLink';
import InfoCircle from '@react-spectrum/s2/icons/InfoCircle';
import Bookmark from '@react-spectrum/s2/icons/Bookmark';
import Shapes from '@react-spectrum/s2/icons/Shapes';
import PluginGear from '@react-spectrum/s2/icons/PluginGear';
import Plugin from '@react-spectrum/s2/icons/Plugin';
import ChartBarVert from '@react-spectrum/s2/icons/ChartBarVert';
import Translate from '@react-spectrum/s2/icons/Translate';
import DataSettings from '@react-spectrum/s2/icons/DataSettings';
import HelpCircle from '@react-spectrum/s2/icons/HelpCircle';
import FileText from '@react-spectrum/s2/icons/FileText';
import Chat from './Chat';
import About from './pages/About';
import { BlockDetail, Blocks } from './pages/Blocks';
import Components from './pages/Components';
import { Broken, Redirects } from './pages/Lists';
import Overview from './pages/Overview';
import { TemplateDetail, Templates } from './pages/Templates';
import UrlDetail from './pages/UrlDetail';
import Urls from './pages/Urls';
import { ViewBuilder, ViewPage } from './pages/Views';
import { FeatureDetail, Features, ImplementationOverview, SpecPage } from './pages/Implementation';
import { DataConfig, Locales, Martech } from './pages/ImplData';
import Questions from './pages/Questions';
import { listViews, onViewsChange } from './myviews';
import { onAsk } from './ask';
import { Tour } from './tour';
import { SiteProvider, loadSite, useSite, type SiteInfo } from './site';

// Type the routerOptions prop of every S2 link-capable component.
declare module '@react-spectrum/s2/Provider' {
  interface RouterConfig { routerOptions: NavigateOptions }
}

type Scheme = 'light' | 'dark';
const SCHEME_KEY = 'spec-viewer-scheme';

function useColorScheme(): [Scheme, () => void] {
  const [scheme, setScheme] = useState<Scheme>(() => (localStorage.getItem(SCHEME_KEY) as Scheme | null)
    ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  useEffect(() => { document.documentElement.dataset.colorScheme = scheme; }, [scheme]);
  // Sites Optimizer frame: gray page (layer 1) under white section cards
  useEffect(() => { document.documentElement.dataset.background = 'layer-1'; }, []);
  const toggle = () => setScheme((s) => { const n = s === 'dark' ? 'light' : 'dark'; localStorage.setItem(SCHEME_KEY, n); return n; });
  return [scheme, toggle];
}

const NAV = [
  { href: '/', label: 'Overview', icon: Home },
  { href: '/templates', label: 'Templates', icon: TemplateIcon },
  { href: '/blocks', label: 'Blocks', icon: LayoutIcon },
  { href: '/urls', label: 'URLs', icon: WebPage },
  { href: '/redirects', label: 'Redirects', icon: ArrowCurved },
  { href: '/broken', label: '404s', icon: UnLink },
  { href: '/about', label: 'Method and caveats', icon: InfoCircle },
];

const IMPL_NAV = [
  { href: '/implementation', label: 'Implementation', icon: PluginGear },
  { href: '/features', label: 'Dynamic features', icon: Plugin },
  { href: '/martech', label: 'Martech', icon: ChartBarVert },
  { href: '/locales', label: 'Multi-language', icon: Translate },
  { href: '/data', label: 'Data and configuration', icon: DataSettings },
  { href: '/questions', label: 'Open questions', icon: HelpCircle },
  { href: '/spec', label: 'Migration spec', icon: FileText },
];

const shell = style({
  display: 'grid',
  gridTemplateColumns: {
    default: 'minmax(0, 1fr)',
    lg: { default: '232px minmax(0, 1fr)', isChatOpen: '232px minmax(0, 1fr) 400px' },
  },
});
const sideColumn = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  paddingX: 8,
  paddingBottom: 16,
  position: { default: 'static', lg: 'sticky' },
  top: 0,
  height: { default: 'auto', lg: 'screen' },
  overflowY: 'auto',
});
const chatColumn = style({
  position: { default: 'fixed', lg: 'sticky' },
  inset: { default: 0, lg: 'auto' },
  top: 0,
  zIndex: { default: 10, lg: 1 },
  height: 'screen',
  padding: { default: 0, lg: 8 },
  paddingStart: { default: 0, lg: 0 },
  display: 'flex',
  minWidth: 0,
});
const chatCard = style({
  flexGrow: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  backgroundColor: 'elevated',
  borderRadius: { default: 'none', lg: 'xl' },
  borderWidth: { default: 0, lg: 1 },
  borderStyle: 'solid',
  borderColor: 'gray-200',
});

function Shell() {
  const site = useSite();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [scheme, toggleScheme] = useColorScheme();
  const [chat, setChat] = useState(() => window.innerWidth > 1300);
  const [pending, setPending] = useState<string | null>(null);
  const [views, setViews] = useState(listViews);
  useEffect(() => onViewsChange(() => setViews(listViews())), []);
  useEffect(() => onAsk((q) => { setChat(true); setPending(q); }), []);
  const top = `/${pathname.split('/')[1] ?? ''}`;
  const selectedRoute = top === '/views' ? pathname : top;

  return (
    <Provider router={{ navigate, useHref }} colorScheme={scheme} locale="en-US">
      <ToastContainer />
      <Tour />
      <header data-tour="header" className={style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, height: 56, paddingX: 16 })}>
        <div className={style({ display: 'flex', alignItems: 'baseline', gap: 12, minWidth: 0 })}>
          <span className={style({ font: 'title' })}>Migration scope</span>
          <span className={style({ font: 'body-sm', color: 'neutral-subdued', truncate: true })}>{`${site.scopeLabel} to Edge Delivery Services`}</span>
        </div>
        <div className={style({ display: 'flex', alignItems: 'center', gap: 8 })}>
          {!chat && <span data-tour="chat-button"><AIButton size="S" onPress={() => setChat(true)}>Ask the scope</AIButton></span>}
          <TooltipTrigger>
            <ActionButton isQuiet aria-label={scheme === 'dark' ? 'Use light theme' : 'Use dark theme'} onPress={toggleScheme}><Contrast /></ActionButton>
            <Tooltip>{scheme === 'dark' ? 'Use light theme' : 'Use dark theme'}</Tooltip>
          </TooltipTrigger>
        </div>
      </header>
      <div className={shell({ isChatOpen: chat })}>
        <aside className={sideColumn}>
          <nav aria-label="Scope explorer" data-tour="nav">
            <SideNav aria-label="Scope explorer" selectedRoute={selectedRoute}>
              <SideNavSection id="explore" aria-label="Explore">
                {NAV.map(({ href, label, icon: Icon }) => (
                  <SideNavItem key={href} id={href} href={href} textValue={label}>
                    <SideNavItemContent><SideNavItemLink><Icon /><Text>{label}</Text></SideNavItemLink></SideNavItemContent>
                  </SideNavItem>
                ))}
              </SideNavSection>
              <SideNavSection id="implementation">
                <SideNavHeader>Implementation</SideNavHeader>
                {IMPL_NAV.map(({ href, label, icon: Icon }) => (
                  <SideNavItem key={href} id={href} href={href} textValue={label}>
                    <SideNavItemContent><SideNavItemLink><Icon /><Text>{label}</Text></SideNavItemLink></SideNavItemContent>
                  </SideNavItem>
                ))}
              </SideNavSection>
              {views.length > 0 ? (
                <SideNavSection id="my-views">
                  <SideNavHeader>My views</SideNavHeader>
                  {views.map((v) => (
                    <SideNavItem key={v.id} id={`/views/${v.id}`} href={`/views/${v.id}`} textValue={v.title}>
                      <SideNavItemContent><SideNavItemLink><Bookmark /><Text>{v.title}</Text></SideNavItemLink></SideNavItemContent>
                    </SideNavItem>
                  ))}
                </SideNavSection>
              ) : null}
              <SideNavSection id="design">
                <SideNavHeader>Design system</SideNavHeader>
                <SideNavItem id="/components" href="/components" textValue="Custom components">
                  <SideNavItemContent><SideNavItemLink><Shapes /><Text>Custom components</Text></SideNavItemLink></SideNavItemContent>
                </SideNavItem>
              </SideNavSection>
            </SideNav>
          </nav>
          {views.length === 0 && (
            <p data-tour="my-views" className={style({ font: 'detail-sm', color: 'neutral-subdued', margin: 0, paddingX: 12 })}>
              My views: when an answer in the chat is better as a page, the chat offers to build one and saves it here.
            </p>
          )}
          <p className={style({ font: 'detail-sm', color: 'neutral-subdued', marginTop: 'auto', marginBottom: 0, paddingX: 12 })}>
            {`Migration scoping pilot. Data: live site crawl, link check${site.rum ? `, and ${site.meta.rum_window ?? '90 days'} of real-user telemetry` : ''}. Block mapping and reuse verdicts are a proposal.`}
          </p>
        </aside>
        <main className={style({ minWidth: 0, paddingStart: { default: 16, lg: 8 }, paddingEnd: { default: 16, lg: 24 }, paddingBottom: 64 })}>
          <div className={style({ maxWidth: 1360, marginX: 'auto' })}>
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/urls" element={<Urls />} />
              <Route path="/urls/:id" element={<UrlDetail />} />
              <Route path="/templates" element={<Templates />} />
              <Route path="/templates/:id" element={<TemplateDetail />} />
              <Route path="/blocks" element={<Blocks />} />
              <Route path="/blocks/:name" element={<BlockDetail />} />
              <Route path="/redirects" element={<Redirects />} />
              <Route path="/broken" element={<Broken />} />
              <Route path="/about" element={<About />} />
              <Route path="/components" element={<Components />} />
              <Route path="/implementation" element={<ImplementationOverview />} />
              <Route path="/features" element={<Features />} />
              <Route path="/features/:id" element={<FeatureDetail />} />
              <Route path="/martech" element={<Martech />} />
              <Route path="/locales" element={<Locales />} />
              <Route path="/data" element={<DataConfig />} />
              <Route path="/questions" element={<Questions />} />
              <Route path="/spec" element={<SpecPage />} />
              <Route path="/views/new" element={<ViewBuilder />} />
              <Route path="/views/:id" element={<ViewPage />} />
            </Routes>
          </div>
        </main>
        {chat && (
          <aside className={chatColumn} aria-label="Ask the scope" data-tour="chat">
            <div className={chatCard}><Chat onClose={() => setChat(false)} pending={pending} onPendingHandled={() => setPending(null)} /></div>
          </aside>
        )}
      </div>
    </Provider>
  );
}

// Title and favicon letter follow the site name from meta.
function brand(site: SiteInfo) {
  document.title = site.name === 'the site' ? 'Migration scope' : `${site.name} migration scope`;
  const letter = (site.name === 'the site' ? 'M' : site.name.replace(/^www\./i, '').charAt(0).toUpperCase()).replace(/[<>&'"]/g, '') || 'M';
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='6' fill='#3B63FB'/><text x='16' y='22' font-size='16' text-anchor='middle' font-family='Arial' font-weight='700' fill='white'>${letter}</text></svg>`;
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (link) link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

void loadSite().then((site) => {
  brand(site);
  createRoot(document.getElementById('root')!).render(<StrictMode><SiteProvider site={site}><BrowserRouter><Shell /></BrowserRouter></SiteProvider></StrictMode>);
});
