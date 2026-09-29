/**
 * NJP CALL — dates, heures et numéros, tels qu'on les dit au téléphone.
 *
 * Tout est calculé en **Europe/Paris**, changement d'heure compris. Une heure
 * qui n'existe pas (le dernier dimanche de mars, entre 2 h et 3 h) ou qui
 * existe deux fois (le dernier dimanche d'octobre, entre 2 h et 3 h) est
 * signalée comme telle : on la fait préciser, on ne la devine pas.
 *
 * Une date ou une heure comprise n'est **jamais** définitive ici : elle sera
 * reformulée à l'appelant avant toute opération.
 */

export const TIMEZONE = "Europe/Paris";

export interface LocalDate {
  y: number;
  m: number; // 1-12
  d: number;
}
export interface LocalTime {
  h: number;
  min: number;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** Décalage de Paris (en minutes) à l'instant UTC donné. */
export const parisOffsetMinutes = (utcMs: number): number => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  );
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
};

const offsetString = (minutes: number) => {
  const sign = minutes >= 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
};

export type LocalResolution =
  | { kind: "ok"; iso: string; utcMs: number }
  | { kind: "nonexistent" }
  | { kind: "ambiguous"; candidates: string[] };

/**
 * Convertit une heure murale de Paris en instant. Examine les deux décalages
 * possibles (+01:00, +02:00) et garde ceux qui retombent sur la même heure
 * murale : zéro ⇒ heure inexistante, deux ⇒ heure ambiguë.
 */
export const parisLocalToInstant = (
  date: LocalDate,
  time: LocalTime
): LocalResolution => {
  const wall = Date.UTC(date.y, date.m - 1, date.d, time.h, time.min);
  const candidates: number[] = [];
  for (const off of [60, 120]) {
    const utc = wall - off * 60000;
    if (parisOffsetMinutes(utc) === off) candidates.push(utc);
  }
  const iso = (utc: number) => {
    const off = parisOffsetMinutes(utc);
    return `${date.y}-${pad(date.m)}-${pad(date.d)}T${pad(time.h)}:${pad(time.min)}:00${offsetString(off)}`;
  };
  if (candidates.length === 0) return { kind: "nonexistent" };
  if (candidates.length === 2)
    return {
      kind: "ambiguous",
      candidates: candidates.sort((a, b) => a - b).map(iso),
    };
  return { kind: "ok", iso: iso(candidates[0]), utcMs: candidates[0] };
};

/** Date murale de Paris à l'instant donné. */
export const parisDateOf = (utcMs: number): LocalDate & { weekday: number } => {
  const local = new Date(utcMs + parisOffsetMinutes(utcMs) * 60000);
  return {
    y: local.getUTCFullYear(),
    m: local.getUTCMonth() + 1,
    d: local.getUTCDate(),
    weekday: local.getUTCDay(),
  };
};

const addDays = (date: LocalDate, n: number): LocalDate => {
  const t = new Date(Date.UTC(date.y, date.m - 1, date.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};

const validDate = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return (
    t.getUTCFullYear() === y &&
    t.getUTCMonth() === m - 1 &&
    t.getUTCDate() === d
  );
};

const MONTHS: Record<string, number> = {
  janvier: 1,
  fevrier: 2,
  mars: 3,
  avril: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  aout: 8,
  septembre: 9,
  octobre: 10,
  novembre: 11,
  decembre: 12,
};
const WEEKDAYS: Record<string, number> = {
  dimanche: 0,
  lundi: 1,
  mardi: 2,
  mercredi: 3,
  jeudi: 4,
  vendredi: 5,
  samedi: 6,
};

/** Minuscules, sans accents, espaces normalisés. */
export const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .trim();

export interface DateTimeReading {
  date?: LocalDate;
  time?: LocalTime;
  /** Partie de journée, si seule elle est dite (« demain matin »). */
  period?: "matin" | "apres-midi" | "soir";
  /** Pourquoi il faut faire préciser. Vide ⇒ lecture sans ambiguïté connue. */
  ambiguities: string[];
}

/**
 * Lit une date et une heure dans une phrase française. `nowMs` fixe
 * « aujourd'hui » (Paris). Ne lève jamais : ce qui n'est pas compris est
 * absent, ce qui est incertain est listé dans `ambiguities`.
 */
export const readDateTime = (
  sentence: string,
  nowMs: number
): DateTimeReading => {
  const s = fold(sentence);
  const today = parisDateOf(nowMs);
  const out: DateTimeReading = { ambiguities: [] };

  // -- Date ------------------------------------------------------------------
  if (/\bapres[- ]demain\b/.test(s)) out.date = addDays(today, 2);
  else if (/\bdemain\b/.test(s)) out.date = addDays(today, 1);
  else if (
    /\baujourd'?hui\b|\bce (matin|soir|midi)\b|\bcet apres[- ]midi\b/.test(s)
  )
    out.date = { y: today.y, m: today.m, d: today.d };

  const explicit = s.match(
    /\b(?:le )?(1er|[0-3]?\d) (janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)(?: (\d{4}))?\b/
  );
  const numeric = s.match(/\b([0-3]?\d)\/([01]?\d)(?:\/(\d{2,4}))?\b/);
  if (!out.date && (explicit || numeric)) {
    const d = explicit
      ? explicit[1] === "1er"
        ? 1
        : Number(explicit[1])
      : Number(numeric![1]);
    const m = explicit ? MONTHS[explicit[2]] : Number(numeric![2]);
    const yRaw = explicit ? explicit[3] : numeric![3];
    let y = yRaw ? Number(yRaw.length === 2 ? `20${yRaw}` : yRaw) : today.y;
    if (!yRaw && (m < today.m || (m === today.m && d < today.d))) y += 1; // prochaine occurrence
    if (validDate(y, m, d)) out.date = { y, m, d };
    else out.ambiguities.push("date_invalide");
  }

  if (!out.date) {
    const wd = s.match(
      /\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)( prochain)?\b/
    );
    if (wd) {
      const target = WEEKDAYS[wd[1]];
      let delta = (target - today.weekday + 7) % 7;
      if (delta === 0) {
        // « lundi » dit un lundi : aujourd'hui ou dans sept jours ?
        if (!wd[2]) out.ambiguities.push("jour_de_semaine_aujourdhui");
        delta = 7;
      }
      out.date = addDays(today, delta);
    } else {
      const dayOnly = s.match(/\ble (1er|[0-3]?\d)\b(?! ?h)/);
      if (dayOnly) {
        const d = dayOnly[1] === "1er" ? 1 : Number(dayOnly[1]);
        let { y, m } = today;
        if (d < today.d) {
          m += 1;
          if (m > 12) {
            m = 1;
            y += 1;
          }
        }
        if (validDate(y, m, d)) {
          out.date = { y, m, d };
          out.ambiguities.push("mois_non_precise");
        }
      }
    }
  }

  // -- Heure -----------------------------------------------------------------
  const hm = s.match(/\b([01]?\d|2[0-3]) ?(?:h|heures?)(?: ?([0-5]\d))?\b/);
  if (/\bmidi\b/.test(s) && !/apres[- ]midi/.test(s))
    out.time = { h: 12, min: 0 };
  else if (/\bminuit\b/.test(s)) out.time = { h: 0, min: 0 };
  else if (hm) {
    let h = Number(hm[1]);
    const min = hm[2]
      ? Number(hm[2])
      : /\bet demie\b/.test(s)
        ? 30
        : /\bet quart\b/.test(s)
          ? 15
          : 0;
    const pm = /\b(de l'apres[- ]midi|du soir)\b/.test(s);
    const am = /\bdu matin\b/.test(s);
    if (pm && h < 12) h += 12;
    if (!pm && !am && h >= 1 && h <= 7)
      out.ambiguities.push("heure_matin_ou_apres_midi");
    out.time = { h, min };
  }
  if (!out.time) {
    if (/\bmatin(ee)?\b/.test(s)) out.period = "matin";
    else if (/\bapres[- ]midi\b/.test(s)) out.period = "apres-midi";
    else if (/\bsoir(ee)?\b/.test(s)) out.period = "soir";
  }

  if (out.date && out.time) {
    const r = parisLocalToInstant(out.date, out.time);
    if (r.kind === "nonexistent")
      out.ambiguities.push("heure_inexistante_changement_heure");
    if (r.kind === "ambiguous")
      out.ambiguities.push("heure_double_changement_heure");
  }
  return out;
};

// ---------------------------------------------------------------------------
// Numéros de téléphone dictés
// ---------------------------------------------------------------------------

const UNITS: Record<string, number> = {
  zero: 0,
  un: 1,
  une: 1,
  deux: 2,
  trois: 3,
  quatre: 4,
  cinq: 5,
  six: 6,
  sept: 7,
  huit: 8,
  neuf: 9,
  dix: 10,
  onze: 11,
  douze: 12,
  treize: 13,
  quatorze: 14,
  quinze: 15,
  seize: 16,
  "dix-sept": 17,
  "dix-huit": 18,
  "dix-neuf": 19,
};
const TENS: Record<string, number> = {
  vingt: 20,
  trente: 30,
  quarante: 40,
  cinquante: 50,
  soixante: 60,
};

/** « soixante-dix-huit » → 78, « quatre-vingt-douze » → 92, « zéro » → 0. */
const wordsToNumber = (
  tokens: string[]
): { value: number; digits: number } | null => {
  const t = tokens.join("-");
  if (t in UNITS)
    return {
      value: UNITS[t],
      digits: t === "zero" ? 1 : UNITS[t] >= 10 ? 2 : 1,
    };
  const m = t.match(
    /^(vingt|trente|quarante|cinquante|soixante|quatre-vingts?)(?:-(et-)?(.+))?$/
  );
  if (!m) return null;
  const base = m[1].startsWith("quatre-vingt") ? 80 : TENS[m[1]];
  const rest = m[3] ? UNITS[m[3]] : 0;
  if (m[3] && rest === undefined) return null;
  if ((base === 60 || base === 80) && rest >= 0 && rest <= 19)
    return { value: base + rest, digits: 2 };
  if (rest > 9) return null;
  return { value: base + rest, digits: 2 };
};

/**
 * Normalise un numéro français dicté ou tapé en E.164. Rend `null` si le
 * résultat n'est pas un numéro français plausible : on redemande, on ne
 * complète pas.
 */
export const readFrenchPhone = (spoken: string): string | null => {
  const s = fold(spoken)
    .replace(/\+33/g, " zero ")
    .replace(/[.\-/]/g, " ");
  let digits = "";
  const words = s.split(/[ ,]+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (/^\d+$/.test(w)) {
      digits += w;
      continue;
    }
    // Essaie les formes composées « quatre vingt dix neuf » avant les simples.
    let matched = false;
    for (let len = Math.min(4, words.length - i); len >= 1; len--) {
      const n = wordsToNumber(words.slice(i, i + len));
      if (n) {
        digits += n.digits === 2 ? pad(n.value) : String(n.value);
        i += len - 1;
        matched = true;
        break;
      }
    }
    if (!matched && !/^(le|mon|numero|c'est|est|au|et)$/.test(w)) return null;
  }
  if (/^0[1-9]\d{8}$/.test(digits)) return `+33${digits.slice(1)}`;
  if (/^33[1-9]\d{8}$/.test(digits)) return `+${digits}`;
  return null;
};

/** Pour la reformulation orale : « 06 12 34 56 78 ». */
export const speakPhone = (e164: string) =>
  e164.startsWith("+33")
    ? `0${e164.slice(3)}`.replace(/(\d{2})(?=\d)/g, "$1 ")
    : e164;

/** Pour la reformulation orale : « lundi 5 octobre à 14 h 30 ». */
export const speakInstant = (iso: string) => {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("fr-FR", {
    timeZone: TIMEZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d);
  const [h, m] = new Intl.DateTimeFormat("fr-FR", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(d)
    .split(":");
  return `${day} à ${Number(h)} h${m === "00" ? "" : ` ${m}`}`;
};
