// Clock time + timezone math. Instants are epoch MINUTES; zones are IANA names,
// "Etc/UTC", or "offset:<minutes>". DST correctness comes from the platform ICU
// via Intl, so there is no timezone database to ship.

export interface Wall {
  y: number;
  m: number; // 1-12
  d: number;
  mins: number; // minutes since midnight
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function zoneFmt(zone: string): Intl.DateTimeFormat {
  let f = fmtCache.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
    fmtCache.set(zone, f);
  }
  return f;
}

export function offsetMin(zone: string, epochMs: number): number {
  if (zone.startsWith("offset:")) return parseInt(zone.slice(7), 10);
  const ms = Math.floor(epochMs / 60000) * 60000; // wall clocks are minute-precision; stray seconds would skew the offset
  const parts = zoneFmt(zone).formatToParts(new Date(ms));
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);
  const h = get("hour") % 24; // some ICU builds report midnight as 24
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), h, get("minute"));
  return Math.round((wall - ms) / 60000);
}

export const localZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

// wall clock in a zone -> epoch minutes (two-pass fixup handles DST transitions)
export function wallToEpochMin(zone: string, y: number, m: number, d: number, mins: number): number {
  const guess = Date.UTC(y, m - 1, d) + mins * 60000;
  let epoch = guess - offsetMin(zone, guess) * 60000;
  const off2 = offsetMin(zone, epoch);
  epoch = guess - off2 * 60000;
  return epoch / 60000;
}

export function epochMinToWall(zone: string, epochMin: number): Wall {
  const ms = epochMin * 60000 + offsetMin(zone, epochMin * 60000) * 60000;
  const dt = new Date(ms);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), mins: dt.getUTCHours() * 60 + dt.getUTCMinutes() };
}

// ---------------------------------------------------------------------------
// zone name tables
// ---------------------------------------------------------------------------

const CITIES: Record<string, string> = {
  sydney: "Australia/Sydney", melbourne: "Australia/Melbourne", brisbane: "Australia/Brisbane",
  perth: "Australia/Perth", adelaide: "Australia/Adelaide", auckland: "Pacific/Auckland",
  wellington: "Pacific/Auckland", tokyo: "Asia/Tokyo", osaka: "Asia/Tokyo", seoul: "Asia/Seoul",
  beijing: "Asia/Shanghai", shanghai: "Asia/Shanghai", shenzhen: "Asia/Shanghai", taipei: "Asia/Taipei",
  singapore: "Asia/Singapore", manila: "Asia/Manila", jakarta: "Asia/Jakarta", bangkok: "Asia/Bangkok",
  hanoi: "Asia/Bangkok", yangon: "Asia/Yangon", dhaka: "Asia/Dhaka", kathmandu: "Asia/Kathmandu",
  colombo: "Asia/Colombo", delhi: "Asia/Kolkata", mumbai: "Asia/Kolkata", kolkata: "Asia/Kolkata",
  bangalore: "Asia/Kolkata", bengaluru: "Asia/Kolkata", chennai: "Asia/Kolkata", hyderabad: "Asia/Kolkata",
  pune: "Asia/Kolkata", karachi: "Asia/Karachi", lahore: "Asia/Karachi", tehran: "Asia/Tehran",
  dubai: "Asia/Dubai", riyadh: "Asia/Riyadh", doha: "Asia/Qatar", jerusalem: "Asia/Jerusalem",
  istanbul: "Europe/Istanbul", moscow: "Europe/Moscow", athens: "Europe/Athens", helsinki: "Europe/Helsinki",
  kyiv: "Europe/Kyiv", bucharest: "Europe/Bucharest", warsaw: "Europe/Warsaw", prague: "Europe/Prague",
  vienna: "Europe/Vienna", budapest: "Europe/Budapest", berlin: "Europe/Berlin", munich: "Europe/Berlin",
  frankfurt: "Europe/Berlin", zurich: "Europe/Zurich", geneva: "Europe/Zurich", rome: "Europe/Rome",
  milan: "Europe/Rome", paris: "Europe/Paris", madrid: "Europe/Madrid", barcelona: "Europe/Madrid",
  lisbon: "Europe/Lisbon", london: "Europe/London", edinburgh: "Europe/London", manchester: "Europe/London",
  dublin: "Europe/Dublin", amsterdam: "Europe/Amsterdam", brussels: "Europe/Brussels",
  stockholm: "Europe/Stockholm", oslo: "Europe/Oslo", copenhagen: "Europe/Copenhagen",
  reykjavik: "Atlantic/Reykjavik", cairo: "Africa/Cairo", lagos: "Africa/Lagos", nairobi: "Africa/Nairobi",
  johannesburg: "Africa/Johannesburg", casablanca: "Africa/Casablanca",
  toronto: "America/Toronto", montreal: "America/Toronto", vancouver: "America/Vancouver",
  boston: "America/New_York", nyc: "America/New_York", brooklyn: "America/New_York",
  philadelphia: "America/New_York", washington: "America/New_York", atlanta: "America/New_York",
  miami: "America/New_York", chicago: "America/Chicago", houston: "America/Chicago",
  dallas: "America/Chicago", austin: "America/Chicago", denver: "America/Denver",
  phoenix: "America/Phoenix", seattle: "America/Los_Angeles", portland: "America/Los_Angeles",
  la: "America/Los_Angeles", sf: "America/Los_Angeles", honolulu: "Pacific/Honolulu",
  anchorage: "America/Anchorage", havana: "America/Havana", lima: "America/Lima",
  bogota: "America/Bogota", santiago: "America/Santiago",
  // countries resolve to the usual business zone
  japan: "Asia/Tokyo", korea: "Asia/Seoul", china: "Asia/Shanghai", taiwan: "Asia/Taipei",
  india: "Asia/Kolkata", pakistan: "Asia/Karachi", bangladesh: "Asia/Dhaka", nepal: "Asia/Kathmandu",
  thailand: "Asia/Bangkok", vietnam: "Asia/Bangkok", indonesia: "Asia/Jakarta",
  philippines: "Asia/Manila", malaysia: "Asia/Kuala_Lumpur", australia: "Australia/Sydney",
  uk: "Europe/London", england: "Europe/London", scotland: "Europe/London", ireland: "Europe/Dublin",
  france: "Europe/Paris", germany: "Europe/Berlin", spain: "Europe/Madrid", italy: "Europe/Rome",
  portugal: "Europe/Lisbon", netherlands: "Europe/Amsterdam", belgium: "Europe/Brussels",
  switzerland: "Europe/Zurich", austria: "Europe/Vienna", poland: "Europe/Warsaw",
  sweden: "Europe/Stockholm", norway: "Europe/Oslo", denmark: "Europe/Copenhagen",
  finland: "Europe/Helsinki", greece: "Europe/Athens", turkey: "Europe/Istanbul",
  russia: "Europe/Moscow", ukraine: "Europe/Kyiv", israel: "Asia/Jerusalem", egypt: "Africa/Cairo",
  nigeria: "Africa/Lagos", kenya: "Africa/Nairobi", morocco: "Africa/Casablanca",
  uae: "Asia/Dubai", qatar: "Asia/Qatar", iran: "Asia/Tehran", brazil: "America/Sao_Paulo",
  argentina: "America/Argentina/Buenos_Aires", chile: "America/Santiago", peru: "America/Lima",
  colombia: "America/Bogota", mexico: "America/Mexico_City", canada: "America/Toronto",
  cuba: "America/Havana", iceland: "Atlantic/Reykjavik",
};

const CITY_PAIRS: Record<string, string> = {
  "new york": "America/New_York", "los angeles": "America/Los_Angeles", "san francisco": "America/Los_Angeles",
  "san diego": "America/Los_Angeles", "las vegas": "America/Los_Angeles", "mexico city": "America/Mexico_City",
  "sao paulo": "America/Sao_Paulo", "buenos aires": "America/Argentina/Buenos_Aires",
  "rio de": "America/Sao_Paulo", "kuala lumpur": "Asia/Kuala_Lumpur", "hong kong": "Asia/Hong_Kong",
  "ho chi": "Asia/Ho_Chi_Minh", "tel aviv": "Asia/Jerusalem", "abu dhabi": "Asia/Dubai",
  "new zealand": "Pacific/Auckland", "sri lanka": "Asia/Colombo", "saudi arabia": "Asia/Riyadh",
  "south africa": "Africa/Johannesburg", "south korea": "Asia/Seoul", "cape town": "Africa/Johannesburg",
  "eastern time": "America/New_York", "central time": "America/Chicago",
  "mountain time": "America/Denver", "pacific time": "America/Los_Angeles",
};

const ABBREVS: Record<string, string> = {
  utc: "Etc/UTC", gmt: "Etc/UTC", z: "Etc/UTC",
  est: "America/New_York", edt: "America/New_York", et: "America/New_York",
  cst: "America/Chicago", cdt: "America/Chicago", ct: "America/Chicago",
  mst: "America/Denver", mdt: "America/Denver", mt: "America/Denver",
  pst: "America/Los_Angeles", pdt: "America/Los_Angeles", pt: "America/Los_Angeles",
  akst: "America/Anchorage", akdt: "America/Anchorage", hst: "Pacific/Honolulu",
  bst: "Europe/London", cet: "Europe/Paris", cest: "Europe/Paris", eet: "Europe/Athens",
  ist: "Asia/Kolkata", jst: "Asia/Tokyo", kst: "Asia/Seoul", sgt: "Asia/Singapore",
  hkt: "Asia/Hong_Kong", aest: "Australia/Sydney", aedt: "Australia/Sydney",
  awst: "Australia/Perth", acst: "Australia/Adelaide", nzst: "Pacific/Auckland", nzdt: "Pacific/Auckland",
};

// airport codes must be typed in caps, so "lax rules" stays prose
const AIRPORTS: Record<string, string> = {
  JFK: "America/New_York", EWR: "America/New_York", BOS: "America/New_York", IAD: "America/New_York",
  ATL: "America/New_York", MIA: "America/New_York", ORD: "America/Chicago", DFW: "America/Chicago",
  IAH: "America/Chicago", DEN: "America/Denver", PHX: "America/Phoenix", LAS: "America/Los_Angeles",
  LAX: "America/Los_Angeles", SFO: "America/Los_Angeles", SEA: "America/Los_Angeles",
  YYZ: "America/Toronto", YVR: "America/Vancouver", MEX: "America/Mexico_City", GRU: "America/Sao_Paulo",
  EZE: "America/Argentina/Buenos_Aires", LHR: "Europe/London", LGW: "Europe/London", CDG: "Europe/Paris",
  AMS: "Europe/Amsterdam", FRA: "Europe/Berlin", MUC: "Europe/Berlin", MAD: "Europe/Madrid",
  BCN: "Europe/Madrid", FCO: "Europe/Rome", ZRH: "Europe/Zurich", IST: "Europe/Istanbul",
  SVO: "Europe/Moscow", DXB: "Asia/Dubai", DOH: "Asia/Qatar", BOM: "Asia/Kolkata", DEL: "Asia/Kolkata",
  BLR: "Asia/Kolkata", MAA: "Asia/Kolkata", CCU: "Asia/Kolkata", HYD: "Asia/Kolkata",
  SIN: "Asia/Singapore", KUL: "Asia/Kuala_Lumpur", BKK: "Asia/Bangkok", HKG: "Asia/Hong_Kong",
  PVG: "Asia/Shanghai", PEK: "Asia/Shanghai", ICN: "Asia/Seoul", NRT: "Asia/Tokyo", HND: "Asia/Tokyo",
  SYD: "Australia/Sydney", MEL: "Australia/Melbourne", AKL: "Pacific/Auckland",
};

export function lookupZoneWord(word: string): string | null {
  if (AIRPORTS[word]) return AIRPORTS[word]; // case-sensitive on purpose
  const lower = word.toLowerCase();
  return CITIES[lower] ?? ABBREVS[lower] ?? null;
}

export function lookupZonePair(a: string, b: string): string | null {
  return CITY_PAIRS[`${a.toLowerCase()} ${b.toLowerCase()}`] ?? null;
}
