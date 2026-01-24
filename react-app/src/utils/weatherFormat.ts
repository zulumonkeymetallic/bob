export function extractWeatherSummary(weather: any): string | null {
  if (!weather) return null;
  if (typeof weather === 'string') return weather;
  if (typeof weather.summary === 'string') return weather.summary;
  if (typeof weather.description === 'string') return weather.description;
  if (typeof weather.range === 'string') return weather.range;
  return null;
}

export function extractWeatherTemp(weather: any): string | null {
  if (!weather) return null;
  const temp = weather.temp;
  if (typeof temp === 'number') return `${temp}`;
  if (typeof temp === 'string') return temp;
  return null;
}

export function formatWeatherLine(weather: any): string | null {
  const summary = extractWeatherSummary(weather);
  if (!summary) return null;
  const temp = extractWeatherTemp(weather);
  return temp ? `${summary} (${temp})` : summary;
}
