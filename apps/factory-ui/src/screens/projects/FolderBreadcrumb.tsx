import { Fragment } from 'react';
import type { FolderListing } from '@/api/folderModels';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';

export function FolderBreadcrumb({ listing, onNavigate }: { listing: FolderListing; onNavigate: (path: string) => void }) {
  const t = useT();
  const root = listing.roots.map(path => path.replace(/\/$/, '') || '/')
    .filter(path => path === '/' || listing.path === path || listing.path.startsWith(`${path}/`))
    .sort((a, b) => b.length - a.length)[0] ?? listing.path;
  const segments = listing.path.slice(root === '/' ? 1 : root.length).split('/').filter(Boolean);
  const crumbs = [{ path: root, name: root.split('/').at(-1) || '/' }];
  for (const name of segments) crumbs.push({ path: `${crumbs.at(-1)?.path.replace(/\/$/, '')}/${name}`, name });

  return <Breadcrumb aria-label={t('folderPicker.breadcrumb')}>
    <BreadcrumbList className="gap-1 font-mono text-xs sm:gap-1">
      {crumbs.map((crumb, index) => <Fragment key={crumb.path}>
        {index > 0 && <BreadcrumbSeparator />}
        <BreadcrumbItem className="min-w-0 break-all">
          {index === crumbs.length - 1 ? <BreadcrumbPage>{crumb.name}</BreadcrumbPage> :
            <BreadcrumbLink asChild><Button type="button" variant="ghost" size="sm" className="h-auto whitespace-normal px-1 py-1 font-normal" onClick={() => onNavigate(crumb.path)}>{crumb.name}</Button></BreadcrumbLink>}
        </BreadcrumbItem>
      </Fragment>)}
    </BreadcrumbList>
  </Breadcrumb>;
}
