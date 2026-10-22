// Completely isolated adult content feed (18+)
// Strictly isolated from general channels and media feeds.
import type { Channel } from './channels';

export interface AdultChannel extends Channel {
  isAdult?: boolean;
}

export const ADULT_CHANNELS: AdultChannel[] = [
  {
    id: 'adult-redlight',
    name: 'Red Light TV (18+)',
    category: 'Late Night',
    country: 'International',
    logo: '',
    url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    fallbacks: [],
    quality: 'HD',
    isAdult: true,
  },
  {
    id: 'adult-neon-lounge',
    name: 'Midnight Neon (18+)',
    category: 'Adult Cinema',
    country: 'International',
    logo: '',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
    fallbacks: [],
    quality: '1080p',
    isAdult: true,
  },
  {
    id: 'adult-glamour',
    name: 'Glamour TV (18+)',
    category: 'Glamour',
    country: 'International',
    logo: '',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
    fallbacks: [],
    quality: '720p',
    isAdult: true,
  },
  {
    id: 'adult-seduction',
    name: 'Secret Lounge (18+)',
    category: 'Romance & Thrill',
    country: 'International',
    logo: '',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
    fallbacks: [],
    quality: 'HD',
    isAdult: true,
  },
  {
    id: 'adult-afterdark',
    name: 'AfterDark Club (18+)',
    category: 'Late Night',
    country: 'International',
    logo: '',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    fallbacks: [],
    quality: '1080p',
    isAdult: true,
  },
];

const ADULT_MAP = new Map(ADULT_CHANNELS.map((c) => [c.id, c]));

export function getAdultChannel(id: string): AdultChannel | undefined {
  return ADULT_MAP.get(id);
}
