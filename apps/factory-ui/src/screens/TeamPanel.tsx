import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '../i18n';
import type { Store } from '../state/store';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ErrorNotice } from '../components/ErrorNotice';

export function TeamPanel({ store }: { store: Store }) {
  const t = useT();
  const { team, loading, errors } = store.useStoreSelector((state) => state);
  if (loading.team && !team) {
    return <Card className="border-border p-5 shadow-none"><div role="status" aria-label={t('viewStates.loading')} className="space-y-3"><span className="sr-only">{t('viewStates.loading')}</span><Skeleton className="h-6 w-2/5" /><Skeleton className="h-4 w-full" /><Skeleton className="h-24 w-full" /></div></Card>;
  }

  return (
    <div className="min-w-0 space-y-5">
      {errors.team && <ErrorNotice error={errors.team} />}
      {!team ? !errors.team && (
        <Card className="border-border p-5 shadow-none"><p className="text-sm text-muted-foreground">{t('empty.team')}</p></Card>
      ) : (
        <Card className="min-w-0 gap-0 overflow-hidden border-border py-0 shadow-none">
          <CardHeader className="gap-3 px-5 py-5">
            <h2 className="font-display text-lg font-semibold [overflow-wrap:anywhere]">{team.team.name}</h2>
            <Badge variant="secondary">{t(`team.states.${team.engagement.state}`)}</Badge>
          </CardHeader>
          <Separator />
          <CardContent className="space-y-6 px-5 py-5">
            <section className="space-y-3">
              <h3 className="font-display text-base font-semibold">{t('team.engagement')}</h3>
              <dl className="grid gap-4 text-sm sm:grid-cols-3">
                <div className="space-y-1"><dt className="text-muted-foreground">{t('team.priority')}</dt><dd className="font-medium tabular-nums">{team.engagement.priority}</dd></div>
                <div className="space-y-1"><dt className="text-muted-foreground">{t('team.maxConcurrent')}</dt><dd className="font-medium tabular-nums">{team.engagement.maxConcurrent}</dd></div>
                <div className="space-y-1"><dt className="text-muted-foreground">{t('team.state')}</dt><dd>{t(`team.states.${team.engagement.state}`)}</dd></div>
              </dl>
            </section>
            <Separator />
            <section className="min-w-0 space-y-3">
              <h3 className="font-display text-base font-semibold">{t('team.seats')}</h3>
              {team.seats.length === 0 ? <p className="text-sm text-muted-foreground">{t('team.emptySeats')}</p> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('team.seats')}</TableHead>
                      <TableHead>{t('team.role')}</TableHead>
                      <TableHead>{t('team.runtime')}</TableHead>
                      <TableHead className="text-right">{t('team.slots')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {team.seats.map((seat) => (
                      <TableRow key={seat.id}>
                        <TableCell className="whitespace-normal">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{seat.name}</span>
                            {seat.isLead && <Badge variant="secondary">{t('team.lead')}</Badge>}
                          </div>
                        </TableCell>
                        <TableCell><Badge variant="outline">{seat.role}</Badge></TableCell>
                        <TableCell className="text-muted-foreground">{seat.runtime}</TableCell>
                        <TableCell className="text-right tabular-nums">{seat.slots}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </section>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
