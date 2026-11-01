import type { ReactNode } from 'react';

type Props = {
  /** A new one eases in what's in it now. */
  id: string;
  children: ReactNode;
};

/** An icon that stands for a state, in a button, so it doesn't leave the button any smaller. */
export function IconSwap({ id, children }: Props) {
  return (
    <span key={id} className="icon-in inline-flex">
      {children}
    </span>
  );
}
