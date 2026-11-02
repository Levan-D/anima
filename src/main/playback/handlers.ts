import { ok } from '@shared/result';
import type { HandlerGroup } from '@main/ipc';
import type { Player } from './player';

export function playerHandlers(player: Player) {
  return {
    'player.state': () => ok(player.state()),
    'player.position': () => ok(player.position()),
    'player.queue': () => ok(player.queue()),
    'player.play': ({ trackIds, startIndex }) => player.play(trackIds, startIndex),
    'player.playQueueIndex': ({ index }) => player.playQueueIndex(index),
    'player.toggle': () => player.toggle(),
    'player.pause': () => player.pause(),
    'player.resume': () => player.resume(),
    'player.stop': () => player.stop(),
    'player.next': () => player.next(),
    'player.previous': () => player.previous(),
    'player.seek': ({ positionMs }) => player.seek(positionMs),
    'player.setVolume': ({ volume }) => player.setVolume(volume),
    'player.setMuted': ({ muted }) => player.setMuted(muted),
    'player.setOutputMode': ({ mode }) => player.setOutputMode(mode),
    'player.setReplayGainMode': ({ mode }) => player.setReplayGainMode(mode),
    'player.setEq': ({ eq }) => player.setEq(eq),
    'player.setEndless': ({ on }) => player.setEndless(on),
    'radio.preview': () => player.radioPreview(),
    'radio.play': ({ trackId }) => player.playRadio(trackId),
    'radio.start': ({ from, wander }) => player.startRadio(from, wander),
    'radio.setWander': ({ wander }) => player.setRadioWander(wander),
    'radio.setEnergy': ({ energy }) => player.setRadioEnergy(energy),
    'seasons.set': ({ seasons }) => player.setSeasons(seasons),
    'player.enqueue': ({ trackIds, where }) => player.enqueue(trackIds, where),
    'player.removeFromQueue': ({ queueIds }) => player.removeFromQueue(queueIds),
    'player.moveInQueue': ({ queueIds, toIndex }) => player.moveInQueue(queueIds, toIndex),
    'player.clearQueue': () => player.clearQueue(),
    'player.retry': () => player.retry(),
  } satisfies HandlerGroup;
}
