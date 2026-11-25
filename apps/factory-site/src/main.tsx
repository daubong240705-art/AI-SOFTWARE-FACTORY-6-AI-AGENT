import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Menu } from 'lucide-react';
import { Docs } from './docs';
import { Landing, Try } from './landing';
import { External, Mochi, repo, text, type Lang } from './shared';
import './styles.css';

function initialLang(): Lang {
  try { return localStorage.getItem('factory-site-lang') === 'en' ? 'en' : 'vi'; }
  catch { return 'vi'; }
}

function App() {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [hash, setHash] = useState(() => location.hash || '#/');
  const [menu, setMenu] = useState(false);
  const previousRoute = useRef('');
  const main = useRef<HTMLElement>(null);
  const [route, anchor] = hash.slice(1).split('#', 2);
  const isDocs = /^\/docs(?:\/|$)/.test(route);
  const isTry = route === '/try';
  const landing = route === '/';
  const slug = route.slice('/docs/'.length) || 'introduction';

  useEffect(() => {
    const changed = () => { setHash(location.hash || '#/'); setMenu(false); };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    try { localStorage.setItem('factory-site-lang', lang); } catch {}
  }, [lang]);

  useEffect(() => {
    if (!isDocs) document.title = text(lang, isTry ? 'Dùng thử · Factory' : 'Factory — Đội AI trên máy của bạn', isTry ? 'Try Factory · Factory' : 'Factory — Your AI team, on your machine');
  }, [isDocs, isTry, lang]);

  useEffect(() => {
    const changedPage = previousRoute.current !== '' && previousRoute.current !== route;
    previousRoute.current = route;
    if (anchor) document.getElementById(anchor)?.scrollIntoView();
    else window.scrollTo(0, 0);
    if (changedPage) main.current?.focus({ preventScroll: true });
  }, [route, anchor]);

  return <>
    <a className="skip-link" href={hash} onClick={(event) => { event.preventDefault(); main.current?.focus(); }}>{text(lang, 'Đến nội dung', 'Skip to content')}</a>
    <header className="site-header">
      <div className="wrap header-inner">
        <a className="brand" href="#/" aria-label="Factory"><Mochi />Factory<span>.</span></a>
        <button type="button" className="menu-toggle" aria-controls="site-nav" aria-expanded={menu} aria-label={text(lang, 'Menu điều hướng', 'Navigation menu')} onClick={() => setMenu(!menu)}><Menu size={22} aria-hidden="true" /></button>
        <nav id="site-nav" className={menu ? 'site-nav open' : 'site-nav'} aria-label={text(lang, 'Điều hướng chính', 'Main navigation')} onClick={(event) => { if ((event.target as HTMLElement).closest('a')) setMenu(false); }}>
          <a href="#/#features">{text(lang, 'Tính năng', 'Features')}</a>
          <a href="#/#how">{text(lang, 'Cách hoạt động', 'How it works')}</a>
          <a href="#/#game-team">{text(lang, 'Đội làm game', 'Game team')}</a>
          <a href="#/docs/introduction" aria-current={isDocs ? 'page' : undefined}>Docs</a>
          <External href={repo}>GitHub</External>
          <a className="nav-try" href="#/try" aria-current={isTry ? 'page' : undefined}>{text(lang, 'Dùng thử', 'Try it')}</a>
        </nav>
        <button type="button" className="lang-toggle" lang={lang === 'vi' ? 'en' : 'vi'} onClick={() => setLang(lang === 'vi' ? 'en' : 'vi')} aria-label={text(lang, 'Read in English', 'Đọc bằng tiếng Việt')}>{lang === 'vi' ? 'EN' : 'VI'}</button>
      </div>
    </header>
    <main id="main" tabIndex={-1} ref={main}>
      {landing ? <Landing lang={lang} /> : isDocs ? <Docs key={slug} slug={slug} lang={lang} /> : isTry ? <Try lang={lang} /> :
        <div className="wrap not-found"><h1>{text(lang, 'Không tìm thấy trang', 'Page not found')}</h1><a href="#/">{text(lang, 'Về trang chủ', 'Back to home')}</a></div>}
    </main>
    <footer className="site-footer">
      <div className="wrap footer-inner">
        <a className="brand" href="#/"><Mochi />Factory<span>.</span></a>
        <p>{text(lang, 'Đội AI của bạn. Trên máy của bạn.', 'Your AI team. On your machine.')}</p>
        <div><a href="#/docs/introduction">Docs</a><External href={`${repo}/blob/main/LICENSE`}>MIT</External><External href={repo}>GitHub</External></div>
      </div>
    </footer>
  </>;
}

createRoot(document.getElementById('root')!).render(<App />);
