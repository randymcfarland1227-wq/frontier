import type { SpaceId } from './types';

/** One Alignment item = one box with its own affirmation. Wording comes from the TickTick Grounding reminders. */
export type AlignmentItem = {
  id: string;
  title: string;
  icon: string;
  tone: 'sleep' | 'purpose' | 'body' | 'lens' | 'creative';
  lines: string[];
  /** How it shows up in TickTick, shown as small chips */
  via?: string[];
  link?: { label: string; url?: string; space?: SpaceId };
};

export const ALIGNMENT: AlignmentItem[] = [
  {
    id: 'align-sleep',
    title: 'Protect sleep and rest',
    icon: '🌙',
    tone: 'sleep',
    lines: [
      'Sleep protects healing, regulation, and the ability to act. It is the outcome, not a checkbox.',
      'Rest while awake when recovery is the real need; do not fill every open moment.',
    ],
    via: ['Night Time Routine', 'Daytime Rest / Quiet Reset', 'Medicine and Vitamins', 'Recovery options'],
  },
  {
    id: 'align-why',
    title: 'Why I am doing this',
    icon: '🧭',
    tone: 'purpose',
    lines: ['Build a life I can feel and live fully.', 'Do the work and make space for love.', 'Create an environment that supports the relationships and experiences I need.'],
  },
  {
    id: 'align-body',
    title: 'Nourish my body',
    icon: '🥗',
    tone: 'body',
    lines: ['Nourishing my body supports energy, strength, skin, hair, and mental health.'],
  },
  {
    id: 'align-lens',
    title: 'What matters most today?',
    icon: '🔎',
    tone: 'lens',
    lines: ['Practice patience.', 'Reconnect with purpose and direction.', 'Make room for joy and curiosity.', 'Act with self-assurance.'],
  },
  {
    id: 'align-creative',
    title: 'Creative actualization',
    icon: '🎨',
    tone: 'creative',
    lines: [
      'One session: music and singing, curiosity “recess”, intentional learning, or unrestricted making.',
      'Projects: deep dives, botanicals or lotions, Savanna’s baby blanket.',
      'Keep outcomes undated; only the next physical action goes in Next Step Actions.',
    ],
    link: { label: 'Music Hub', url: 'https://my-music-hub.randymcfarland1227.workers.dev/' },
  },
];
