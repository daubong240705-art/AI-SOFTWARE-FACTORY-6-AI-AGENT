import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleCheck, CircleMinus, CircleX, Copy, FlaskConical, RefreshCw } from 'lucide-react';
import { createApiClient } from '@/api/client';
import type { DoctorCheck, DoctorReport } from '@/api/systemModels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { i18n, useT } from '@/i18n';
import { doctorMessagesEn } from '@/i18n/extra.en';
import { SystemCard } from './SystemCard';

const groups = [
  { name: 'system', ids: ['D-NODE', 'D-STATE', 'D-GIT', 'D-PORT', 'D-UI', 'D-BACKUP'] },
  { name: 'model', ids: ['D-MODEL', 'D-CA'] },
  { name: 'agent', ids: ['D-CODEX', 'D-CLAUDE', 'D-BWRAP'] },
  { name: 'network', ids: ['D-LAN'] },
];
const statusIcons = { pass: CircleCheck, fail: CircleX, skip: CircleMinus };
const statusColors = { pass: 'text-ok', fail: 'text-destructive', skip: 'text-muted-foreground' };

function DoctorText({ text }: { text: string }) {
  if (i18n.locale === 'vi' || /^(?:Node\.js v[\d.]+\.|HTTP \d+)$/.test(text)) return <>{text}</>;
  const translation = Object.hasOwn(doctorMessagesEn, text) ? doctorMessagesEn[text] : undefined;
  return translation ?? <span lang="vi">{text}</span>;
}

function commandFix(fix: string) {
  const candidate = fix.trim().replace(/^Ch\u1ea1y:\s*/u, '');
  if (/^factory setup\.?$/.test(candidate)) return { command: 'factory setup', showFix: false };
  if (/^chmod 600 (?:[^\s;&|<>`]+|"[^"\r\n]+"|'[^'\r\n]+')$/.test(candidate)) return { command: candidate, showFix: false };
  const cli = /^Ch\u1ea1y (codex login status|claude auth status) v\u00e0 /.exec(fix);
  return cli?.[1] ? { command: cli[1], showFix: true } : undefined;
}

function CopyCommand({ command }: { command: string }) {
  const t = useT();
  const [result, setResult] = useState<'copied' | 'copyFailed'>();
  return <div className="space-y-1">
    <div className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-border bg-muted p-2">
      <pre className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]"><code>{command}</code></pre>
      <Button type="button" size="xs" variant="outline" onClick={async () => {
        try { await navigator.clipboard.writeText(command); setResult('copied'); }
        catch { setResult('copyFailed'); }
      }}><Copy aria-hidden="true" />{t('setupUi.copy')}</Button>
    </div>
    <span role="status" className="block text-xs text-muted-foreground empty:hidden">{result && t(`setupUi.${result}`)}</span>
  </div>;
}

function CheckRow({ check }: { check: DoctorCheck }) {
  const t = useT();
  const Icon = statusIcons[check.status];
  const command = check.fix ? commandFix(check.fix) : undefined;
  return <li className="flex min-w-0 gap-3 px-3 py-3 text-sm">
    <Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${statusColors[check.status]}`} />
    <div className="min-w-0 flex-1 space-y-1 [overflow-wrap:anywhere]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <code className="text-muted-foreground">{check.id}</code>
        <span>{t(`setupUi.status.${check.status}`)}</span>
        <Badge variant={check.level === 'required' ? 'secondary' : 'outline'}>{t(`setupUi.level.${check.level}`)}</Badge>
      </div>
      <p><DoctorText text={check.summary} /></p>
      {check.detail && <p className="text-muted-foreground"><DoctorText text={check.detail} /></p>}
      {check.fix && <div className="space-y-1">
        <p className="text-muted-foreground">{t('setupUi.fix')}{(!command || command.showFix) && <> <DoctorText text={check.fix} /></>}</p>
        {command && <CopyCommand key={command.command} command={command.command} />}
      </div>}
    </div>
  </li>;
}

export function SetupPanel() {
  const t = useT();
  const [api] = useState(() => createApiClient({ baseUrl: import.meta.env.DEV ? '/api' : '' }));
  const [report, setReport] = useState<DoctorReport>();
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);
  const pending = useRef<AbortController | null>(null);

  const refresh = useCallback(async (checkModel = false) => {
    if (pending.current) return;
    const request = new AbortController();
    pending.current = request;
    setBusy(true);
    setFailed(false);
    try {
      const response = await api.systemDoctor(checkModel, request.signal);
      if (!request.signal.aborted) setReport(response.report);
    } catch {
      if (!request.signal.aborted) setFailed(true);
    } finally {
      if (pending.current === request) { pending.current = null; setBusy(false); }
    }
  }, [api]);

  useEffect(() => {
    void refresh();
    return () => { pending.current?.abort(); pending.current = null; };
  }, [refresh]);

  const required = report?.checks.filter(check => check.level === 'required' && check.status !== 'pass').length ?? 0;
  const overall = busy ? t('setupUi.loading') : failed ? t('setupUi.unavailable') : !report?.checks.length ? t('setupUi.empty')
    : report.ok ? t('setupUi.ready') : t('setupUi.required').replace('{count}', String(required));
  const knownIds = new Set(groups.flatMap(group => group.ids));
  const sections = [
    ...groups.map(group => ({ name: group.name, checks: report?.checks.filter(check => group.ids.includes(check.id)) ?? [] })),
    { name: 'other', checks: report?.checks.filter(check => !knownIds.has(check.id)) ?? [] },
  ];
  return <SystemCard anchor="setup" title={t('setupUi.title')} status={overall} actions={<div className="flex min-w-0 flex-wrap items-center gap-2">
    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void refresh()}><RefreshCw aria-hidden="true" />{t('setupUi.refresh')}</Button>
    <Button type="button" size="sm" variant="outline" className="h-auto min-h-8 max-w-full whitespace-normal text-left" disabled={busy} onClick={() => {
      if (window.confirm(t('setupUi.confirmModel'))) void refresh(true);
    }}><FlaskConical aria-hidden="true" />{t('setupUi.checkModel')}</Button>
  </div>}>
    {failed && <p role="alert" className="text-sm text-muted-foreground">{t(report?.checks.length ? 'setupUi.stale' : 'setupUi.error')}</p>}
    <div aria-busy={busy} className="grid min-w-0 items-start gap-4 xl:grid-cols-2">
      {sections.filter(section => section.checks.length).map(section => <section key={section.name} className="min-w-0 rounded-lg border border-border">
        <h3 className="border-b border-border px-3 py-2 text-sm font-semibold">{t(`setupUi.groups.${section.name}`)}</h3>
        <ul className="divide-y divide-border">{section.checks.map((check, index) => <CheckRow key={`${check.id}:${index}`} check={check} />)}</ul>
      </section>)}
    </div>
  </SystemCard>;
}
