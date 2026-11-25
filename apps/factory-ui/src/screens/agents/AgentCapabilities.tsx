import { useContext, useState } from 'react';
import { MCP_TOOL_NAMES, type AgentConfig } from '@factory/contracts';
import type { AgentLibrary } from '@/api/agentModels';
import type { ApiClient } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Choice, Field, ReadStatus, useAgentLabels, useRead } from './shared';
import { IntegrationProject, RetryRead, useIntegrationLabels, useProjectIntegrations } from '../integrations/shared';

const builtinTools = MCP_TOOL_NAMES.filter(name => name !== 'task.propose' && name !== 'handoff.submit');

export function AgentCapabilities({ api, library, skills, tools, setSkills, setTools, invalid }: {
  api: ApiClient; library: AgentLibrary | undefined; skills: AgentConfig['skills']; tools: AgentConfig['tools'];
  setSkills: (value: AgentConfig['skills']) => void; setTools: (value: AgentConfig['tools']) => void;
  invalid: (path: string) => string | undefined;
}) {
  const t = useAgentLabels();
  const label = useIntegrationLabels();
  const projectId = useContext(IntegrationProject);
  const integrations = useProjectIntegrations(api, tools === null ? undefined : projectId);
  const [retry, setRetry] = useState(0);
  const result = useRead(library ? null : api.getAgentLibrary, retry);
  const available = (library ?? result.data)?.skills ?? [];
  const byId = new Map(available.map(skill => [skill.id, skill]));
  const assigned = new Set(skills.map(skill => skill.skillId));
  return <div className="space-y-5">
    <section className="space-y-3">
      <h3 className="font-semibold">{t('fields.skills')}</h3>
      <ReadStatus loading={result.loading} error={result.error} missingRoute />
      {result.error && <Button type="button" size="sm" variant="outline" onClick={() => setRetry(value => value + 1)}>{t('reload')}</Button>}
      <Field label={t('librarySkill')} invalid={invalid('skills')}>{props => <Choice {...props} value="" disabled={skills.length >= 40 || !available.length} onChange={event => {
        const skillId = event.target.value;
        if (skillId) setSkills([...skills, { skillId, version: 'latest' }]);
      }}><option value="">—</option>{available.filter(skill => !assigned.has(skill.id)).map(skill => <option key={skill.id} value={skill.id}>{skill.name}{skill.description && ` — ${skill.description}`}</option>)}</Choice>}</Field>
      {!skills.length && <p className="text-sm text-muted-foreground">{t('noSkills')}</p>}
      {skills.map(({ skillId, version }, index) => {
        const item = byId.get(skillId);
        const name = item?.name ?? skillId;
        const setVersion = (next: typeof version) => setSkills(skills.map(skill => skill.skillId === skillId ? { skillId, version: next } : skill));
        return <div key={skillId} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_auto]">
          <div className="min-w-0 break-words text-sm"><strong>{name}</strong>{item && <p className="text-muted-foreground">{item.description}</p>}</div>
          <Button type="button" size="sm" variant="ghost" aria-label={`${t('remove')}: ${name}`} onClick={() => setSkills(skills.filter(skill => skill.skillId !== skillId))}>{t('remove')}</Button>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <Button type="button" size="sm" variant={version === 'latest' ? 'secondary' : 'outline'} aria-pressed={version === 'latest'} onClick={() => setVersion('latest')}>{t('latest')}{item && ` (r${item.latestVersion})`}</Button>
            {version === 'latest' ? <Button type="button" size="sm" variant="outline" onClick={() => setVersion(item?.latestVersion ?? 1)}>{t('pinVersion')}</Button> :
              <Input type="number" className="w-28" min={1} max={item?.latestVersion} aria-label={t('skillVersion', { name })} aria-invalid={!!invalid(`skills.${index}`)} value={Number.isNaN(version) ? '' : version} onChange={event => setVersion(event.target.valueAsNumber)} />}
          </div>
        </div>;
      })}
    </section>
    <section className="space-y-3">
      <h3 className="font-semibold">{t('fields.tools')}</h3>
      <label className="flex items-center gap-2 text-sm"><Switch checked={tools === null} onCheckedChange={checked => setTools(checked ? null : [])} />{t('defaultTools')}</label>
      {invalid('tools') && <p className="text-sm text-destructive">{invalid('tools')}</p>}
      {tools !== null && <><RetryRead error={integrations.error} loading={integrations.loading} retry={integrations.refresh} />
        {tools.map((grant, index) => {
          const change = (patch: Partial<typeof grant>) => setTools(tools.map((item, position) => position === index ? { ...item, ...patch } : item));
          return <div key={index} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_auto]">
            <Input className="col-span-2 sm:col-span-1" aria-label={`${t('toolPattern')} ${index + 1}`} aria-invalid={!!invalid(`tools.${index}`)} value={grant.tool} placeholder="knowledge.*" maxLength={120} onChange={event => change({ tool: event.target.value })} />
            <Choice aria-label={`${t('toolMode')} ${index + 1}`} value={grant.mode} onChange={event => change({ mode: event.target.value === 'deny' ? 'deny' : event.target.value === 'ask' ? 'ask' : 'allow' })}>
              <option value="allow">{t('allow')}</option><option value="ask">{label('ask')}</option><option value="deny">{t('deny')}</option>
            </Choice>
            <Button type="button" variant="ghost" aria-label={`${t('remove')} ${index + 1}`} onClick={() => setTools(tools.filter((_, position) => position !== index))}>{t('remove')}</Button>
            <Choice className="col-span-full" aria-label={`${label('pickTool')} ${index + 1}`} value="" onChange={event => { if (event.target.value) change({ tool: event.target.value }); }}>
              <option value="">{label('pickTool')}</option>
              <optgroup label={label('builtinTools')}>{builtinTools.map(name => <option key={name} value={name}>{name}</option>)}</optgroup>
              {integrations.data?.map(integration => {
                const prefix = `${integration.kind === 'http-api' ? 'http' : 'ext'}.${integration.name}.`;
                return <optgroup key={integration.id} label={integration.name}>
                  {integration.kind !== 'http-api' && <option value={`${prefix}*`}>{prefix}*</option>}
                  {integration.tools.map(tool => <option key={tool.name} value={`${prefix}${tool.name}`}>{prefix}{tool.name}</option>)}
                </optgroup>;
              })}
            </Choice>
            {grant.mode === 'ask' && <p className="col-span-full text-xs text-muted-foreground">{label('askHelp')}</p>}
          </div>;
        })}<Button type="button" variant="outline" disabled={tools.length >= 64} onClick={() => setTools([...tools, { tool: '', mode: 'allow' }])}>{t('add')}</Button></>}
    </section>
  </div>;
}
