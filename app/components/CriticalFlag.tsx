'use client';

/** "!" toggle: Critical = must get done; sorts above every color and shows in Pinned priorities. */
export function CriticalFlag({ on, title, onToggle }: { on: boolean; title: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`critical-flag${on ? ' is-on' : ''}`}
      onClick={onToggle}
      aria-pressed={on}
      aria-label={on ? `Remove critical from ${title}` : `Mark ${title} critical`}
      title={on ? 'Critical — tap to remove' : 'Mark critical (must get done)'}
    >
      {on ? 'Critical' : '!'}
    </button>
  );
}
