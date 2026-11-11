import { useMemo, useState } from 'react';
import { Button } from '../components/Button';
import { useT, i18n } from '../i18n';
import { parseDiff } from '../state/diff';

export function DiffView({ patch }: { patch: string }) {
  const t = useT();
  const parsed = useMemo(() => parseDiff(patch), [patch]);
  const [page, setPage] = useState(1);
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  let remaining = 20_000 * page;
  let more = false;
  return <div className="diff stack" role="region" aria-label={t('workUi.diff')}>
    {parsed.files.map((file, index) => {
      const limit = Math.max(0, Math.min(file.lines.length, 5000 * page, remaining));
      remaining -= limit;
      if (limit < file.lines.length) more = true;
      const closed = collapsed[index] ?? (parsed.files.length > 10 && index > 0);
      return <section className="diff-file" key={index}>
        <Button aria-expanded={!closed} onClick={() => setCollapsed(value => ({ ...value, [index]: !closed }))}>{file.name || t('workUi.unnamed')}</Button>
        {!closed && <pre className="diff-lines">{file.lines.slice(0, limit).map((line, row) => <span className={`diff-line diff-${line.kind}`} key={row}>
          <span className="diff-number" aria-hidden="true">{line.oldLine === undefined ? '' : new Intl.NumberFormat(i18n.locale, { useGrouping: false }).format(line.oldLine)}</span>
          <span className="diff-number" aria-hidden="true">{line.newLine === undefined ? '' : new Intl.NumberFormat(i18n.locale, { useGrouping: false }).format(line.newLine)}</span>
          {(line.kind === 'added' || line.kind === 'removed') && <span className="sr-only">{t(line.kind === 'added' ? 'workUi.added' : 'workUi.removed')} </span>}
          <span aria-hidden="true">{line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '}</span><span>{line.text}</span>
        </span>)}</pre>}
      </section>;
    })}
    {more && <Button onClick={() => setPage(value => value + 1)}>{t('workUi.showMore')}</Button>}
    {parsed.truncated && <p role="status">{t('workUi.truncated')}</p>}
  </div>;
}
