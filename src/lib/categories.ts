export interface Category { id: string; label: string; color: string; glyph: string }

/** Hand-drawn 16×16 stroke glyphs: no icon font, so the set feels like one instrument. */
export const CATEGORIES: Category[] = [
  { id: 'wildfires', label: 'Wildfires', color: '#ff6a2b',
    glyph: 'M8 14.5c-2.6 0-4.3-1.8-4.3-4.1 0-2.1 1.4-3.3 2.3-4.6.5 1 .9 1.6 1.7 2 .1-2.2 1-4.4 2.6-6.1.3 2.2 2.4 3.9 2.4 7.2 0 3.2-2 5.6-4.7 5.6z' },
  { id: 'severeStorms', label: 'Severe storms', color: '#8ec5ff',
    glyph: 'M6.4 8a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0M9.6 8c0-3.5-2-5.5-5.5-5.8M6.4 8c0 3.5 2 5.5 5.5 5.8' },
  { id: 'volcanoes', label: 'Volcanoes', color: '#ff3b2f',
    glyph: 'M1.5 14h13l-3.8-7H5.3zM6.5 7 8 5l1.5 2M8 4.2V1.5M5.6 2.6l-.9-.9M10.4 2.6l.9-.9' },
  { id: 'floods', label: 'Floods', color: '#4fb3bf',
    glyph: 'M1.5 6.5c1.1 0 1.6-1 2.7-1s1.6 1 2.7 1 1.6-1 2.7-1 1.6 1 2.7 1 1.6-1 2.2-1M1.5 10.5c1.1 0 1.6-1 2.7-1s1.6 1 2.7 1 1.6-1 2.7-1 1.6 1 2.7 1 1.6-1 2.2-1' },
  { id: 'seaLakeIce', label: 'Sea & lake ice', color: '#d6eef2',
    glyph: 'M1.5 9.5h13M4 9.5l2-5 2 1.5 1.5-2.5 2.5 6M5 9.5l1.5 4h3.5l1.5-4' },
  { id: 'earthquakes', label: 'Earthquakes', color: '#f2c14e',
    glyph: 'M1 8h3l1.5-4 2 8 2-6 1.5 2H15' },
  { id: 'landslides', label: 'Landslides', color: '#c49a6c',
    glyph: 'M1.5 13.5h13M1.5 13.5V3.5L6 7l2.5 3 6 3.5M9.5 5.5a1 1 0 1 0 .01 0M12 8.5a.8.8 0 1 0 .01 0' },
  { id: 'dustHaze', label: 'Dust & haze', color: '#d9b26f',
    glyph: 'M2 5h7M11 5h3M1.5 8h4M7.5 8h7M3 11h8M13 11h1.5' },
  { id: 'drought', label: 'Drought', color: '#c9a04a',
    glyph: 'M8 2.5a3 3 0 1 1 0 6 3 3 0 1 1 0-6M1.5 12.5h13M5 12.5l1 2M10 12.5l-1 2' },
  { id: 'tempExtremes', label: 'Temperature extremes', color: '#ff9466',
    glyph: 'M6.5 9.5V3a1.5 1.5 0 0 1 3 0v6.5a3 3 0 1 1-3 0zM8 6v6' },
  { id: 'snow', label: 'Snow', color: '#f2f4f5',
    glyph: 'M8 1.5v13M2.4 4.75l11.2 6.5M2.4 11.25l11.2-6.5' },
  { id: 'waterColor', label: 'Water colour', color: '#57d1b5',
    glyph: 'M8 1.8c2.3 3 4.2 5.4 4.2 7.8a4.2 4.2 0 0 1-8.4 0C3.8 7.2 5.7 4.8 8 1.8z' },
  { id: 'manmade', label: 'Manmade', color: '#a7a39a',
    glyph: 'M1.5 14V8l4-2.5V8l4-2.5V8l4-2.5V14zM11.5 5V2h2v3' },
]

export const FIRE_GLYPH = 'M6.5 8a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0M3.5 4.5h.01M12 3.5h.01M12.5 11.5h.01M4 12h.01'

export const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.id, c])) as Record<string, Category>
export const catOf = (id: string): Category => CAT[id] ?? CAT.manmade
