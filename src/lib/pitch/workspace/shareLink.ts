import { isUuid } from "@/src/utils/authSession";

export const pitchShareQueryKey = "pitchShare";
const shareRoute = "/intelligence/pitch/shared/";
export function pitchSharePath(shareId: unknown) {
  return isUuid(shareId) ? shareRoute + shareId.toLowerCase() : undefined;
}
export function isPitchSharePath(pathname: string | null) {
  return !!pathname?.startsWith(shareRoute) && isUuid(pathname.slice(shareRoute.length));
}
