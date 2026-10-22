// Restricted channels are published only after authorized discovery and session age confirmation.
import type { Channel } from "./channels";
export interface AdultChannel extends Channel {
  isAdult?: boolean;
}
export const ADULT_CHANNELS: AdultChannel[] = [];
const ADULT_MAP = new Map<string, AdultChannel>();
export function syncAdultChannels(channels: AdultChannel[]): void {
  ADULT_CHANNELS.splice(0, ADULT_CHANNELS.length, ...channels);
  ADULT_MAP.clear();
  channels.forEach((c) => ADULT_MAP.set(c.id, c));
}
export function getAdultChannel(id: string): AdultChannel | undefined {
  return ADULT_MAP.get(id);
}
