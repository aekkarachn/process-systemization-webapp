# CLAUDE.md — Process Systemization · TOC-1 MTA 2026

Context file for future Claude sessions working on this project.

## What this is

Single-page webapp (vanilla HTML/CSS/JS) ที่ทำให้ผู้ใช้คนเดียว upload ไฟล์ Excel เกี่ยวกับ Turnaround Worklist และ Progression แล้วแสดง dashboard ความคืบหน้าระดับ Project → System → Tag

**Session-only**: ข้อมูลอยู่ใน memory เท่านั้น ปิด/refresh tab = หาย ตามที่ user ขอ (เริ่มฟอร์มเปล่าทุกครั้ง) — ไม่มี IndexedDB หรือ persistence อื่นๆ

โครงการครอบคลุม 2 sub-projects:
- **CDU-1** (Crude Distillation Unit)
- **FCCU** (Fluid Catalytic Cracking Unit)

ทั้งคู่อยู่ภายใต้ **TOC-1 MTA 2026** (Major Turnaround 2026)

## Tech stack (ไม่มี build step)

- **HTML/CSS/JS แบบ vanilla** — ไม่มี framework, ไม่มี bundler
- **SheetJS (xlsx)** ผ่าน CDN — อ่าน xlsx ฝั่ง browser
- **Chart.js** ผ่าน CDN (โหลดไว้แต่ยังไม่ได้ใช้ — เผื่อต่อยอด)
- **In-memory state** — เก็บข้อมูลใน JS object ของ `js/sessionState.js` หายเมื่อ reload (เคยใช้ IndexedDB แต่เปลี่ยนเป็น session-only ตามที่ user ขอ; sessionState.js จะ `indexedDB.deleteDatabase('tocmta2026')` ตอน boot เพื่อล้าง DB เก่าของ user ที่เคยใช้เวอร์ชันก่อน)
- **Node.js** — แค่สำหรับ static server ตอน dev (`serve.js`, no deps)
- รัน script ผ่าน plain `<script>` tags ไม่ใช่ ES modules → ทำงานได้บน `file://` แต่ใช้ `start.bat` จะปลอดภัยกว่า

## Run / Develop

```
ดับเบิ้ลคลิก start.bat   →  เปิด http://localhost:5173 อัตโนมัติ
```

หรือสั่งตรงๆ:
```
node serve.js
```

## File structure

```
webapp/
├─ index.html               # entry — 3 tabs ผ่าน <template> tags
├─ start.bat                # one-click launcher
├─ serve.js                 # tiny static server (no deps)
├─ README.md                # user-facing readme
├─ CLAUDE.md                # this file
├─ assets/
│  └─ app.css
└─ js/
   ├─ sessionState.js       # in-memory store (window.Store API — masters + progress arrays)
   ├─ parseMaster.js        # parse Ensdqfr05_*.xlsx
   ├─ parseProgress.js      # parse DisciplineTagNoTable_*.xlsx
   ├─ main.js               # tab router + global toast() + beforeunload guard
   └─ views/
      ├─ upload-master.js
      ├─ upload-progress.js
      └─ dashboard.js
```

ไฟล์ Excel ตัวอย่างอยู่ใน **folder แม่** (parent dir) ของ `webapp/`:
- `Ensdqfr05_Turnaround Work List form (CDU-1).xlsx`
- `Ensdqfr05_Turnaround Work List form (FCCU).xlsx`
- `DisciplineTagNoTable_CDU1 MECH.xlsx`, `... INST.xlsx`, `... ELEC.xlsx`
- `DisciplineTagNoTable_FCCU MECH.xlsx`, `... INST.xlsx`, `... ELECT.xlsx`

## Data model

ทุกอย่างเก็บใน `_state = { masters: [], progress: [] }` ใน module scope ของ `js/sessionState.js` — query ด้วย `Array.filter` ตรงๆ ไม่มี index ไม่มี keyPath

**masters array** — 1 row ต่อ tag ใน project
```js
{
  project: "CDU-1" | "FCCU",
  sourceFile: "Ensdqfr05_... .xlsx",
  uploadedAt: "<ISO ตอนที่โหลดไฟล์>",
  tag: "E-0106A",
  discipline: "MECH",
  equipmentType: "AIR COOLED HEAT EXCHANGER",
  description: "GAS OIL COOLER",
  systems: ["010-P01-01", "050-P03-01"]   // 1 tag อยู่ได้หลาย system
}
```

**progress array** — 1 row ต่อ progression record
```js
{
  project, sourceFile, uploadedAt,
  sheet,                                  // sheet name ในไฟล์ต้นทาง
  tag: "E-0106A",
  plan: 0,           // 0..100
  actual: 0,         // 0..100
  discipline: "MECH" | "INST" | "ELEC",
  equipmentType: <sheet name>
}
```

**Replace semantics:**

- `replaceMasters(project, sourceFile, records)` — ลบ records ที่ `project===project` ทิ้ง แล้ว push ของใหม่
- `replaceProgressForFile(project, sourceFile, records)` — ลบ records ที่ `project===project && sourceFile===sourceFile` แล้ว push ของใหม่ (โหลดไฟล์ใหม่ชื่อเดิม = แทนที่)

## Excel layouts (ตามไฟล์จริง)

### Master (`Ensdqfr05_Turnaround Work List form (<project>).xlsx`)
- 1 sheet
- header row 5, data row 6+
- Col D = Tag no.
- Col I = System no. — **อาจมีหลายค่าใน cell เดียว คั่นด้วย newline (`\n`)** — parser split ด้วย `/\r?\n|;|,/` แล้ว filter ค่าที่เป็น `-`, `n/a`, `na`, `none`, `tbd`
- 1 tag อาจปรากฏหลายแถว — parser merge systems เข้าไปใน record เดียวกัน (ดูใน parseMaster.js)

ขนาดจริง:
- CDU-1: 925 unique tags, 31 systems, 40 tags อยู่ใน >1 system
- FCCU: 1096 unique tags, 15 systems, 40 tags อยู่ใน >1 system

### Progression (`DisciplineTagNoTable_<project> <discipline>.xlsx`)
- หลาย sheets (1 sheet = 1 equipment template เช่น `COLUMN Template`, `PUMP Template`)
- header row 1, data row 2+
- Col B = TAG No., Col C = Plan (%), Col D = Actual (%)
- Discipline inferred จากชื่อไฟล์ (MECH / INST / ELEC) — ดู `parseProgressUtil.inferDiscipline`
- Sheet ที่ B1 ไม่ใช่ "TAG..." → skip + warning

## Aggregation formula (mean of means at every level)

Plan และ Actual คำนวณคู่ขนานด้วยสูตรเดียวกัน 3 ขั้น ราย Tag → System → Project:

```
Tag.Plan%       = Σ(rec.plan)   / N_records_in_tag
Tag.Actual%     = Σ(rec.actual) / N_records_in_tag

System.Plan%    = Σ(Tag.Plan%)   / N_tags_in_system   ← แต่ละ tag = 1 entry
System.Actual%  = Σ(Tag.Actual%) / N_tags_in_system

Project.Plan%   = Σ(System.Plan%)   / M_systems       ← แต่ละ system = 1 entry
Project.Actual% = Σ(System.Actual%) / M_systems
Delta = Actual − Plan  (อิสระจากกัน)
```

**ความหมาย:** "mean of means" — ทุก tag น้ำหนักเท่ากันใน system, ทุก system น้ำหนักเท่ากันใน project ไม่ว่าจะมี records หลายอันก็ตาม

**กรณีขอบ:**

- ถ้า `N_records === 0` (tag ไม่มี data เลย) → tag mean = null, ไม่นับใน system denominator
- 1 record → contribute เข้าทุก system ที่ tag นั้นอยู่ (Q-E / Q3 = นับซ้ำได้)
- Tag ที่ master มี แต่ไม่มี progression record → **ไม่นับ** ใน denominator (Q-B)
- System ที่ไม่มี progression record เลย → **ไม่นับ** ใน Project denominator (Q-C — handle อัตโนมัติ)
- Unmapped bucket (tag ไม่ map กับ system ใด) → ถ้ามี records จะนับเป็น **1 pseudo-system** ใน Project rollup (Q-D)
  - Unmapped's own mean ก็ใช้ mean-of-tag-means เหมือน system ปกติ
- Empty Actual → 0 (Q6)

## Known data quirks (พบจากการ smoke test กับไฟล์จริง)

1. **Master มี tag ซ้ำในไฟล์** ~60-80 rows ต่อโครงการ (CDU-1: 78, FCCU: 59) — parser merge systems เข้า record เดียวกัน
2. **Progression มี ~40-60% records ที่ tag ไม่อยู่ใน master** — เป็น instrument/motor tags ระดับย่อย เช่น `01-UZ-162-CV.`, `PM-0130A`, `07-LICA-067-TX` (Equipment master มีแค่ E-/P-/C-/K-/V-/H-) → Dashboard แสดงใน bucket "(ไม่ map กับ system ใด)"
3. **บาง tag มี suffix ภาษาไทย** เช่น `07-LA-201-TX ส่งกรมโรงงาน` (ส่งกรมโรงงาน = sent to Ministry of Industry) — ตอนนี้ถือเป็น distinct tag (ดี/ไม่ดียังไม่ตัดสินใจ)
4. **Col I ของ master เคยมีค่า `-`** = no system — filter ออกใน `parseMasterUtil.splitSystems`
5. **Template ตอนนี้ Plan/Actual = 0 ทั้งหมด** → Dashboard แสดง `—` จนกว่าคนกรอก

## Conventions

- **No ES modules, no transpilation** — ทุกไฟล์ใช้ IIFE pattern `(function (global) { ... })(window)` แล้วแขวน export ที่ `window.XxxView` หรือ `window.Store`
- ภาษาใน UI = **ไทย** (label, error message, toast)
- คอมเมนต์ในโค้ดเขียนเป็นภาษาอังกฤษ เน้น "why" ไม่เขียน "what" ที่ชื่อตัวแปรบอกได้อยู่แล้ว
- ไม่มี framework — DOM operations เขียนตรงๆ ผ่าน `getElementById`, innerHTML (escape ด้วย `escapeHtml`)
- Re-upload semantics: master = replace by `project`; progress = replace by `(project, sourceFile)` — ไม่ใช่ append
- ไม่ persist อะไรเลย — refresh = หาย; มี `beforeunload` guard เตือนถ้ามี data ใน session

## Decisions ที่ตกลงกับ user ไว้

| # | คำถาม | คำตอบ |
|---|---|---|
| Q1 | สูตรรวม % | **Simple average** — System% = Σrec/N, Project% = ΣSys/M (Plan & Actual แยกกัน) — _เปลี่ยนจาก weighted แบบเดิม_ |
| Q2 | Tag เดียวอยู่หลาย sheet/discipline | (b) เก็บ records แยก |
| Q3 | Tag อยู่ 2 systems → นับซ้ำ? | ใช่ |
| Q4 | ที่เก็บข้อมูล | **Session-only (in-memory)** — เปลี่ยนจาก IndexedDB เดิม; user ต้องการฟอร์มเปล่าทุกครั้งที่เปิดเว็บ |
| Q5 | Single user หรือหลายคน | Single user |
| Q6 | Actual ว่าง = ? | 0 |
| Q-A | Tag หลาย records → System rollup | (2) แต่ละ record = 1 entry (sub-tag) |
| Q-B | Master tag ที่ไม่มี progress | (2) ไม่นับใน denominator |
| Q-C | System ที่ไม่มี progress เลย | (2) ไม่นับใน Project denominator |
| Q-D | Unmapped bucket | (2) นับเป็น 1 pseudo-system ใน Project rollup |
| Q-E | Tag หลาย system → ซ้ำ? | ใช่ (เก็บ Q3 เดิม) |

## ไอเดียต่อยอด (ยังไม่ทำ)

- Chart.js progress chart per project (loaded แล้วแต่ยังไม่ใช้)
- Drill-down view: click ที่ system → modal โชว์ tags ทั้งหมดพร้อม record-level breakdown
- Compare snapshot — เก็บ snapshot ของ Actual% ในไฟล์ JSON แล้วเทียบสัปดาห์ต่อสัปดาห์ (session-only เลยต้อง export/import เอง)
- Export/Import session state เป็น JSON (backup/restore — กันโหลดใหม่ทุกครั้ง ถ้า user เปลี่ยนใจอยากเก็บข้อมูลข้ามวัน)
- รองรับ rename column ใน Excel ถ้า template เปลี่ยน (ตอนนี้ hard-code Col B/C/D, D/I)
- Sorting/searching ในตาราง tag breakdown ระดับ system

## Gotchas สำหรับคนทำงานต่อ

1. **อย่าใช้ ES modules** — เปิดด้วย `file://` แล้ว module imports จะพัง ถ้าจำเป็นต้อง modularize ให้สังเกตว่า `start.bat` ยังคงใช้งานได้อยู่
2. **Store API surface ยังชื่อเดิม** — `window.Store` ใน `sessionState.js` คง method เดิม (`replaceMasters`, `getAllMasters`, `getProgress`, ฯลฯ) ทั้งหมดคืน `Promise` เพื่อ views ที่ใช้ `await` อยู่แล้วไม่ต้องแก้ มี `Store.hasData()` เพิ่มเข้ามาให้ beforeunload guard ใช้
3. **XLSX cell reading** — ใช้ `sheet["D6"].v` ตรงๆ ไม่ผ่าน `sheet_to_json` เพราะ master file ไม่มี header ที่ row 1
4. **Tag matching เป็น case-sensitive และ trim เท่านั้น** — ถ้าอยากให้ทนทาน อาจ normalize (uppercase, remove space) แต่ต้องระวัง tag ภาษาไทย
5. **CDN ใช้ได้แม้รันผ่าน file://** แต่ถ้าออฟไลน์ทั้งหมด ต้อง download `xlsx.full.min.js` กับ `chart.umd.min.js` มาวางใน `assets/vendor/`
6. **`indexedDB.deleteDatabase('tocmta2026')` ตอน boot** — เป็นการล้าง DB ของ user เก่าที่เคยใช้เวอร์ชัน IndexedDB ครั้งเดียวต่อ session ไม่กระทบ user ใหม่
