import assert from "node:assert/strict";
import test from "node:test";

import {
  parseGameTimes,
  parseScheduleFormFields,
  ScheduleFormValidationError,
} from "./schedule-form";

test("normalizes common 12-hour and 24-hour game times", () => {
  assert.deepEqual(parseGameTimes("9am\n10:30 AM\n18:00"), [
    "09:00",
    "10:30",
    "18:00",
  ]);
});

test("parses a complete game rhythm", () => {
  assert.deepEqual(
    parseScheduleFormFields({
      fieldNames: "North Field\nSouth Field\nnorth field",
      gameDays: ["2", "4"],
      gameTimes: "6:00 PM\n19:30",
      startDate: "2026-09-15",
      timezone: "America/Los_Angeles",
    }),
    {
      fieldNames: ["North Field", "South Field"],
      gameDurationMinutes: 60,
      gameDays: [2, 4],
      gameTimes: ["18:00", "19:30"],
      startDate: "2026-09-15",
      timeZone: "America/Los_Angeles",
    },
  );
});

test("accepts staggered starts and leaves overlap prevention to field assignment", () => {
  const settings = parseScheduleFormFields({
    fieldNames: "Court 1\nCourt 2",
    gameDays: ["6"],
    gameDurationMinutes: "75",
    gameTimes: "9:00 AM\n10:00 AM",
    startDate: "2026-09-19",
    timezone: "UTC",
  });

  assert.deepEqual(settings.gameTimes, ["09:00", "10:00"]);
  assert.equal(settings.gameDurationMinutes, 75);
});

test("rejects a calendar date that only matches the date pattern", () => {
  assert.throws(
    () =>
      parseScheduleFormFields({
        fieldNames: "Court 1",
        gameDays: ["6"],
        gameTimes: "9:00 AM",
        startDate: "2026-02-31",
        timezone: "UTC",
      }),
    (error) =>
      error instanceof ScheduleFormValidationError && error.field === "startDate",
  );
});

test("rejects a mixed list containing an invalid time", () => {
  assert.throws(
    () =>
      parseScheduleFormFields({
        fieldNames: "Court 1",
        gameDays: ["6"],
        gameTimes: "9:00 AM\nafter lunch",
        startDate: "2026-09-19",
        timezone: "UTC",
      }),
    (error) =>
      error instanceof ScheduleFormValidationError && error.field === "gameTimes",
  );
});

test("rejects an unknown time zone", () => {
  assert.throws(
    () =>
      parseScheduleFormFields({
        fieldNames: "Court 1",
        gameDays: ["6"],
        gameTimes: "9:00 AM",
        startDate: "2026-09-19",
        timezone: "Moon/Sea_of_Tranquility",
      }),
    (error) =>
      error instanceof ScheduleFormValidationError && error.field === "timezone",
  );
});
