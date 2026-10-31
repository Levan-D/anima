import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeArtOverlay, toggleArtOverlay, useArtOverlay } from '@/lib/artOverlay';
import { canGoBack, goBack, openAlbum, resetNavigation, useNavigation } from '@/lib/navigation';

const overlay = () => renderHook(() => useArtOverlay((state) => state.overlay)).result.current;

beforeEach(() => {
  closeArtOverlay();
  resetNavigation();
});

describe('the art overlay', () => {
  it('opens and closes', () => {
    toggleArtOverlay('lyrics');
    expect(overlay()).toBe('lyrics');
    toggleArtOverlay('lyrics');
    expect(overlay()).toBeNull();
  });

  it('says whether there was one to close', () => {
    expect(closeArtOverlay()).toBe(false);
    toggleArtOverlay('lyrics');
    expect(closeArtOverlay()).toBe(true);
    expect(overlay()).toBeNull();
  });

  it('is what going back closes first', () => {
    openAlbum(1);
    toggleArtOverlay('lyrics');

    goBack();
    expect(overlay()).toBeNull();
    expect(renderHook(() => useNavigation(canGoBack)).result.current).toBe(true);

    goBack();
    expect(renderHook(() => useNavigation(canGoBack)).result.current).toBe(false);
  });
});
