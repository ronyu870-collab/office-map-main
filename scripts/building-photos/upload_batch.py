#!/usr/bin/env python3
"""Upload an approved local photo batch and independently verify signed reads.

The auth file is an ephemeral JSON object with batch_token and optional anon_key.
The local plan is an array containing id, building_name, local_path, storage_path,
mime_type, sha256 and file_size. It must match the deployed function's allowlist.
Receipts omit credentials and signed URLs, and are atomically saved after each
successful photo so a transport failure can be resumed without overwriting data.
"""
import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from datetime import datetime, timezone


def digest(data):
    return hashlib.sha256(data).hexdigest()


def upload_one(photo, endpoint, auth):
    content = Path(photo['local_path']).read_bytes()
    if len(content) != photo['file_size'] or digest(content) != photo['sha256']:
        raise ValueError('Local file does not match the approved batch')
    headers = {
        'Content-Type': photo['mime_type'], 'Content-Length': str(len(content)),
        'x-batch-token': auth['batch_token'], 'x-photo-id': photo['id'],
    }
    if auth.get('anon_key'):
        headers['Authorization'] = 'Bearer ' + auth['anon_key']
        headers['apikey'] = auth['anon_key']
    try:
        with urlopen(Request(endpoint, data=content, headers=headers, method='POST'), timeout=120) as response:
            receipt = json.load(response)
    except HTTPError as error:
        # Never include request headers or credentials in progress/errors.
        raise RuntimeError(f'Transfer returned HTTP {error.code}') from None
    if (receipt.get('id') != photo['id'] or receipt.get('storage_path') != photo['storage_path']
            or receipt.get('sha256') != photo['sha256'] or receipt.get('file_size') != photo['file_size']
            or receipt.get('verified') is not True):
        raise ValueError('Transfer receipt does not match the approved photo')
    signed_url = receipt.pop('signed_url', '')
    parsed, expected = urlparse(signed_url), urlparse(endpoint)
    if parsed.scheme != 'https' or parsed.netloc != expected.netloc or not parsed.path.startswith('/storage/v1/object/sign/building-sales-materials/'):
        raise ValueError('Unexpected signed readback origin or path')
    with urlopen(Request(signed_url, headers={'User-Agent': 'Colliers-photo-verification/1.0'}), timeout=120) as response:
        downloaded = response.read(photo['file_size'] + 1)
        image_type = response.headers.get_content_type()
    if (len(downloaded) != photo['file_size'] or digest(downloaded) != photo['sha256']
            or image_type != photo['mime_type']):
        raise ValueError('Independent signed readback did not match the approved bytes/type')
    receipt.update({
        'building_name': photo['building_name'], 'signed_read_verified': True,
        'mime_type': image_type, 'verified_at': datetime.now(timezone.utc).isoformat(),
    })
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', required=True)
    parser.add_argument('--auth-file', required=True)
    parser.add_argument('--endpoint', required=True)
    parser.add_argument('--receipts', required=True)
    parser.add_argument('--workers', type=int, default=3)
    args = parser.parse_args()
    if not 1 <= args.workers <= 4:
        parser.error('--workers must be between 1 and 4')
    endpoint = urlparse(args.endpoint)
    if endpoint.scheme != 'https' or not endpoint.hostname or not endpoint.hostname.endswith('.supabase.co'):
        parser.error('Expected an HTTPS Supabase function endpoint')
    auth_path = Path(args.auth_file)
    if auth_path.stat().st_mode & 0o077:
        parser.error('The auth file must be readable only by its owner (mode 0600)')
    auth = json.loads(auth_path.read_text())
    plan = json.loads(Path(args.plan).read_text())
    if not plan or len({p['id'] for p in plan}) != len(plan):
        parser.error('Empty plan or duplicate photo IDs')
    output = Path(args.receipts)
    receipts = json.loads(output.read_text()) if output.exists() else []
    for r in receipts:
        matches = [p for p in plan if p['id'] == r['id'] and p['sha256'] == r['sha256']
                   and p['storage_path'] == r['storage_path'] and r.get('signed_read_verified')]
        if len(matches) != 1:
            parser.error('Existing receipt does not belong to the approved plan')
    done = {r['id'] for r in receipts}
    pending = [p for p in plan if p['id'] not in done]
    failures = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        tasks = {pool.submit(upload_one, p, args.endpoint, auth): p for p in pending}
        for task in concurrent.futures.as_completed(tasks):
            photo = tasks[task]
            try:
                receipts.append(task.result())
                temporary = output.with_suffix(output.suffix + '.tmp')
                temporary.write_text(json.dumps(receipts, ensure_ascii=False, indent=2) + '\n')
                os.replace(temporary, output)
                print(f"VERIFIED {len(receipts)}/{len(plan)} {photo['building_name']}", flush=True)
            except Exception as error:
                # Known validation/HTTP errors contain no sensitive URLs.
                reason = str(error) if isinstance(error, (ValueError, RuntimeError)) else type(error).__name__
                failures.append(photo['id'])
                print(f"FAILED {photo['building_name']}: {reason}", flush=True)
    if failures:
        raise SystemExit(f'{len(failures)} photo(s) remain unverified; rerun after resolving the cause')
    print(f'COMPLETE {len(receipts)} independently verified private objects', flush=True)


if __name__ == '__main__':
    main()
