import { expect, test } from "bun:test";
import { appNameSchema, shortAppName } from "../src/workspace-name";

test("app names summarize existing requests while preserving short chosen names", () => {
  expect(
    shortAppName(
      "Create an orbit dashboard with OpenUI controls driving a Three.js scene",
    ),
  ).toBe("Orbit Lab");
  expect(
    shortAppName(
      "montre moi le system solaire en 3d, explique moi comment ca marche",
    ),
  ).toBe("Solar System");
  expect(
    shortAppName(
      "i need a app that does presentations that's connected to chatgpt spaces",
    ),
  ).toBe("Slide Studio");
  expect(
    shortAppName("Create a compact weekly planning canvas with a Notes field"),
  ).toBe("Week Planner");
  expect(shortAppName("My Atlas")).toBe("My Atlas");
  expect(shortAppName("please build me a habit tracker")).toBe("Habit Tracker");
  expect(shortAppName("!!!")).toBe("New App");
});
test("rename validation rejects long, multiword and control-character names", () => {
  for (const name of [
    "",
    "An app with four words",
    "a".repeat(33),
    "One\nTwo",
    "One\u0000Two",
  ])
    expect(appNameSchema.safeParse(name).success).toBe(false);
  for (const name of ["Orbit", "Solar System", "Mon Atlas", "星空"])
    expect(appNameSchema.safeParse(name).success).toBe(true);
});
