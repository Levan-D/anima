import { describe, expect, it } from 'vitest';
import { folderImageFor, isDiscFolder, isFolderImage, mimeOfImagePath } from '@main/library/folderImage';

describe('isFolderImage', () => {
  it('takes the known names and extensions, whatever the case', () => {
    for (const name of ['cover.jpg', 'Folder.JPG', 'FRONT.png', 'album.webp', 'AlbumArt.jpeg', 'folder.png']) {
      expect(isFolderImage(name)).toBe(true);
    }
  });

  it('refuses what Windows Media Player leaves behind', () => {
    for (const name of [
      'AlbumArtSmall.jpg',
      'albumartsmall.JPG',
      'AlbumArt_{6E0D9A2C-3B1F-4B7E-9A10-12AB34CD56EF}_Small.jpg',
      'AlbumArt_{6E0D9A2C-3B1F-4B7E-9A10-12AB34CD56EF}_Large.jpg',
    ]) {
      expect(isFolderImage(name)).toBe(false);
    }
  });

  it('refuses other names and formats', () => {
    for (const name of ['back.jpg', 'cover.gif', 'cover.jpg.bak', 'my cover.jpg', 'cover']) {
      expect(isFolderImage(name)).toBe(false);
    }
  });
});

describe('isDiscFolder', () => {
  it('recognizes cd, disc and disk with a number', () => {
    for (const name of ['CD1', 'cd 2', 'Disc 1', 'disc-2', 'DISK3', 'Disk_01', 'cd.2']) {
      expect(isDiscFolder(name)).toBe(true);
    }
  });

  it('refuses anything else', () => {
    for (const name of ['CD', 'Discography', 'Album CD1', 'disco 2', 'Disc 1 - Live']) {
      expect(isDiscFolder(name)).toBe(false);
    }
  });
});

describe('folderImageFor', () => {
  const images = new Map([
    ['Artist/Album', ['folder.jpg']],
    ['Artist/Album/CD2', ['cover.png']],
    ['Mixed', ['back.jpg', 'folder.png', 'cover.jpg', 'front.png']],
    ['', ['cover.jpg']],
  ]);

  it('finds the image next to the file', () => {
    expect(folderImageFor('Artist/Album/01.flac', images)).toBe('Artist/Album/folder.jpg');
  });

  it('looks in the parent of a disc folder', () => {
    expect(folderImageFor('Artist/Album/CD1/01.flac', images)).toBe('Artist/Album/folder.jpg');
  });

  it('prefers the disc folder own image', () => {
    expect(folderImageFor('Artist/Album/CD2/01.flac', images)).toBe('Artist/Album/CD2/cover.png');
  });

  it('does not look in the parent of an ordinary folder', () => {
    expect(folderImageFor('Artist/Album/Bonus/01.flac', images)).toBeNull();
    expect(folderImageFor('Artist/Elsewhere/01.flac', images)).toBeNull();
  });

  it('takes cover over folder over front', () => {
    expect(folderImageFor('Mixed/01.flac', images)).toBe('Mixed/cover.jpg');
  });

  it('works at the top of the library', () => {
    expect(folderImageFor('01.flac', images)).toBe('cover.jpg');
  });

  it('finds nothing where there is nothing', () => {
    expect(folderImageFor('Nothing/01.flac', images)).toBeNull();
    expect(folderImageFor('01.flac', new Map())).toBeNull();
  });

  it('checks a disc folder at the top level against the library root', () => {
    expect(folderImageFor('CD1/01.flac', images)).toBe('cover.jpg');
  });
});

describe('mimeOfImagePath', () => {
  it('follows the extension', () => {
    expect(mimeOfImagePath('a/cover.JPG')).toBe('image/jpeg');
    expect(mimeOfImagePath('a/cover.jpeg')).toBe('image/jpeg');
    expect(mimeOfImagePath('cover.png')).toBe('image/png');
    expect(mimeOfImagePath('cover.webp')).toBe('image/webp');
  });
});
