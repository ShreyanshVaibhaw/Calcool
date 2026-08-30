// Sunrise/sunset via the NOAA solar equations (pure math, ~1-2 min accuracy).
// Coordinates for the cities the timezone tables already know.

const COORDS: Record<string, [number, number]> = {
  tokyo: [35.68, 139.69],
  osaka: [34.69, 135.5],
  delhi: [28.61, 77.21],
  mumbai: [19.08, 72.88],
  bangalore: [12.97, 77.59],
  kolkata: [22.57, 88.36],
  chennai: [13.08, 80.27],
  london: [51.51, -0.13],
  paris: [48.86, 2.35],
  berlin: [52.52, 13.4],
  madrid: [40.42, -3.7],
  rome: [41.9, 12.5],
  amsterdam: [52.37, 4.9],
  zurich: [47.38, 8.54],
  vienna: [48.21, 16.37],
  stockholm: [59.33, 18.07],
  oslo: [59.91, 10.75],
  copenhagen: [55.68, 12.57],
  dublin: [53.35, -6.26],
  lisbon: [38.72, -9.14],
  athens: [37.98, 23.73],
  istanbul: [41.01, 28.98],
  moscow: [55.76, 37.62],
  dubai: [25.2, 55.27],
  singapore: [1.35, 103.82],
  "hong kong": [22.32, 114.17],
  shanghai: [31.23, 121.47],
  beijing: [39.9, 116.41],
  seoul: [37.57, 126.98],
  bangkok: [13.76, 100.5],
  jakarta: [-6.21, 106.85],
  manila: [14.6, 120.98],
  sydney: [-33.87, 151.21],
  melbourne: [-37.81, 144.96],
  brisbane: [-27.47, 153.03],
  perth: [-31.95, 115.86],
  auckland: [-36.85, 174.76],
  "new york": [40.71, -74.01],
  boston: [42.36, -71.06],
  chicago: [41.88, -87.63],
  houston: [29.76, -95.37],
  dallas: [32.78, -96.8],
  denver: [39.74, -104.99],
  phoenix: [33.45, -112.07],
  seattle: [47.61, -122.33],
  "san francisco": [37.77, -122.42],
  "los angeles": [34.05, -118.24],
  "las vegas": [36.17, -115.14],
  miami: [25.76, -80.19],
  atlanta: [33.75, -84.39],
  toronto: [43.65, -79.38],
  vancouver: [49.28, -123.12],
  montreal: [45.5, -73.57],
  "mexico city": [19.43, -99.13],
  "sao paulo": [-23.55, -46.63],
  "rio de janeiro": [-22.91, -43.17],
  "buenos aires": [-34.6, -58.38],
  lima: [-12.05, -77.04],
  bogota: [4.71, -74.07],
  cairo: [30.04, 31.24],
  lagos: [6.52, 3.38],
  nairobi: [-1.29, 36.82],
  johannesburg: [-26.2, 28.05],
  "cape town": [-33.92, 18.42],
  "tel aviv": [32.09, 34.78],
  karachi: [24.86, 67.01],
  dhaka: [23.81, 90.41],
};

export function cityCoords(word: string): [number, number] | null {
  return COORDS[word.toLowerCase()] ?? null;
}

const rad = (deg: number) => (deg * Math.PI) / 180;

// UTC minutes-of-day for sunrise and sunset on a date (may fall outside 0..1440
// for far-east/west places); null in polar day/night.
export function sunTimesUtc(lat: number, lng: number, dayOfYear: number): { rise: number; set: number } | null {
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1);
  const eqtime =
    229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);
  const cosHa = (Math.cos(rad(90.833)) - Math.sin(rad(lat)) * Math.sin(decl)) / (Math.cos(rad(lat)) * Math.cos(decl));
  if (cosHa < -1 || cosHa > 1) return null; // midnight sun / polar night
  const haDeg = (Math.acos(cosHa) * 180) / Math.PI;
  return {
    rise: 720 - 4 * (lng + haDeg) - eqtime,
    set: 720 - 4 * (lng - haDeg) - eqtime,
  };
}
