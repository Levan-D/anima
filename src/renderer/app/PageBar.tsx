import { ArrowLeft, Compass, Library, Radio, Settings as SettingsIcon, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';
import { useTabStrip } from '@/hooks/useTabStrip';
import { canGoBack, goBack, useNavigation } from '@/lib/navigation';
import { PAGES, showPage, usePage, type Page } from '@/lib/pages';

const PAGE_TABS: Record<Page, { label: string; icon: LucideIcon }> = {
  library: { label: 'Library', icon: Library },
  radio: { label: 'Radio', icon: Radio },
  discover: { label: 'Discover', icon: Compass },
  settings: { label: 'Settings', icon: SettingsIcon },
};

/**
 * One row over every page, in the same place on all of them, so a page switch moves nothing here. It's over the art on the
 * Library page, which is why only what's in it takes the pointer. Back starts at the list column there, by a spacer that
 * gives way when the column is too narrow for the tabs, so a page's tab is never scrolled away on another page. Only a
 * window too small for all of them scrolls them, rather than wrapping, because each page's layout counts on one row.
 */
export function PageBar() {
  const page = usePage();
  const hasBack = useNavigation(canGoBack);
  const isLibrary = page === 'library';
  const showsBack = isLibrary && hasBack;
  const stripRef = useTabStrip<HTMLDivElement>(page);

  return (
    <div
      data-testid="page-bar"
      className="pointer-events-none absolute inset-x-0 top-0 z-10 flex h-page-bar items-center"
    >
      <div aria-hidden data-testid="title-bar" className="absolute inset-x-0 top-0 h-title-bar drag" />
      {isLibrary ? <div aria-hidden className="side-by-side:w-(--art-side)" /> : null}
      {showsBack ? (
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
      <nav
        aria-label="Pages"
        className="relative mr-controls ml-auto flex max-w-[calc(100%-var(--spacing-controls))] shrink-0 items-center pr-1"
      >
        <div
          ref={stripRef}
          className="pointer-events-auto flex min-w-0 [scrollbar-width:none] gap-1 overflow-x-auto no-drag"
        >
          {PAGES.map((candidate) => {
            const { label, icon: Icon } = PAGE_TABS[candidate];
            return (
              <Tooltip key={candidate} label={label} side="bottom" onEscape={goBack}>
                <Button
                  variant="tab"
                  size="icon"
                  aria-label={label}
                  aria-current={candidate === page ? 'page' : undefined}
                  data-state={candidate === page ? 'active' : 'inactive'}
                  onClick={() => showPage(candidate)}
                >
                  <Icon aria-hidden />
                </Button>
              </Tooltip>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
