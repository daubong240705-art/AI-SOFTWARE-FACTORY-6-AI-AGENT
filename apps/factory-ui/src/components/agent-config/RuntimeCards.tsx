import { useId } from 'react';
import type { AgentClis, AgentCli } from '@/api/agentRuntime';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';

export type RuntimeChoice = 'inherit' | 'native-opencode' | 'codex' | 'claude';
export const cliName = (cli: 'codex' | 'claude') => cli === 'codex' ? 'Codex CLI' : 'Claude Code CLI';
export function cliBlockReason(data: AgentClis | null, cli: 'codex' | 'claude') {
  if (!data) return 'agentClis.unavailable';
  if (!data.enabled) return 'agentConfig.cliDisabled';
  const status = data.clis.find(value => value.cli === cli);
  if (!status || !status.installed || status.login === 'missing') return 'agentConfig.cliMissing';
  return null;
}
export function CliStatus({ status }: { status: AgentCli | undefined }) {
  const t = useT();
  const key = !status ? 'unknown' : !status.installed ? 'notInstalled' : status.login === 'ok' ? 'loggedIn' : status.login === 'missing' ? 'notLoggedIn' : 'unknown';
  return <span className="inline-flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
    <span aria-hidden="true" className={cn('size-1.5 rounded-full', key === 'loggedIn' ? 'bg-ok' : key === 'notLoggedIn' ? 'bg-info' : 'bg-muted-foreground')} />
    {t(`agentClis.${key}`)}{status?.version && <span className="font-mono">{status.version}</span>}
  </span>;
}
export function RuntimeCards({ value, onChange, packRuntime, data, disabled }: {
  value: RuntimeChoice; onChange: (value: RuntimeChoice) => void; packRuntime: string | null;
  data: AgentClis | null; disabled: boolean;
}) {
  const t = useT(); const id = useId();
  return <div className="space-y-2"><Label>{t('agentConfig.runtime')}</Label>
    <RadioGroup value={value} onValueChange={next => onChange(next as RuntimeChoice)} disabled={disabled} aria-label={t('agentConfig.runtime')} className="gap-2">
      {/* OpenCode is offered only on a Host that runs it, or kept visible (and locked) while a seat still uses it. */}
      {(['inherit', 'native-opencode', 'codex', 'claude'] as const).filter(choice => choice !== 'native-opencode' || data?.opencode !== false || value === choice).map(choice => {
        const cli = choice === 'codex' || choice === 'claude' ? choice : null;
        const reason = cli ? cliBlockReason(data, cli) : choice === 'native-opencode' && data?.opencode === false ? 'agentConfig.opencodeOff' : null;
        return <div key={choice} className={cn('rounded-xl border border-border p-3', value === choice && 'bg-secondary', (disabled || reason) && 'opacity-60')}>
          <div className="flex items-start gap-3"><RadioGroupItem id={`${id}-${choice}`} value={choice} disabled={disabled || Boolean(reason)} className="mt-0.5" />
            <div className="min-w-0 space-y-1"><Label htmlFor={`${id}-${choice}`} className="text-sm leading-relaxed">{t(`agentConfig.runtimes.${choice}`)}</Label>
              {choice === 'inherit' && (data?.defaultCli && packRuntime === 'native-opencode'
                ? <p className="text-xs text-muted-foreground">{t('agentConfig.hostDefault')} <span className="font-medium text-foreground">{cliName(data.defaultCli)}</span></p>
                : <p className="text-xs text-muted-foreground">{t('agentConfig.packRuntime')}: <span className="font-mono">{packRuntime ?? t('agentClis.unknown')}</span></p>)}
              {!cli && reason && <p className="text-xs text-muted-foreground">{t(reason)}</p>}
              {cli && <><CliStatus status={data?.clis.find(item => item.cli === cli)} />{reason && <p className="text-xs text-muted-foreground">{t(reason)}</p>}
                <p className="text-xs text-info underline underline-offset-4">{t('agentConfig.installHint').replace('{command}', cli === 'codex' ? 'codex login' : 'claude auth login')}</p></>}
            </div>
          </div>
        </div>;
      })}
    </RadioGroup>
  </div>;
}
