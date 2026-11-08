import { describe, expect, it } from 'vitest';
import { scoreEnergy, scoreVoice } from './heads';

describe('heads', () => {
  it('asks nothing of the models without fingerprints', async () => {
    expect(await scoreVoice(new Float32Array(0), 1280, 'models', () => true)).toEqual({
      status: 'no-fingerprints',
      scores: null,
    });
  });

  it('says a model is missing rather than loading the runtime', async () => {
    const asked: string[] = [];
    const exists = (path: string) => {
      asked.push(path);
      return !path.includes('voice');
    };
    expect(await scoreVoice(new Float32Array(1280), 1280, 'models', exists)).toEqual({
      status: 'no-models',
      scores: null,
    });
    expect(await scoreEnergy(new Float32Array(1280), 1280, 'models', () => false)).toEqual({
      status: 'no-models',
      scores: null,
    });
    expect(asked.some((path) => path.endsWith('voice_instrumental-discogs-effnet-1.onnx'))).toBe(true);
  });
});
