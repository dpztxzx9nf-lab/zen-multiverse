// Real seasons from the device date and gentle daily weather.
// Weather is deterministic per 4-hour block of the day (no network, no location):
// everyone opening the garden at the same local time sees the same sky.
import { mulberry32 } from './util.js';

const SOUTH = /^(Australia|Antarctica)\/|^Pacific\/(Auckland|Chatham|Fiji|Tongatapu|Noumea)|^America\/(Argentina|Sao_Paulo|Santiago|Montevideo|Asuncion|La_Paz|Lima)|^Africa\/(Johannesburg|Maputo|Harare|Windhoek|Gaborone|Maseru|Mbabane|Lusaka)|^Indian\/(Mauritius|Reunion)/;

export function computeSeason(date = new Date(), params = new URLSearchParams()) {
  let tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* ignore */ }
  const south = SOUTH.test(tz);
  let m = date.getMonth(); // 0..11
  if (south) m = (m + 6) % 12;
  const day = date.getDate();
  // month + fraction -> season; spring Mar-May, summer Jun-Aug, autumn Sep-Nov, winter Dec-Feb
  let season = m >= 2 && m <= 4 ? 'spring' : m >= 5 && m <= 7 ? 'summer' : m >= 8 && m <= 10 ? 'autumn' : 'winter';
  // late November leans into early winter colors; early March still has a little snow
  const late = (m === 10 && day > 20) || (m === 1 && day > 20);
  const forcedSeason = params.get('season');
  if (['spring', 'summer', 'autumn', 'winter'].includes(forcedSeason)) season = forcedSeason;

  const hour = date.getHours();
  const block = Math.floor(hour / 4);
  const start = new Date(date.getFullYear(), 0, 0);
  const doy = Math.floor((date - start) / 86400000);
  const r = mulberry32(date.getFullYear() * 1000 + doy * 7 + block * 131)();
  const morning = hour >= 5 && hour < 9;
  const P = {
    spring: { rain: 0.16, snow: 0, mist: 0.12 },
    summer: { rain: 0.09, snow: 0, mist: 0.05 },
    autumn: { rain: 0.13, snow: 0, mist: 0.16 },
    winter: { rain: 0.04, snow: 0.3, mist: 0.1 },
  }[season];
  const mistP = P.mist + (morning ? 0.25 : 0);
  let weather = 'clear';
  if (r < P.snow) weather = 'snow';
  else if (r < P.snow + P.rain) weather = 'rain';
  else if (r < P.snow + P.rain + mistP) weather = 'mist';
  const forcedWeather = params.get('weather');
  if (['clear', 'rain', 'snow', 'mist'].includes(forcedWeather)) weather = forcedWeather;
  if (weather === 'snow' && season !== 'winter' && !forcedWeather) weather = 'rain';

  return {
    season, weather, south, late,
    snowCover: season === 'winter' ? (weather === 'snow' ? 1 : 0.55) : (weather === 'snow' ? 0.6 : 0),
    overcast: weather === 'rain' ? 0.85 : weather === 'snow' ? 0.7 : weather === 'mist' ? 0.35 : 0,
    rain: weather === 'rain' ? 1 : 0,
    snow: weather === 'snow' ? 1 : 0,
    mist: weather === 'mist' ? 1 : weather === 'rain' ? 0.5 : weather === 'snow' ? 0.4 : 0,
  };
}
