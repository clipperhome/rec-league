import type { ScheduleSettings } from "./schedule";

export type ScheduleFormFields = {
  fieldNames: string;
  gameDurationMinutes?: string;
  gameDays: string[];
  gameTimes: string;
  startDate: string;
  timezone: string;
};

export class ScheduleFormValidationError extends Error {
  constructor(
    public readonly field: keyof ScheduleFormFields,
    message: string,
  ) {
    super(message);
    this.name = "ScheduleFormValidationError";
  }
}

export function readScheduleFormFields(formData: FormData): ScheduleFormFields {
  return {
    fieldNames: readString(formData, "fieldNames"),
    gameDurationMinutes: readString(formData, "gameDurationMinutes"),
    gameDays: formData
      .getAll("gameDays")
      .filter((value): value is string => typeof value === "string"),
    gameTimes: readString(formData, "gameTimes"),
    startDate: readString(formData, "startDate"),
    timezone: readString(formData, "timezone"),
  };
}

export function parseScheduleFormFields(
  fields: ScheduleFormFields,
): ScheduleSettings {
  const startDate = fields.startDate.trim();
  const timeZone = fields.timezone.trim();
  const gameDays = fields.gameDays
    .map(Number)
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);
  const rawGameTimes = fields.gameTimes
    .split(/[\n,]+/)
    .map((time) => time.trim())
    .filter(Boolean);
  const normalizedGameTimes = rawGameTimes.map(normalizeTime);
  const gameTimes = [
    ...new Set(normalizedGameTimes.filter((time): time is string => Boolean(time))),
  ].sort();
  const fieldNames = parseUniqueLines(fields.fieldNames, 80);
  const gameDurationMinutes = Number(fields.gameDurationMinutes?.trim() || "60");

  if (!isValidCalendarDate(startDate)) {
    throw new ScheduleFormValidationError(
      "startDate",
      "Choose the first date games may be played.",
    );
  }
  if (!gameDays.length) {
    throw new ScheduleFormValidationError(
      "gameDays",
      "Choose at least one game day.",
    );
  }
  if (
    !gameTimes.length ||
    gameTimes.length > 12 ||
    normalizedGameTimes.some((time) => time === null)
  ) {
    throw new ScheduleFormValidationError(
      "gameTimes",
      "Enter between 1 and 12 valid start times.",
    );
  }
  if (!fieldNames.length || fieldNames.length > 20) {
    throw new ScheduleFormValidationError(
      "fieldNames",
      "Enter between 1 and 20 fields or courts.",
    );
  }
  if (
    !Number.isInteger(gameDurationMinutes) ||
    gameDurationMinutes < 15 ||
    gameDurationMinutes > 480
  ) {
    throw new ScheduleFormValidationError(
      "gameDurationMinutes",
      "Choose a game length from 15 minutes to 8 hours.",
    );
  }
  if (!isValidTimeZone(timeZone)) {
    throw new ScheduleFormValidationError(
      "timezone",
      "Choose the league time zone.",
    );
  }

  return {
    fieldNames,
    gameDurationMinutes,
    gameDays: [...new Set(gameDays)],
    gameTimes,
    startDate,
    timeZone,
  };
}

export function parseUniqueLines(value: string, maxLength = 80): string[] {
  const values: string[] = [];
  const seen = new Set<string>();

  for (const item of value.split(/[\n,]+/)) {
    const trimmed = item.trim();
    const normalized = trimmed.toLowerCase();
    if (!trimmed || seen.has(normalized)) continue;
    seen.add(normalized);
    values.push(trimmed.slice(0, maxLength));
  }

  return values;
}

export function parseGameTimes(value: string): string[] {
  const times = value
    .split(/[\n,]+/)
    .map((time) => normalizeTime(time.trim()))
    .filter((time): time is string => Boolean(time));
  return [...new Set(times)].sort();
}

function normalizeTime(value: string): string | null {
  const twentyFourHour = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (twentyFourHour) {
    return `${twentyFourHour[1].padStart(2, "0")}:${twentyFourHour[2]}`;
  }

  const twelveHour = /^(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*([ap])\.?m\.?$/i.exec(value);
  if (!twelveHour) return null;

  const baseHour = Number(twelveHour[1]) % 12;
  const hour = baseHour + (twelveHour[3].toLowerCase() === "p" ? 12 : 0);
  return `${String(hour).padStart(2, "0")}:${twelveHour[2] ?? "00"}`;
}

function isValidCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    year >= 1 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
  );
}

function isValidTimeZone(value: string): boolean {
  if (!value) return false;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}
