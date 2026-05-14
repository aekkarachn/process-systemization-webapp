// Parse Ensdqfr05_Turnaround Work List form (<project>).xlsx
// Layout: header row 5, data starts row 6
//   A: Item, B: Discipline, C: Type, D: Tag no., E: Description,
//   F: Reason, G: Requested by, H: Action by, I: System no. (multi-line),
//   J: Reservation, K: Permit no., L: Notification, M: Order, N: Remark
//
// Output records: { tag, discipline, equipmentType, description, systems: string[] }

(function (global) {
  function cellStr(sheet, addr) {
    const c = sheet[addr];
    if (!c || c.v == null) return "";
    return String(c.v).trim();
  }

  function splitSystems(raw) {
    if (!raw) return [];
    return String(raw)
      .split(/\r?\n|;|,/) // also tolerate ; or , separators if seen
      .map((s) => s.trim())
      .filter((s) => {
        if (!s) return false;
        const lo = s.toLowerCase();
        // Filter out placeholders that mean "no system assigned"
        if (lo === "-" || lo === "n/a" || lo === "na" || lo === "none" || lo === "tbd") return false;
        return true;
      });
  }

  async function parseMasterFile(file) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    if (!sheet || !sheet["!ref"]) {
      return { records: [], warnings: ["Sheet ว่าง"] };
    }
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    const records = [];
    const warnings = [];

    // Sanity: header at row 5 should contain "Tag no." in D5 and "System no." in I5
    const dHdr = cellStr(sheet, "D5").toLowerCase();
    const iHdr = cellStr(sheet, "I5").toLowerCase();
    if (!dHdr.includes("tag") || !iHdr.includes("system")) {
      warnings.push(
        `Header row 5 ดูแปลก: D5="${cellStr(sheet, "D5")}", I5="${cellStr(sheet, "I5")}"`
      );
    }

    let skippedEmpty = 0;
    let dupTagInFile = 0;
    const seenTags = new Set();

    for (let r = 5; r <= range.e.r; r++) {
      // Excel row = r+1, 0-indexed r=5 means row 6
      const rowExcel = r + 1;
      const tag = cellStr(sheet, "D" + rowExcel);
      if (!tag) {
        skippedEmpty++;
        continue;
      }
      const systemsRaw = cellStr(sheet, "I" + rowExcel);
      const systems = splitSystems(systemsRaw);
      const discipline = cellStr(sheet, "B" + rowExcel);
      const equipmentType = cellStr(sheet, "C" + rowExcel);
      const description = cellStr(sheet, "E" + rowExcel);

      if (seenTags.has(tag)) {
        dupTagInFile++;
        // merge systems into the existing record
        const existing = records.find((x) => x.tag === tag);
        if (existing) {
          for (const s of systems) {
            if (!existing.systems.includes(s)) existing.systems.push(s);
          }
        }
        continue;
      }
      seenTags.add(tag);
      records.push({
        tag,
        discipline,
        equipmentType,
        description,
        systems,
      });
    }

    if (skippedEmpty > 0) warnings.push(`ข้าม ${skippedEmpty} row ที่ไม่มี Tag`);
    if (dupTagInFile > 0) warnings.push(`พบ tag ซ้ำในไฟล์ ${dupTagInFile} record (รวม systems เข้าด้วยกัน)`);

    return { records, warnings, sheetName, totalRows: range.e.r + 1 };
  }

  global.parseMasterFile = parseMasterFile;
  global.parseMasterUtil = { splitSystems };
})(window);
