// Mutations and original downloads append atomic private.pitch_events through pitch_studio_access.
import { after } from 'next/server';
import { pitchDependencies } from '@/src/lib/pitch/data/store';
import { handleLibraryRequest } from '@/src/lib/pitch/library/http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
const handle=(request:Request)=>handleLibraryRequest(request,pitchDependencies(),work=>after(work));
export const GET=handle,POST=handle,PUT=handle;
