/* Where each online service is asked and whether it is, which the person can change in case one moves or shuts down. */

import {
  addressOf,
  checkAddress,
  ONLINE_SERVICES,
  SCRIPTABLE_SERVICES,
  type OnlineServiceId,
  type OnlineServiceSetting,
} from '@shared/onlineServices';
import { err, ok, type Result } from '@shared/result';
import type { HandlerGroup } from '@main/ipc';
import type { SettingsStore } from '@main/settings/settings';

/** What a client reads at each request: the address set now, and whether it may ask at all. */
export function serviceWhere(settings: Pick<SettingsStore, 'get'>, service: OnlineServiceId) {
  return {
    address: () => addressOf(settings.get().onlineServices, service),
    isOn: () => settings.get().onlineServices[service].isOn,
  };
}

/** How a test went: what it made of the answer, when there's more to say than that it read. */
export type ServiceTest = Result<void> | Result<{ note: string | null }>;

function noteOf(tested: ServiceTest & { ok: true }): string | null {
  return typeof tested.value === 'object' ? tested.value.note : null;
}

type Deps = {
  settings: Pick<SettingsStore, 'get' | 'update'>;
  /** One real request each, whatever the switch says, and whether its answer reads. */
  tests: Record<OnlineServiceId, () => Promise<ServiceTest>>;
  /** Something changed, so what depends on a service being on can say so. */
  onChange: () => void;
  now: () => number;
};

export function onlineServiceHandlers({ settings, tests, onChange, now }: Deps) {
  return {
    'online.set': ({ service, isOn, address, script }) => {
      const services = settings.get().onlineServices;
      const current = services[service];
      let nextAddress = current.address;
      if (address === null) nextAddress = null;
      if (typeof address === 'string') {
        const checked = checkAddress(address);
        if (!checked.ok) return checked;
        // Typing the service's own address is the same as going back to it.
        nextAddress = checked.value === ONLINE_SERVICES[service].defaultAddress ? null : checked.value;
      }
      let nextScript = current.script;
      if (script !== undefined) {
        if (script !== null && !SCRIPTABLE_SERVICES.has(service)) {
          return err('invalid_input', `A script can't stand in for ${ONLINE_SERVICES[service].name} yet`);
        }
        nextScript = script === null || script.trim() === '' ? null : script;
      }
      const next: OnlineServiceSetting = { isOn: isOn ?? current.isOn, address: nextAddress, script: nextScript };
      settings.update({ onlineServices: { ...services, [service]: next } });
      onChange();
      return ok();
    },

    'online.test': async ({ service }) => {
      const startedAt = now();
      const tested = await tests[service]();
      return tested.ok ? ok({ ms: Math.round(now() - startedAt), note: noteOf(tested) }) : tested;
    },
  } satisfies HandlerGroup;
}
