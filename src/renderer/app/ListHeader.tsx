import { ArrowLeft, Settings as SettingsIcon } from 'lucide-react';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { Button } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';
import { SearchField } from '@/features/Search/SearchField';
import { cn } from '@/lib/cn';
import { canGoBack, currentPlace, goBack, openSettings, useNavigation } from '@/lib/navigation';

const searchAloneClasses = {
  withBack: 'side-by-side:@max-header:order-last side-by-side:@max-header:basis-full side-by-side:@max-header:pr-3',
  bare: 'side-by-side:@max-header-bare:order-last side-by-side:@max-header-bare:basis-full side-by-side:@max-header-bare:pr-3',
};

const gearAloneClasses = {
  withBack: 'side-by-side:@max-header:ml-auto',
  bare: 'side-by-side:@max-header-bare:ml-auto',
};

/**
 * Back, search and settings. Beside the art this is the title bar, so it drags the window and stops short of the window
 * controls, and in a narrow column the search field drops to a row of its own under them. Stacked under the art it just
 * shares a row with the tabs, which saves the height of a list row.
 */
export function ListHeader() {
  const showsBack = useNavigation(canGoBack);
  const inSettings = useNavigation((state) => currentPlace(state).kind === 'settings');
  const room = showsBack ? 'withBack' : 'bare';

  return (
    <div
      data-testid="list-header"
      className={cn(
        '@container order-last min-w-60 flex-1',
        'side-by-side:order-first side-by-side:min-h-title-bar side-by-side:basis-full side-by-side:drag',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-1 pr-1 pl-gutter">
        {showsBack ? (
          <Tooltip label="Back" side="bottom" onEscape={goBack}>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Back"
              onClick={goBack}
              className="-ml-3 focus-inset no-drag"
            >
              <ArrowLeft aria-hidden />
            </Button>
          </Tooltip>
        ) : null}
        <ErrorBoundary className="h-auto w-auto flex-1 flex-row">
          <SearchField className={cn('flex-1 no-drag', searchAloneClasses[room])} />
        </ErrorBoundary>
        <Tooltip label="Settings" side="bottom" onEscape={goBack}>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Settings"
            aria-pressed={inSettings}
            onClick={inSettings ? goBack : openSettings}
            className={cn('focus-inset no-drag side-by-side:mr-controls', gearAloneClasses[room])}
          >
            <SettingsIcon aria-hidden />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
