import { X } from 'lucide-react';
import { Toast as RadixToast } from 'radix-ui';
import { Button } from '@/components/ui/Button';
import { Text, type TextColor } from '@/components/ui/Text';
import { cn } from '@/lib/cn';
import { dismissToast, useToasts, type ToastLevel } from '@/lib/toastStore';

const DURATION_MS = 6_000;

const levelColors: Record<ToastLevel, TextColor> = {
  info: 'default',
  warning: 'default',
  error: 'danger',
};

export function Toaster() {
  const toasts = useToasts();

  return (
    <RadixToast.Provider duration={DURATION_MS} label="Notification">
      {toasts.map((toast) => (
        <RadixToast.Root
          key={toast.id}
          open={toast.open}
          onOpenChange={(open) => {
            if (!open) dismissToast(toast.id);
          }}
          className={cn(
            'flex touch-none items-center gap-3 rounded-lg bg-surface-raised py-1 pr-1 pl-gutter shadow-xl no-drag',
            'data-[state=closed]:not-data-[swipe=end]:animate-fade-out data-[state=open]:animate-fade-rise',
            'data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:transition-[translate] data-[swipe=cancel]:duration-(--dur-fast)',
            'data-[swipe=end]:animate-swipe-out data-[swipe=move]:translate-x-(--radix-toast-swipe-move-x)',
          )}
        >
          <RadixToast.Description asChild>
            <Text as="p" color={levelColors[toast.level]} className="flex-1 select-text">
              {toast.message}
            </Text>
          </RadixToast.Description>
          {toast.action ? (
            <RadixToast.Action altText={toast.action.label} asChild>
              <Button variant="ghost" size="sm" onClick={toast.action.run}>
                {toast.action.label}
              </Button>
            </RadixToast.Action>
          ) : null}
          <RadixToast.Close asChild>
            <Button variant="ghost" size="icon" aria-label="Dismiss">
              <X aria-hidden />
            </Button>
          </RadixToast.Close>
        </RadixToast.Root>
      ))}
      <RadixToast.Viewport className="fixed right-0 bottom-transport z-50 flex w-110 max-w-full flex-col gap-2 p-gutter outline-hidden side-by-side:bottom-transport-tall" />
    </RadixToast.Provider>
  );
}
