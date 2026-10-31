import { CircleAlert, Info, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import { Toast as RadixToast } from 'radix-ui';
import { Button } from '@/components/ui/Button';
import { ProgressLine } from '@/components/ui/ProgressLine';
import { Text, type TextColor } from '@/components/ui/Text';
import { cn } from '@/lib/cn';
import { dismissToast, TOAST_DURATION_MS, useToasts, type ToastLevel, type ToastProgress } from '@/lib/toastStore';

type LevelLook = {
  icon: LucideIcon;
  iconClass: string;
  edgeClass: string;
  text: TextColor;
};

const levelLooks: Record<ToastLevel, LevelLook> = {
  info: { icon: Info, iconClass: 'text-text-muted', edgeClass: 'border-transparent', text: 'default' },
  warning: { icon: TriangleAlert, iconClass: 'text-warning', edgeClass: 'border-warning', text: 'default' },
  error: { icon: CircleAlert, iconClass: 'text-danger', edgeClass: 'border-danger', text: 'danger' },
};

function progressValue(progress: ToastProgress): number | null {
  return progress === 'indeterminate' ? null : progress;
}

/** Bottom left, over the art, so a toast never covers the list or the selection bar floating over its end. */
export function Toaster() {
  const toasts = useToasts();

  return (
    <RadixToast.Provider duration={TOAST_DURATION_MS} label="Notification" swipeDirection="left">
      {toasts.map((toast) => {
        const { icon: Icon, iconClass, edgeClass, text } = levelLooks[toast.level];
        return (
          <RadixToast.Root
            key={toast.id}
            data-toast
            data-level={toast.level}
            open={toast.open}
            duration={toast.progress === null ? undefined : Infinity}
            onOpenChange={(open) => {
              if (!open) dismissToast(toast.id);
            }}
            className={cn(
              'pointer-events-auto relative flex touch-none items-center gap-3 overflow-hidden rounded-lg border-l-2 bg-surface-raised py-1 pr-1 pl-gutter shadow-xl no-drag',
              'data-[state=closed]:not-data-[swipe=end]:animate-fade-out data-[state=open]:animate-fade-rise',
              'data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:transition-[translate] data-[swipe=cancel]:duration-(--dur-fast)',
              'data-[swipe=end]:animate-swipe-out data-[swipe=move]:translate-x-(--radix-toast-swipe-move-x)',
              edgeClass,
            )}
          >
            <Icon aria-hidden className={cn('size-5 shrink-0', iconClass)} />
            <RadixToast.Description asChild>
              <Text as="p" color={text} className="min-w-0 flex-1 select-text">
                {toast.message}
              </Text>
            </RadixToast.Description>
            {toast.action ? (
              <RadixToast.Action altText={toast.action.label} asChild>
                <Button variant="ghost" size="compact" className="pointer-events-auto" onClick={toast.action.run}>
                  {toast.action.label}
                </Button>
              </RadixToast.Action>
            ) : null}
            <RadixToast.Close asChild>
              <Button variant="ghost" size="icon" className="pointer-events-auto" aria-label="Dismiss">
                <X aria-hidden />
              </Button>
            </RadixToast.Close>
            {toast.progress === null ? null : (
              <ProgressLine
                value={progressValue(toast.progress)}
                label={toast.message}
                className="absolute inset-x-0 bottom-0"
              />
            )}
          </RadixToast.Root>
        );
      })}
      {/* Passes the pointer through wherever there's no toast: everything it lies over is the art. */}
      <RadixToast.Viewport className="pointer-events-none fixed bottom-(--toast-anchor) left-[calc((100vw-min(calc(var(--spacing)*110),100vw))/2)] z-50 flex max-h-screen w-[min(calc(var(--spacing)*110),100vw)] flex-col gap-2 p-gutter outline-hidden side-by-side:bottom-[calc((100vh-var(--art-side))/2)] side-by-side:left-0 side-by-side:w-[min(calc(var(--spacing)*110),var(--art-side))]" />
    </RadixToast.Provider>
  );
}
