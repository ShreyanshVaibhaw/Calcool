import { describe, expect, test } from "vitest";
import { normalizeBook, encodeSlvr, decodeImportedFile, sheetTitle } from "./storage";

describe("normalizeBook", () => {
  test("old books without folders open with everything in Inbox", () => {
    const b = normalizeBook({
      sheets: [{ id: "a", text: "1 + 2", created: 1, modified: 2 }],
      activeId: "a",
      trash: [],
    });
    expect(b.folders).toEqual([]);
    expect(b.sheets[0].folder).toBeUndefined();
    expect(b.activeId).toBe("a");
  });

  test("folders and sheet folders survive", () => {
    const b = normalizeBook({
      sheets: [{ id: "a", text: "x", folder: "Work", created: 1, modified: 1 }],
      activeId: "a",
      trash: [],
      folders: ["Work"],
    });
    expect(b.folders).toEqual(["Work"]);
    expect(b.sheets[0].folder).toBe("Work");
  });

  test("unknown activeId falls back to the first sheet", () => {
    const b = normalizeBook({
      sheets: [{ id: "a", text: "x", created: 1, modified: 1 }],
      activeId: "gone",
      trash: [],
      folders: [],
    });
    expect(b.activeId).toBe("a");
  });

  test("empty book gets a welcome sheet", () => {
    const b = normalizeBook({ sheets: [], activeId: "", trash: [], folders: [] });
    expect(b.sheets.length).toBe(1);
    expect(sheetTitle(b.sheets[0].text)).not.toBe("Untitled");
  });
});

describe("import/export", () => {
  test("slvr round-trips title and text", () => {
    const encoded = encodeSlvr("Trip", "100 + 200");
    const back = decodeImportedFile("trip.slvr", encoded);
    expect(back).toEqual({ title: "Trip", text: "100 + 200" });
  });

  test("txt and calcool import with the file stem as title", () => {
    expect(decodeImportedFile("notes.txt", "1 + 1"))?.toEqual({ title: "notes", text: "1 + 1" });
    expect(decodeImportedFile("calc.calcool", "2 + 2"))?.toEqual({ title: "calc", text: "2 + 2" });
  });

  test("slvr tolerates alternate field names", () => {
    expect(decodeImportedFile("x.slvr", JSON.stringify({ name: "N", content: "3 + 3" })))?.toEqual({ title: "N", text: "3 + 3" });
  });

  test("empty files, bad json, and unknown extensions are rejected", () => {
    expect(decodeImportedFile("empty.txt", "  \n ")).toBeNull();
    expect(decodeImportedFile("bad.slvr", "{nope")).toBeNull();
    expect(decodeImportedFile("pic.png", "data")).toBeNull();
  });
});
