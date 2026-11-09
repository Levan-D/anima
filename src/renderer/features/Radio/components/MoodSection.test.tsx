import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Tooltip as RadixTooltip } from 'radix-ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandInput } from '@shared/ipc/contract';
import type { MoodCard, MoodStation, MoodTry } from '@shared/stations';
import { queryClient } from '@/lib/queryClient';
import { resetRendererState, stubApi, stubLayout, track, type StubbedApi } from '@/lib/testing';
import { MoodSection } from './MoodSection';

const CARD: MoodCard = { id: 1, name: 'Study', covers: ['aa'], songs: 344 };
const STUDY: MoodStation = {
  id: 1,
  name: 'Study',
  examples: [{ kind: 'artist', key: 'einaudi', label: 'Ludovico Einaudi', isYes: true, source: 'picked' }],
  rules: { instrumental: true, calm: true, littleSinging: true },
  genre: null,
  decade: null,
  grade: null,
};
const TRIED: MoodTry = {
  problem: null,
  songs: 120,
  check: [
    {
      track: track({ id: 40, title: 'Halima', artist: 'Kenny Garrett' }),
      key: 'kenny garrett\thalima',
      label: 'Halima – Kenny Garrett',
    },
  ],
  rules: { instrumental: 'ready', calm: 'ready', littleSinging: 'unavailable' },
  genres: [
    { name: 'Classical', songs: 80 },
    { name: 'Jazz', songs: 40 },
  ],
  decades: [{ decade: 1990, songs: 30 }],
  grade: null,
};

let api: StubbedApi;
const onStart = vi.fn();

function stub(overrides: Parameters<typeof stubApi>[0] = {}) {
  api = stubApi({
    'moods.list': [CARD],
    'moods.get': STUDY,
    'moods.search': [
      { kind: 'artist', key: 'einaudi', label: 'Ludovico Einaudi', by: null, songs: 60, artHash: null },
      { kind: 'genre', key: 'Classical', label: 'Classical', by: null, songs: 400, artHash: null },
    ],
    'moods.try': TRIED,
    'moods.save': { stationId: 2 },
    'moods.delete': undefined as never,
    'moods.grade': { kind: 'clear', examples: [], alike: [] },
    'player.play': undefined as never,
    ...overrides,
  });
}

function mount() {
  return render(
    <QueryClientProvider client={queryClient}>
      <RadixTooltip.Provider>
        <MoodSection onStart={onStart} />
      </RadixTooltip.Provider>
    </QueryClientProvider>,
  );
}

function asked<N extends 'moods.try' | 'moods.save' | 'moods.grade' | 'moods.delete'>(name: N): CommandInput<N>[] {
  return api.invoke.mock.calls.filter(([called]) => called === name).map(([, input]) => input as CommandInput<N>);
}

beforeEach(() => {
  resetRendererState();
  stubLayout();
  onStart.mockReset();
  stub();
});

describe('Pick a mood', () => {
  it('plays a mood from its card, and says how many songs it has', async () => {
    mount();
    const card = await screen.findByRole('button', { name: 'Start Study' });
    expect(within(card).getByText('344 songs')).toBeTruthy();
    fireEvent.click(card);
    expect(onStart).toHaveBeenCalledWith({ kind: 'station', stationId: 1 });
  });

  it('says what a mood is when there are none, beside the card that makes one', async () => {
    stub({ 'moods.list': [] });
    mount();
    expect(await screen.findByText(/A mood plays what sounds like/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /New mood/ })).toBeTruthy();
  });
});

describe('the mood tuner', () => {
  it('makes a new mood: a name, examples from the search, a check round, then Create', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /New mood/ }));
    const dialog = await screen.findByRole('dialog', { name: 'New mood' });
    const create = within(dialog).getByRole('button', { name: 'Create' });
    expect(create).toHaveProperty('disabled', true);
    expect(within(dialog).getByText('Give it a name')).toBeTruthy();

    fireEvent.change(within(dialog).getByLabelText('Mood name'), { target: { value: 'Study' } });
    fireEvent.change(within(dialog).getByLabelText('Search for songs, albums, artists or genres'), {
      target: { value: 'einaudi' },
    });
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Yes, Ludovico Einaudi sounds like it' }));
    expect(await within(dialog).findByText('Plays 120 songs')).toBeTruthy();
    expect(asked('moods.try').at(-1)?.draft.examples).toEqual([STUDY.examples[0]]);

    // An answer waits for the next round, and a song's yes becomes a song example.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Yes, Halima belongs' }));
    expect(asked('moods.try')).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Another round' }));
    await waitFor(() => expect(asked('moods.try')).toHaveLength(2));
    expect(asked('moods.try').at(-1)?.draft.examples.at(-1)).toMatchObject({
      kind: 'track',
      key: 'kenny garrett\thalima',
      isYes: true,
      source: 'check',
    });

    expect(within(dialog).getByRole('button', { name: 'Little singing' })).toHaveProperty('disabled', true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Calm' }));
    fireEvent.click(create);
    await waitFor(() => expect(asked('moods.save')).toHaveLength(1));
    expect(asked('moods.save')[0]).toMatchObject({
      stationId: null,
      draft: { name: 'Study', rules: { instrumental: true, calm: false, littleSinging: true } },
    });
  });

  it('says how clear it is, example by example as it goes', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Study' }));
    const dialog = await screen.findByRole('dialog', { name: 'Tune mood' });
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Check how clear it is' }));
    act(() => api.emit('moods.grading', { done: 1, total: 3 }));
    expect(await within(dialog).findByText(/Clear\. Each album/)).toBeTruthy();
    expect(asked('moods.grade')[0]).toMatchObject({ stationId: 1 });
  });

  it('opens a saved mood as it was kept, and deletes it once asked twice', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Study' }));
    const dialog = await screen.findByRole('dialog', { name: 'Tune mood' });
    expect(await within(dialog).findByDisplayValue('Study')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Take Ludovico Einaudi out' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(asked('moods.delete')).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(asked('moods.delete')).toEqual([{ stationId: 1 }]);
  });

  it('warns when a filter leaves too few songs to keep from repeating', async () => {
    stub({ 'moods.try': { ...TRIED, songs: 30 } });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Study' }));
    const dialog = await screen.findByRole('dialog', { name: 'Tune mood' });
    await within(dialog).findByText('Plays 30 songs');
    expect(within(dialog).queryByText(/It will repeat itself soon/)).toBeNull();
    fireEvent.pointerDown(within(dialog).getByRole('button', { name: 'Decade: Any decade' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: /1990s/ }));
    expect(await within(dialog).findByText('Only 30 songs with this. It will repeat itself soon')).toBeTruthy();
  });
});
