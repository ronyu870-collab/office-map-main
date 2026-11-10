/** A document-only shortcut. The presence of storage never authorizes anything. */
export function anonymousHomeBootstrap(): string {
  let storageKey: string;
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://example.supabase.co');
    // Match the SDK default used by the existing client. The isolated browser
    // regression also verifies that reopening with a stored SDK session stays here.
    storageKey = JSON.stringify(`sb-${url.hostname.split('.')[0]}-auth-token`).replace(/</g, '\\u003c');
  } catch {
    return '';
  }
  // If storage cannot be read, there might be a session: leave it to Supabase.
  // Auth callbacks and possible legacy/trusted sessions also take the usual path.
  return `try{if(location.pathname==='/'&&!location.search&&!location.hash&&!sessionStorage.getItem(${storageKey})&&!localStorage.getItem(${storageKey})){location.replace('/login')}}catch{}`;
}
