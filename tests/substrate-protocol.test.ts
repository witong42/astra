import { describe, expect, test } from "bun:test";
import {
  extractCompleteLines,
  MAX_CSS_LENGTH,
  MAX_HTML_LENGTH,
  parseOpLine,
  validateOp,
} from "../src/substrate-protocol";

describe("extractCompleteLines", () => {
  test("returns complete lines and keeps the unfinished remainder", () => {
    const buffer =
      '{"op":"note","text":"a"}\n{"op":"remove","sel":".x"}\n{"op":"sty';

    const { lines, rest } = extractCompleteLines(buffer);

    expect(lines).toEqual([
      '{"op":"note","text":"a"}',
      '{"op":"remove","sel":".x"}',
    ]);
    expect(rest).toBe('{"op":"sty');
  });

  test("returns empty lines array when buffer has no newline", () => {
    const { lines, rest } = extractCompleteLines('{"op":"note"');

    expect(lines).toEqual([]);
    expect(rest).toBe('{"op":"note"');
  });

  test("drops blank lines between ops", () => {
    const { lines } = extractCompleteLines(
      '{"op":"remove","sel":".x"}\n\n  \n',
    );

    expect(lines).toEqual(['{"op":"remove","sel":".x"}']);
  });
});

describe("parseOpLine", () => {
  test("parses a valid replace op", () => {
    const result = parseOpLine(
      '{"op":"replace","sel":"#substrate h1","html":"<h1>New</h1>"}',
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.op).toEqual({
        op: "replace",
        sel: "#substrate h1",
        html: "<h1>New</h1>",
      });
    }
  });

  test("rejects markdown fence lines", () => {
    const result = parseOpLine("```json");

    expect(result.ok).toBe(false);
  });

  test("rejects non-JSON garbage with a truncated error", () => {
    const result = parseOpLine("here are your ops:");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not valid JSON");
    }
  });
});

describe("validateOp", () => {
  test("rejects unknown op actions", () => {
    const result = validateOp({ op: "execute", sel: "body" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("unknown op");
    }
  });

  test("rejects arrays and primitives", () => {
    expect(validateOp([]).ok).toBe(false);
    expect(validateOp("remove").ok).toBe(false);
    expect(validateOp(null).ok).toBe(false);
  });

  test("rejects replace op with missing html", () => {
    const result = validateOp({ op: "replace", sel: ".x" });

    expect(result.ok).toBe(false);
  });

  test("rejects html payload over the size limit", () => {
    const result = validateOp({
      op: "append",
      sel: "#substrate",
      html: "x".repeat(MAX_HTML_LENGTH + 1),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("exceeds");
    }
  });

  test("accepts font imports inside the isolated canvas", () => {
    const result = validateOp({
      op: "style",
      css: '@import url("https://fonts.googleapis.com/css2?family=Inter");',
    });

    expect(result.ok).toBe(true);
  });

  test("rejects css that targets the shell UI", () => {
    expect(
      validateOp({ op: "style", css: "#shell-root { display: none; }" }).ok,
    ).toBe(false);
    expect(
      validateOp({ op: "style", css: "[data-shell] { opacity: 0; }" }).ok,
    ).toBe(false);
  });

  test("accepts a valid remove op", () => {
    const result = validateOp({ op: "remove", sel: "#substrate .stale" });
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.op).toEqual({ op: "remove", sel: "#substrate .stale" });
  });

  test("rejects a remove op with a missing selector", () => {
    expect(validateOp({ op: "remove" }).ok).toBe(false);
  });

  test("accepts html exactly at the size limit and rejects one over", () => {
    expect(
      validateOp({
        op: "append",
        sel: "#substrate",
        html: "x".repeat(MAX_HTML_LENGTH),
      }).ok,
    ).toBe(true);
    expect(
      validateOp({
        op: "append",
        sel: "#substrate",
        html: "x".repeat(MAX_HTML_LENGTH + 1),
      }).ok,
    ).toBe(false);
  });

  test("rejects attr ops with malformed attribute names", () => {
    expect(
      validateOp({ op: "attr", sel: "a", name: "1foo", value: "x" }).ok,
    ).toBe(false);
    expect(
      validateOp({ op: "attr", sel: "a", name: "foo bar", value: "x" }).ok,
    ).toBe(false);
  });

  test("rejects css over the size limit", () => {
    const result = validateOp({
      op: "style",
      css: "a".repeat(MAX_CSS_LENGTH + 1),
    });

    expect(result.ok).toBe(false);
  });

  test("accepts attr op setting an event handler (scripts run live by design)", () => {
    const result = validateOp({
      op: "attr",
      sel: "a",
      name: "onclick",
      value: "count()",
    });

    expect(result.ok).toBe(true);
    if (result.ok && result.op.op === "attr") {
      expect(result.op.name).toBe("onclick");
      expect(result.op.value).toBe("count()");
    }
  });

  test("accepts attr op with a normal URL", () => {
    const result = validateOp({
      op: "attr",
      sel: "a.link",
      name: "href",
      value: "https://example.com",
    });

    expect(result.ok).toBe(true);
  });

  test("accepts style op with normal css", () => {
    const result = validateOp({
      op: "style",
      css: "#substrate { background: oklch(20% 0.02 260); }",
    });

    expect(result.ok).toBe(true);
  });

  test("truncates overlong note text instead of rejecting", () => {
    const result = validateOp({ op: "note", text: "n".repeat(2000) });

    expect(result.ok).toBe(true);
    if (result.ok && result.op.op === "note") {
      expect(result.op.text.length).toBe(500);
    }
  });
});
