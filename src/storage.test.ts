import { describe, expect, test } from "vitest";
import { normalizeBook, encodeSlvr, decodeImportedFile, sheetTitle, assembleBook, buildIndex, BOOK_INDEX_VERSION } from "./storage";

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

describe("buildIndex", () => {
  test("writes the schema version and one entry per sheet", () => {
    const book = normalizeBook({
      sheets: [{ id: "a", text: "1 + 1", created: 1, modified: 2 }],
      activeId: "a",
      trash: [],
      folders: [],
    });
    const idx = JSON.parse(buildIndex(book, new Map([["a", "Sheet.calcool"]])));
    expect(idx.version).toBe(BOOK_INDEX_VERSION);
    expect(idx.sheets).toEqual([{ id: "a", file: "Sheet.calcool", created: 1, modified: 2 }]);
    expect(idx.activeId).toBe("a");
  });
});

describe("assembleBook", () => {
  const files = [
    { file: "One.calcool", text: "1 + 1" },
    { file: "Two.calcool", text: "2 + 2" },
  ];
  const index = JSON.stringify({
    version: 1,
    activeId: "b",
    trash: [],
    folders: ["Work"],
    sheets: [
      { id: "a", file: "One.calcool", created: 1, modified: 2 },
      { id: "b", file: "Two.calcool", folder: "Work", created: 3, modified: 4 },
    ],
  });

  test("index entries match files, metadata survives", () => {
    const { book, disk } = assembleBook(index, files);
    expect(book!.sheets.map((s) => [s.id, s.text])).toEqual([["a", "1 + 1"], ["b", "2 + 2"]]);
    expect(book!.sheets[1].folder).toBe("Work");
    expect(book!.activeId).toBe("b");
    expect(book!.folders).toEqual(["Work"]);
    expect(disk.get("a")).toEqual({ file: "One.calcool", text: "1 + 1" });
    expect(disk.get("b")).toEqual({ file: "Two.calcool", text: "2 + 2" });
  });

  test("entries whose file vanished are skipped", () => {
    const { book } = assembleBook(index, [{ file: "Two.calcool", text: "2 + 2" }]);
    expect(book!.sheets.map((s) => s.id)).toEqual(["b"]);
    expect(book!.activeId).toBe("b");
  });

  test("outside files are adopted with the stem as name", () => {
    const { book } = assembleBook(index, [...files, { file: "New.calcool", text: "3 + 3" }]);
    const adopted = book!.sheets[2];
    expect(adopted.text).toBe("3 + 3");
    expect(adopted.name).toBe("New");
  });

  test("corrupt index falls back to adopting all files", () => {
    const { book } = assembleBook("{nope", files);
    expect(book!.sheets.map((s) => s.text)).toEqual(["1 + 1", "2 + 2"]);
    expect(book!.trash).toEqual([]);
  });

  test("missing index with no files yields null for the localStorage fallback", () => {
    expect(assembleBook(null, []).book).toBeNull();
  });

  test("old version-less and future indexes both load tolerantly", () => {
    const old = JSON.stringify({ activeId: "a", trash: [], folders: [], sheets: [{ id: "a", file: "One.calcool", created: 1, modified: 1 }] });
    expect(assembleBook(old, files.slice(0, 1)).book!.sheets[0].id).toBe("a");
    const future = JSON.parse(index);
    future.version = 999;
    future.newField = { nested: true };
    expect(assembleBook(JSON.stringify(future), files).book!.sheets.length).toBe(2);
  });

  test("unknown activeId falls back to the first sheet", () => {
    const idx = JSON.parse(index);
    idx.activeId = "gone";
    expect(assembleBook(JSON.stringify(idx), files).book!.activeId).toBe("a");
  });
});
