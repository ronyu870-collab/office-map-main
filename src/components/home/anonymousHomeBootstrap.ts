import { getAuthStorageKey, PUBLIC_SUPABASE_URL } from '@/src/services/authStorageKey';

/** A document-only shortcut. The presence of storage never authorizes anything. */
export function anonymousHomeBootstrap(): string {
  let storageKey: string;
  try {
    storageKey = JSON.stringify(getAuthStorageKey(PUBLIC_SUPABASE_URL)).replace(/</g, '\\u003c');
  } catch {
    return '';
  }
  // If storage cannot be read, there might be a session: leave it to Supabase.
  // Auth callbacks and possible legacy/trusted sessions also take the usual path.
  return `try{if(location.pathname==='/'&&!location.search&&!location.hash&&!sessionStorage.getItem(${storageKey})&&!localStorage.getItem(${storageKey})){location.replace('/login')}}catch{}`;
}
