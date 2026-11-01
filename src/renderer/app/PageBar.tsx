import { ArrowLeft, Settings as SettingsIcon } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';
import { cn } from '@/lib/cn';
import { canGoBack, goBack, useNavigation } from '@/lib/navigation';
import { PAGES, showPage, usePage, type Page } from '@/lib/pages';
import { openSettings } from '@/lib/settingsDialog';

const PAGE_LABELS: Record<Page, string> = {
  library: 'Library',
  radio: 'Radio',
  discover: 'Discover',
};

/**
 * One row over every page, in the same place on all of them, so a page switch moves nothing here. It's over the art on the
 * Library page, which is why only what's in it takes the pointer, and why Back starts at the list column there. The pages
 * scroll sideways rather than wrap, because each page's layout counts on this being one row.
 */
export function PageBar() {
  const page = usePage();
  const hasBack = useNavigation(canGoBack);
  const isLibrary = page === 'library';

  return (
    <div
      data-testid="page-bar"
      className={cn(
        'pointer-events-none absolute inset-x-0 top-0 z-10 flex h-page-bar items-center',
        isLibrary && 'side-by-side:pl-(--art-side)',
      )}
    >
      <div aria-hidden data-testid="title-bar" className="absolute inset-x-0 top-0 h-title-bar drag" />
      {isLibrary && hasBack ? (
        <Tooltip label="Back" side="bottom" onEscape={goBack}>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Back"
            onClick={goBack}
            className="pointer-events-auto ml-[calc(var(--spacing-gutter)-var(--spacing)*3)] focus-inset no-drag"
          >
            <ArrowLeft aria-hidden />
          </Button>
        </Tooltip>
      ) : null}
      <nav aria-label="Pages" className="relative mr-controls ml-auto flex min-w-0 items-center pr-1">
        <div className="pointer-events-auto flex min-w-0 [scrollbar-width:none] gap-1 overflow-x-auto no-drag">
          {PAGES.map((candidate) => (
            <Button
              key={candidate}
              variant="tab"
              size="tab"
              aria-current={candidate === page ? 'page' : undefined}
              data-state={candidate === page ? 'active' : 'inactive'}
              onClick={() => showPage(candidate)}
            >
              {PAGE_LABELS[candidate]}
            </Button>
          ))}
        </div>
        <Tooltip label="Settings" side="bottom" onEscape={goBack}>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Settings"
            aria-haspopup="dialog"
            onClick={() => openSettings()}
            className="pointer-events-auto shrink-0 focus-inset no-drag"
          >
            <SettingsIcon aria-hidden />
          </Button>
        </Tooltip>
      </nav>
    </div>
  );
}
