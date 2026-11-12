import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import type { PackDetail, PackSeat } from '@/api/agentProfileModels';
import { useT } from '@/i18n';
import { MarkdownDisclosure } from './MarkdownDisclosure';
import { ProfileMarkdown } from './ProfileMarkdown';

export function AgentProfileContent({ pack, seat, packVersion }: { pack: PackDetail; seat: PackSeat; packVersion: string | null }) {
  const t = useT();
  const conventionHeading = /^##[\t ]+Factory conventions[\t ]*\r?$/m.exec(seat.profile);
  const profile = conventionHeading ? seat.profile.slice(0, conventionHeading.index) : seat.profile;
  const conventions = conventionHeading ? seat.profile.slice(conventionHeading.index + conventionHeading[0].length).trim() : null;
  return <div className="space-y-5">
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2"><p className="text-base font-medium">{seat.role}</p>{seat.isLead && <Badge variant="secondary">{t('team.lead')}</Badge>}</div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>{t('team.runtime')}: <span className="font-mono">{seat.runtime || t('agentProfile.unspecified')}</span></span><span>{t('team.slots')}: {seat.slots}</span></p>
    </div>
    <Card className="gap-0 rounded-lg border-border bg-card py-0 shadow-none"><CardContent className="space-y-2 p-4">
      <p className="text-sm font-medium [overflow-wrap:anywhere]">{pack.name} <span className="font-mono text-xs text-muted-foreground">{pack.version}</span></p>
      <p className="text-xs text-muted-foreground">{t('agentProfile.digest')}: <span className="font-mono" title={pack.digest}>{pack.digest.slice(0, 8)}</span></p>
      {packVersion && packVersion !== pack.version && <p className="text-xs leading-relaxed text-muted-foreground">{t('agentProfile.versionMismatch').replace('{version}', packVersion)}</p>}
    </CardContent></Card>
    <Separator />
    {profile.trim() ? <ProfileMarkdown content={profile} /> : <p className="text-sm text-muted-foreground">{t('agentProfile.emptyProfile')}</p>}
    {conventions !== null && <div className="border-t border-border pt-4"><MarkdownDisclosure label={t('agentProfile.conventions')} content={conventions} /></div>}
  </div>;
}

export function AgentSkillsContent({ skills }: { skills: PackDetail['skills'] }) {
  const t = useT();
  return <div className="space-y-4">
    <p className="text-xs text-muted-foreground">{t('agentProfile.teamWide')}</p>
    {!skills.length && <p className="text-sm text-muted-foreground">{t('agentProfile.emptySkills')}</p>}
    {skills.map(skill => <Card key={skill.name} className="gap-0 rounded-lg border-border bg-card py-0 shadow-none"><CardContent className="space-y-3 p-5">
      <div className="space-y-1"><h3 className="font-mono text-sm font-medium [overflow-wrap:anywhere]">{skill.name}</h3><p className="text-sm leading-relaxed text-muted-foreground">{skill.description}</p></div>
      <MarkdownDisclosure label={t('agentProfile.skillContent')} content={skill.content.replace(/^\uFEFF?---[\t ]*\r?\n[\s\S]*?\r?\n---[\t ]*(?:\r?\n|$)/, '').trim()} />
    </CardContent></Card>)}
  </div>;
}
