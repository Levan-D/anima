import { ChevronDown } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Accordion as RadixAccordion } from 'radix-ui';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Divider } from '@/components/ui/Divider';
import { cn } from '@/lib/cn';
import { EASE_STANDARD, motionDuration } from '@/lib/motionTokens';

export type AccordionItem = {
  value: string;
  /** What the row that opens it holds, beside the chevron. */
  header: ReactNode;
  /** Only rendered while it's open. */
  content: ReactNode;
};

type Props = {
  items: readonly AccordionItem[];
  /** The values open to begin with. Any number can be open at once. */
  defaultOpen?: readonly string[];
  className?: string;
};

/** Sections that fold, with a line between them. Arrow keys move between the headers. */
export function Accordion({ items, defaultOpen = [], className }: Props) {
  const [open, setOpen] = useState<string[]>([...defaultOpen]);

  return (
    <RadixAccordion.Root
      type="multiple"
      value={open}
      onValueChange={setOpen}
      className={cn('flex flex-col', className)}
    >
      {items.map(({ value, header, content }) => (
        <RadixAccordion.Item key={value} value={value} className="group/item relative">
          <Divider className="absolute inset-x-0 top-0 group-first/item:hidden" />
          <RadixAccordion.Header className="h-row">
            <RadixAccordion.Trigger asChild>
              <Button variant="row" size="row" className="group/trigger px-section">
                <span className="flex min-w-0 flex-1 items-baseline gap-gap">{header}</span>
                <ChevronDown
                  aria-hidden
                  className="text-text-muted transition-transform duration-(--dur-mid) ease-standard group-data-[state=open]/trigger:rotate-180"
                />
              </Button>
            </RadixAccordion.Trigger>
          </RadixAccordion.Header>
          {/* In motion rather than CSS keyframes: it has to reach `auto`, and the height is only known once it's rendered. */}
          <AnimatePresence initial={false}>
            {open.includes(value) ? (
              <RadixAccordion.Content forceMount asChild>
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: 'auto' }}
                  exit={{ height: 0 }}
                  transition={{ duration: motionDuration('--dur-mid'), ease: EASE_STANDARD }}
                  className="overflow-hidden"
                >
                  <Divider />
                  {content}
                </motion.div>
              </RadixAccordion.Content>
            ) : null}
          </AnimatePresence>
        </RadixAccordion.Item>
      ))}
    </RadixAccordion.Root>
  );
}
