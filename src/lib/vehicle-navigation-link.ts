/**
 * Builds a walking-directions deep link to hand off to the phone's native maps
 * app. Neither branch needs an explicit origin — both resolve "current location"
 * as the starting point inside the native app itself once it opens.
 */
export function buildWalkingDirectionsUrl(lat: number, lon: number, isIosDevice: boolean): string {
  if (isIosDevice) {
    return `https://maps.apple.com/?daddr=${lat},${lon}&dirflg=w`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=walking`;
}
