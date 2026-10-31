import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { VerticalTabs } from '@/components/ui/VerticalTabs';

const ITEMS = [
  { value: 'one', label: 'One', content: <p>First pane</p> },
  { value: 'two', label: 'Two', content: <p>Second pane</p> },
  { value: 'three', label: 'Three', content: <p>Third pane</p> },
];

function Harness() {
  const [value, setValue] = useState('one');
  return <VerticalTabs label="Things" items={ITEMS} value={value} onValueChange={setValue} />;
}

const tab = (name: string) => screen.getByRole('tab', { name });
const pressOn = (name: string, key: string) => {
  tab(name).focus();
  fireEvent.keyDown(tab(name), { key });
};

describe('VerticalTabs', () => {
  it('is a vertical tab list, named, showing only the active pane', () => {
    render(<Harness />);
    const list = screen.getByRole('tablist', { name: 'Things' });
    expect(list.getAttribute('aria-orientation')).toBe('vertical');
    expect(screen.getByText('First pane')).toBeTruthy();
    expect(screen.queryByText('Second pane')).toBeNull();
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(tab('One').id);
  });

  it('a click chooses a tab', () => {
    render(<Harness />);
    fireEvent.click(tab('Two'));
    expect(screen.getByText('Second pane')).toBeTruthy();
    expect(screen.queryByText('First pane')).toBeNull();
    expect(tab('Two').getAttribute('aria-selected')).toBe('true');
  });

  it('reports a click, but not one on the tab that is already active', () => {
    const onValueChange = vi.fn();
    render(<VerticalTabs label="Things" items={ITEMS} value="one" onValueChange={onValueChange} />);
    fireEvent.click(tab('One'));
    expect(onValueChange).not.toHaveBeenCalled();
    fireEvent.click(tab('Three'));
    expect(onValueChange).toHaveBeenCalledWith('three');
  });

  it('the up and down arrows move and choose, and go round', async () => {
    render(<Harness />);
    pressOn('One', 'ArrowDown');
    await waitFor(() => expect(screen.getByText('Second pane')).toBeTruthy());
    expect(document.activeElement).toBe(tab('Two'));

    pressOn('Two', 'ArrowUp');
    await waitFor(() => expect(screen.getByText('First pane')).toBeTruthy());

    pressOn('One', 'ArrowUp');
    await waitFor(() => expect(screen.getByText('Third pane')).toBeTruthy());
  });

  it('the left and right arrows do too, for when the tabs are along the top', async () => {
    render(<Harness />);
    pressOn('One', 'ArrowRight');
    await waitFor(() => expect(screen.getByText('Second pane')).toBeTruthy());
    pressOn('Two', 'ArrowLeft');
    await waitFor(() => expect(screen.getByText('First pane')).toBeTruthy());
    pressOn('One', 'ArrowLeft');
    await waitFor(() => expect(screen.getByText('Third pane')).toBeTruthy());
  });
});
