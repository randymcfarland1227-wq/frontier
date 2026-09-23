'use client';

import { sources } from '../../lib/sources';
import type { SourceId } from '../../lib/types';

export function SourceBridges({
  register,
}: {
  register: (id: SourceId, el: HTMLIFrameElement | null) => void;
}) {
  const iframeSources = sources.filter(s => s.bridge === 'iframe' && s.url);

  return (
    <div className="source-bridges" aria-hidden="true">
      {iframeSources.map(source => (
        <iframe
          key={source.id}
          ref={el => register(source.id, el)}
          src={source.url!}
          title={`${source.name} data connection`}
        />
      ))}
    </div>
  );
}
