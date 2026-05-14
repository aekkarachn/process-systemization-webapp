// Parse DisciplineTagNoTable_<project> <discipline>.xlsx
// Each workbook has many sheets (1 per equipment template).
// Layout per sheet: header row 1, data row 2+.
//   B: TAG No., C: Plan (%), D: Actual (%)
// Discipline is derived from the file name (MECH / INST / ELEC) — best effort.
//
// Output records: { tag, plan, actual, sheet, discipline, equipmentType }
// equipmentType ≈ sheet name (trimmed); discipline is inferred per file.

(function (global) {
  function cellStr(sheet, addr) {
    const c = sheet[addr];
    if (!c || c.v == null) return "";
    return String(c.v).trim();
  }

  function cellNum(sheet, addr) {
    const c = sheet[addr];
    if (!c || c.v == null || c.v === "") return 0;
    const n = typeof c.v === "number" ? c.v : parseFloat(String(c.v).replace(/[%,\s]/g, ""));
    if (!isFinite(n)) return 0;
    return n;
  }

  function clampPct(n) {
    if (!isFinite(n)) return 0;
    // Values are sometimes 0..1 (fractions) and sometimes 0..100.
    // The data we sampled was integers 0..100; if everything in the sheet is <=1
    // and there's at least one non-zero, we'll treat as fraction. We can't decide
    // per-row, so default: clamp to [0, 100] without scaling.
    if (n < 0) return 0;
    if (n > 100) return 100;
    return n;
  }

  function inferDiscipline(fileName) {
    const f = fileName.toUpperCase();
    if (f.includes("MECH")) return "MECH";
    if (f.includes("INST")) return "INST";
    if (f.includes("ELEC")) return "ELEC";
    return "OTHER";
  }

  function inferProjectFromFileName(fileName) {
    const f = fileName.toUpperCase();
    if (f.includes("CDU1") || f.includes("CDU-1")) return "CDU-1";
    if (f.includes("FCCU")) return "FCCU";
    return null;
  }

  async function parseProgressFile(file) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const fileName = file.name;
    const discipline = inferDiscipline(fileName);
    const inferredProject = inferProjectFromFileName(fileName);
    const records = [];
    const warnings = [];
    let skippedSheets = 0;

    for (const sheetName of wb.SheetNames) {
      const sh = wb.Sheets[sheetName];
      if (!sh || !sh["!ref"]) { skippedSheets++; continue; }
      const range = XLSX.utils.decode_range(sh["!ref"]);

      // Header detection: row 1 should have "TAG" in B1 (allow some flexibility)
      const hdrB = cellStr(sh, "B1").toLowerCase();
      if (!hdrB.includes("tag")) {
        warnings.push(`ข้าม sheet "${sheetName}" — B1 ไม่ใช่ TAG header (${cellStr(sh, "B1") || "ว่าง"})`);
        skippedSheets++;
        continue;
      }

      for (let r = 1; r <= range.e.r; r++) {
        const rowExcel = r + 1;
        const tag = cellStr(sh, "B" + rowExcel);
        if (!tag) continue;
        // Skip rows that look like sub-headers (e.g. text in C/D)
        const plan = clampPct(cellNum(sh, "C" + rowExcel));
        const actual = clampPct(cellNum(sh, "D" + rowExcel));
        records.push({
          tag,
          plan,
          actual,
          sheet: sheetName.trim(),
          discipline,
          equipmentType: sheetName.trim(),
        });
      }
    }

    return {
      records,
      warnings,
      fileName,
      discipline,
      inferredProject,
      sheetCount: wb.SheetNames.length,
      skippedSheets,
    };
  }

  global.parseProgressFile = parseProgressFile;
  global.parseProgressUtil = { inferDiscipline, inferProjectFromFileName };
})(window);
