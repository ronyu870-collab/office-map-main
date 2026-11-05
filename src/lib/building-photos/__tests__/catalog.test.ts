import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readBuildingPhotoCatalog } from '../catalog';
import { photoSummaries, publicPhotoUrl } from '../model';

const building = '11111111-1111-4111-8111-111111111111';
const photo = (index: number) => ({ id: `22222222-2222-4222-8222-${String(index).padStart(12, '0')}`, building_id: building, caption: `外观 ${index}` });

describe('building photo map summaries', () => {
  it('keeps captions and ids only, discarding malformed records and asset URLs', () => {
    expect(photoSummaries([null, { id: 'bad', caption: '不显示' }, { ...photo(1), caption: '' }, { ...photo(2), image_url: 'private', storage_path: 'private', notes: 'private' }]))
      .toEqual([{ id: photo(2).id, caption: '外观 2' }]);
  });
  it('paginates a full API page and scopes all summaries to ready, active, tracked buildings', async () => {
    const calls: { op: string; args: unknown[] }[] = [];
    const chain: Record<string, unknown> = {};
    for (const op of ['select', 'eq', 'order']) chain[op] = (...args: unknown[]) => { calls.push({ op, args }); return chain; };
    chain.range = vi.fn().mockResolvedValueOnce({ data: Array.from({ length: 1000 }, (_, i) => photo(i)), error: null })
      .mockResolvedValueOnce({ data: [photo(1000)], error: null });
    const from = vi.fn(() => chain);
    const catalog = await readBuildingPhotoCatalog({ from } as unknown as SupabaseClient);
    expect(catalog.get(building)).toHaveLength(1001);
    expect(catalog.get(building)?.[1000]).toEqual({ id: photo(1000).id, caption: '外观 1000' });
    expect(chain.range).toHaveBeenNthCalledWith(1, 0, 999);
    expect(chain.range).toHaveBeenNthCalledWith(2, 1000, 1999);
    expect(from).toHaveBeenCalledWith('building_photos');
    for (const args of [['status', 'ready'], ['buildings.is_active', true], ['buildings.tracking_scope', 'tracked']]) {
      expect(calls).toContainEqual({ op: 'eq', args });
    }
    const projection = calls.find(call => call.op === 'select')?.args[0];
    expect(projection).toContain('buildings!inner');
    expect(projection).not.toContain('url');
    expect(projection).not.toContain('storage_path');
  });
  it('reports database failures instead of returning a misleading empty catalog', async () => {
    const chain: Record<string, unknown> = {};
    for (const op of ['select', 'eq', 'order']) chain[op] = () => chain;
    chain.range = async () => ({ data: null, error: new Error('unavailable') });
    await expect(readBuildingPhotoCatalog({ from: () => chain } as unknown as SupabaseClient)).rejects.toThrow('unavailable');
  });
  it.each(['data:image/png;base64,AA', '//images.example.com/a.jpg', 'https://127.0.0.1/a', 'https://[::1]/a', 'https://local/a', 'https://x.internal/a', 'https://foo.example.com:3000/a', 'https://user:pass@example.com/a'])('refuses unsafe external link %s', value => {
    expect(publicPhotoUrl(value)).toBeNull();
  });
  it('allows a public HTTPS image and a provenance page using HTTP only when explicit', () => {
    expect(publicPhotoUrl('https://images.example.com/photo.webp')).toBe('https://images.example.com/photo.webp');
    expect(publicPhotoUrl('http://www.example.com/project')).toBeNull();
    expect(publicPhotoUrl('http://www.example.com/project', true)).toBe('http://www.example.com/project');
  });
});
