/* What everything that pops up beside its trigger shares: menus, popovers, hover cards and tooltips. */

/**
 * How far one keeps off the window's edge. Radix takes only a number, and it needn't scale. The gap from the trigger is a
 * margin in each one's classes instead, so that does.
 */
export const EDGE_CLEARANCE = 8;

/** A popover's surface, from the side of its trigger. */
export const popoverClasses = [
  'z-50 flex max-w-(--radix-popover-content-available-width) flex-col gap-3 rounded-lg border border-border bg-surface-raised p-gutter shadow-xl outline-hidden no-drag',
  'data-[side=bottom]:mt-1 data-[side=left]:mr-1 data-[side=right]:ml-1 data-[side=top]:mb-1',
  'pop origin-(--radix-popover-content-transform-origin)',
];
