'use client';

import { FormEvent, useEffect, useState } from 'react';
import {
  deviceLink,
  disableBackup,
  enableBackup,
  getSyncStatus,
  joinWithKey,
  syncNow,
  SYNC_STATUS_EVENT,
  type SyncStatus,
} from '../../lib/cloudSync';

function ago(iso?: string) {
  if (!iso) return '';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours} hr ago` : new Date(iso).toLocaleDateString();
}

const ERRORS: Record<string, string> = {
  wrong_key: "That key doesn't match your backup.",
  offline: "Couldn't reach the backup — will retry.",
};

export function CloudBackup() {
  const [status, setStatus] = useState<SyncStatus>(() => getSyncStatus());
  const [joining, setJoining] = useState(false);
  const [key, setKey] = useState('');
  const [copied, setCopied] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    const onStatus = (e: Event) => setStatus({ ...(e as CustomEvent<SyncStatus>).detail });
    window.addEventListener(SYNC_STATUS_EVENT, onStatus);
    const timer = window.setInterval(() => tick(n => n + 1), 30000);
    return () => {
      window.removeEventListener(SYNC_STATUS_EVENT, onStatus);
      window.clearInterval(timer);
    };
  }, []);

  async function copyLink() {
    const link = deviceLink();
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt('Open this link on your other device:', link);
    }
  }

  async function join(event: FormEvent) {
    event.preventDefault();
    if (!key.trim()) return;
    const result = await joinWithKey(key);
    if (result.state === 'ok') {
      setJoining(false);
      setKey('');
    }
  }

  const on = status.state !== 'off';
  const c = status.counts;

  return (
    <div className={`cloud-backup is-${status.state}`} aria-live="polite">
      {status.notice ? <p className="cloud-notice">✓ {status.notice}</p> : null}
      <div className="cloud-row">
        <p className="cloud-text">
          <strong>
            {status.state === 'off' && '○ Backup off'}
            {status.state === 'syncing' && '◌ Backing up…'}
            {status.state === 'ok' && '● Backed up'}
            {status.state === 'error' && '▲ Backup problem'}
          </strong>{' '}
          {status.state === 'off' && 'Your history lives only in this browser.'}
          {status.state === 'ok' &&
            `${ago(status.at)}${c ? ` · ${c.completions} completions, ${c.captures} ideas, ${c.self} Self items` : ''}`}
          {status.state === 'error' && (ERRORS[status.error || ''] || status.error)}
        </p>
        <div className="cloud-actions">
          {!on ? (
            <>
              <button type="button" className="row-action" onClick={() => void enableBackup()}>
                Turn on backup
              </button>
              <button type="button" className="row-action ghost" onClick={() => setJoining(j => !j)}>
                I have a key
              </button>
            </>
          ) : (
            <>
              <button type="button" className="row-action ghost" onClick={() => void copyLink()}>
                {copied ? 'Link copied' : 'Link another device'}
              </button>
              {status.state === 'error' ? (
                <button type="button" className="row-action ghost" onClick={() => void syncNow()}>
                  Retry
                </button>
              ) : null}
              <button
                type="button"
                className="row-action ghost"
                onClick={() => {
                  if (window.confirm('Stop backing up this browser? Your saved backup stays in the cloud.')) disableBackup();
                }}
              >
                Turn off
              </button>
            </>
          )}
        </div>
      </div>
      {joining && !on ? (
        <form className="cloud-join" onSubmit={join}>
          <input
            value={key}
            onChange={e => setKey(e.target.value)}
            placeholder="Paste the key from your other device"
            aria-label="Backup key"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" className="row-action">
            Link
          </button>
        </form>
      ) : null}
    </div>
  );
}
