import { useMutation } from '@tanstack/react-query';
import type { OnlineServiceId } from '@shared/onlineServices';
import { call, unwrap } from '@/lib/api';
import { toastFailure } from '@/lib/toastStore';

/** Turning a service on or off. A refusal is a toast, since the switch has nowhere of its own to say it. */
export function useSwitchService(service: OnlineServiceId) {
  return useMutation({
    mutationFn: (isOn: boolean) => call('online.set', { service, isOn }).then(unwrap),
    onError: toastFailure,
  });
}

/** A new address, or null for the service's own. What's wrong with one is shown under the field, so it isn't a toast. */
export function useSaveAddress(service: OnlineServiceId) {
  return useMutation({
    mutationFn: (address: string | null) => call('online.set', { service, address }).then(unwrap),
  });
}

/** One real request to the address that's set, and how long it took. */
export function useTestService(service: OnlineServiceId) {
  return useMutation({
    mutationFn: () => call('online.test', { service }).then(unwrap),
  });
}
