import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';

describe('Dialog', () => {
  it('stays closed until its trigger is used', () => {
    render(<Dialog trigger={<Button>Open</Button>} title="Remove tracks?" />);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    expect(screen.getByRole('dialog', { name: 'Remove tracks?' })).toBeTruthy();
  });

  it('points screen readers at the description when there is one', () => {
    render(<Dialog defaultOpen title="Remove tracks?" description="This can't be undone." />);
    expect(screen.getByRole('dialog').getAttribute('aria-describedby')).toBe(
      screen.getByText("This can't be undone.").id,
    );
  });

  it('has no dangling description when there is none', () => {
    render(<Dialog defaultOpen title="Remove tracks?" />);
    expect(screen.getByRole('dialog').hasAttribute('aria-describedby')).toBe(false);
  });

  it('shows its actions, and reports Escape to a controlled parent', () => {
    const onOpenChange = vi.fn();
    render(<Dialog open onOpenChange={onOpenChange} title="Remove tracks?" actions={<Button>Remove</Button>} />);
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes when an action is used, without needing a controlled parent', () => {
    const onClick = vi.fn();
    render(
      <Dialog
        defaultOpen
        title="Remove tracks?"
        actions={[
          <Button key="1">Cancel</Button>,
          <Button key="2" onClick={onClick}>
            Remove
          </Button>,
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('stays open when an action says so', () => {
    render(
      <Dialog
        defaultOpen
        title="Remove tracks?"
        actions={<Button onClick={(event) => event.preventDefault()}>Remove</Button>}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('stays open while an action is loading', () => {
    render(<Dialog defaultOpen title="Remove tracks?" actions={<Button loading>Remove</Button>} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
