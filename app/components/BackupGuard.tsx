'use client';

import { FormEvent, useEffect, useState } from 'react';
import { getSyncStatus, joinWithKey, SYNC_STATUS_EVENT, type SyncStatus } from '../../lib/cloudSync';

/**
 * Loud, always-visible warning when this browser is NOT linked to the cloud backup (lists look empty,
 * live feeds are off). Deliberately offers only "paste your link" — never "turn on backup", which would
 * start a second empty backup. Waits a few seconds so automatic key recovery can finish first.
 */
export function BackupGuard() {
  const [status, setStatus] = useState<SyncStatus>(() => getSyncStatus());
  const [settled, setSettled] = useState(false);
  const [value, setValue] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    const onStatus = (e: Event) => setStatus({ ...(e as CustomEvent<SyncStatus>).detail });
    window.addEventListener(SYNC_STATUS_EVENT, onStatus);
    const t = window.setTimeout(() => setSettled(true), 4000);
    return () => {
      window.removeEventListener(SYNC_STATUS_EVENT, onStatus);
      window.clearTimeout(t);
    };
  }, []);

  if (!settled || status.state !== 'off') return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    setMsg('Linking…');
    const r = await joinWithKey(value);
    setMsg(r.state === 'ok' ? '' : r.error === 'wrong_key' ? "That link doesn't match your backup." : 'Could not link — try again.');
    if (r.state === 'ok') setValue('');
  }

  return (
    <div className="backup-guard" role="alert">
      <strong>▲ This browser is not linked to your backup.</strong> Your lists may look empty here, but your data is safe in the cloud. Paste your
      “Link another device” link to reconnect — don’t press “Turn on backup”.
      <form onSubmit={submit}>
        <input value={value} onChange={e => setValue(e.target.value)} placeholder="Paste backup link or key" aria-label="Backup link or key" autoComplete="off" spellCheck={false} />
        <button type="submit" className="row-action">Reconnect</button>
        {msg ? <span>{msg}</span> : null}
      </form>
    </div>
  );
}
