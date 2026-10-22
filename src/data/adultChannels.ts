// Completely isolated adult content feed (18+)
// Strictly isolated from general channels and media feeds.

export interface AdultChannel {
  id: string;
  name: string;
  category: string;
  url: string;
  fallbacks: string[];
  quality: string;
}

export const ADULT_CHANNELS: AdultChannel[] = [
  {
    id: 'adult-redlight',
    name: 'Red Light TV (18+)',
    category: 'Late Night',
    url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    fallbacks: [],
    quality: 'HD',
  },
  {
    id: 'adult-neon-lounge',
    name: 'Midnight Neon (18+)',
    category: 'Adult Cinema',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
    fallbacks: [],
    quality: '1080p',
  },
  {
    id: 'adult-glamour',
    name: 'Glamour TV (18+)',
    category: 'Glamour',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
    fallbacks: [],
    quality: '720p',
  },
  {
    id: 'adult-seduction',
    name: 'Secret Lounge (18+)',
    category: 'Romance & Thrill',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
    fallbacks: [],
    quality: 'HD',
  },
  {
    id: 'adult-afterdark',
    name: 'AfterDark Club (18+)',
    category: 'Late Night',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    fallbacks: [],
    quality: '1080p',
  },
];

const ADULT_MAP = new Map(ADULT_CHANNELS.map((c) => [c.id, c]));

export function getAdultChannel(id: string): AdultChannel | undefined {
  return ADULT_MAP.get(id);
}
