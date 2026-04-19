export interface GeocodeResult {
  lat: number;
  lon: number;
  displayName: string;
  countryCode?: string; // ISO alpha-2, uppercased
  city?: string;
}

/**
 * Geocode a free-form place string using Nominatim (OSM)
 * Returns the first best match with lat/lon and some metadata
 */
export async function geocodePlace(query: string): Promise<GeocodeResult | null> {
  if (!query || !query.trim()) return null;
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=1`;
  try {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (!Array.isArray(json) || json.length === 0) return null;
    const best = json[0];
    const address = best.address || {};
    const cityLike = address.city || address.town || address.village || address.hamlet || undefined;
    const countryCode = (address.country_code || '').toUpperCase() || undefined;
    return {
      lat: parseFloat(best.lat),
      lon: parseFloat(best.lon),
      displayName: best.display_name || query,
      countryCode,
      city: cityLike,
    };
  } catch (e) {
    console.warn('geocodePlace error', e);
    return null;
  }
}

