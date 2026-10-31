const SAMPLE_RATE = 8_000;
const SECONDS = 10;
const FIRST_RETRY_MS = 1_000;
const LAST_RETRY_MS = 30_000;
/** Playing this long means the device is fine again, so the next failure is a new one. */
const HEALTHY_AFTER_MS = 30_000;

export type SilentAudioGoal = 'nothing' | 'paused' | 'playing';

export type SilentAudioElement = Pick<
  HTMLAudioElement,
  'loop' | 'volume' | 'src' | 'play' | 'pause' | 'addEventListener'
>;

function silentWav(): Blob {
  const samples = SECONDS * SAMPLE_RATE;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples * 2, true);
  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * What makes Chromium open a media session: an element really playing, silently. `muted` doesn't count, and neither does
 * an element left running while the player is paused, because the overlay then never offers Play. mpv taking the device
 * in exclusive mode breaks the element but not the session, so it's replaced for as long as that lasts.
 */
export function createSilentAudio(createElement: () => SilentAudioElement = () => new Audio()) {
  let wavUrl: string | null = null;
  let goal: SilentAudioGoal = 'nothing';
  let element: SilentAudioElement | null = null;
  let hasStarted = false;
  let retryMs = FIRST_RETRY_MS;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let playingSince: number | null = null;
  let isStopped = false;

  function replaceLater(): void {
    if (playingSince !== null && performance.now() - playingSince >= HEALTHY_AFTER_MS) retryMs = FIRST_RETRY_MS;
    playingSince = null;
    element?.pause();
    element = null;
    if (retry !== null || isStopped) return;
    retry = setTimeout(() => {
      retry = null;
      apply();
    }, retryMs);
    retryMs = Math.min(retryMs * 2, LAST_RETRY_MS);
  }

  function ensureElement(): SilentAudioElement {
    if (element) return element;
    wavUrl ??= URL.createObjectURL(silentWav());
    const created = createElement();
    created.loop = true;
    created.volume = 0;
    created.src = wavUrl;
    created.addEventListener('error', () => {
      if (created === element) replaceLater();
    });
    created.addEventListener('playing', () => {
      if (created === element) playingSince = performance.now();
    });
    element = created;
    return created;
  }

  function apply(): void {
    if (isStopped || retry !== null) return;
    // A session only opens once something has played, and media keys need one even when the app starts paused.
    if (goal === 'playing' || (goal === 'paused' && !hasStarted)) {
      const started = ensureElement();
      // A refusal also arrives as the element's error, and a play that a pause interrupts isn't a problem.
      started
        .play()
        .then(() => {
          hasStarted = true;
          if (goal !== 'playing' && started === element) started.pause();
        })
        .catch(() => {});
    } else {
      element?.pause();
    }
  }

  return {
    follow(next: SilentAudioGoal): void {
      if (next === goal) return;
      goal = next;
      apply();
    },
    stop(): void {
      isStopped = true;
      if (retry !== null) clearTimeout(retry);
      retry = null;
      element?.pause();
      element = null;
      if (wavUrl !== null) URL.revokeObjectURL(wavUrl);
      wavUrl = null;
    },
  };
}
