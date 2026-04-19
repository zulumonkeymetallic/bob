const cheerio = require('cheerio');

/**
 * Fetch weather for a given location (defaulting to London)
 * Uses Open-Meteo (free, no key)
 */
async function fetchWeather(lat = 51.5074, lon = -0.1278) {
    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Weather API error: ${resp.status}`);
        const data = await resp.json();

        const current = data.current;
        const daily = data.daily;

        // Simple WMO code map
        const weatherCodes = {
            0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
            45: 'Fog', 48: 'Depositing rime fog',
            51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
            61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
            71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow',
            95: 'Thunderstorm'
        };

        const summary = weatherCodes[current.weather_code] || 'Variable';
        const temp = `${current.temperature_2m}${data.current_units.temperature_2m}`;
        const min = daily.temperature_2m_min[0];
        const max = daily.temperature_2m_max[0];

        return {
            summary,
            temp,
            range: `${min}°C - ${max}°C`,
            description: `Currently ${summary}, ${temp}. High of ${max}°C.`
        };
    } catch (e) {
        console.warn('Weather fetch failed:', e.message);
        return null;
    }
}

/**
 * Fetch top news headlines
 * Uses BBC News RSS
 */
async function fetchNews(limit = 5) {
    try {
        const url = 'http://feeds.bbci.co.uk/news/rss.xml';
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`News API error: ${resp.status}`);
        const text = await resp.text();

        const $ = cheerio.load(text, { xmlMode: true });
        const items = [];

        $('item').each((i, el) => {
            if (i >= limit) return false;
            const title = $(el).find('title').text();
            const desc = $(el).find('description').text();
            items.push({ title, description: desc });
        });

        return items;
    } catch (e) {
        console.warn('News fetch failed:', e.message);
        return [];
    }
}

module.exports = {
    fetchWeather,
    fetchNews
};
