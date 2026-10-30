import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Text } from '@/components/ui/Text';

describe('Text', () => {
  it('renders the element it was asked for', () => {
    render(<Text as="h2">Albums</Text>);
    expect(screen.getByRole('heading', { level: 2, name: 'Albums' })).toBeTruthy();
  });

  it('lets className win over the defaults', () => {
    render(
      <Text truncate className="inline-block">
        Albums
      </Text>,
    );
    const classes = screen.getByText('Albums').className.split(' ');
    expect(classes).toContain('inline-block');
    expect(classes).not.toContain('block');
  });

  // jsdom has no layout, so the width itself can't be measured here: an inline span truncates nothing.
  it('makes a truncated span a block, in a block parent', () => {
    render(
      <div>
        <Text truncate>A very long title</Text>
      </div>,
    );
    const { className, tagName } = screen.getByText('A very long title');
    expect(tagName).toBe('SPAN');
    expect(className.split(' ')).toEqual(expect.arrayContaining(['block', 'truncate']));
  });

  it('goes by what it says for direction when it truncates, so right-to-left text loses its end, not its start', () => {
    render(<Text truncate>A very long title</Text>);
    expect(screen.getByText('A very long title').getAttribute('dir')).toBe('auto');
  });
});
