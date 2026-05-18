# Process Systemization · TOC-1 MTA 2026 Webapp

Local single-page webapp สำหรับติดตามความคืบหน้างาน Process Systemization ของโครงการ **CDU-1** และ **FCCU**

## วิธีรัน

**แนะนำ:** ดับเบิ้ลคลิก `start.bat` — จะเปิด `http://localhost:5173` ใน browser อัตโนมัติ
(ต้องมี Node.js ติดตั้งไว้แล้ว — โครงการนี้ใช้ Node v20)

**ทางเลือก:** เปิด `index.html` ตรงๆ ใน browser ก็ได้ (Chrome / Edge)

> ⚠ ข้อมูลทั้งหมดอยู่ใน **memory ของ tab เท่านั้น** — ปิดหรือ refresh tab = ข้อมูลหาย ต้องโหลดไฟล์ใหม่ทุกครั้งที่เปิดเว็บ (ออกแบบให้เป็น session-only ตามที่ user ต้องการ)

## ฟีเจอร์

3 หน้าจอ:

1. **Upload Master** — อัปโหลด `Ensdqfr05_Turnaround Work List form (<project>).xlsx`
   - Header row 5 · data row 6+
   - Col D = Tag no., Col I = System no. (รองรับหลาย system ใน cell เดียว คั่นด้วย newline)
2. **Upload Progression** — อัปโหลด `DisciplineTagNoTable_<project> <discipline>.xlsx` หลายไฟล์พร้อมกัน
   - Header row 1 · data row 2+
   - Col B = Tag, Col C = Plan%, Col D = Actual%
   - ทุก sheet ในแต่ละไฟล์จะถูกอ่านอัตโนมัติ (sheet name = equipment type)
3. **Dashboard** — Hierarchy Project → System → Tag
   - KPI ระดับโครงการ
   - Filter ตาม project / discipline / search by tag-system
   - Export xlsx

## สูตรการรวม %

ทุก level (Tag / System / Project) ใช้สูตรเดียว — **weighted average ด้วย Plan%**:

```
% = Σ(actual_i × plan_i) / Σ(plan_i)
```

ถ้า `Σ(plan_i) = 0` → แสดงเป็น `—`

## โครงสร้างไฟล์

```
webapp/
├─ index.html
├─ start.bat            (เปิด server + browser ด้วยคลิกเดียว)
├─ serve.js             (Node static server, no deps)
├─ assets/app.css
└─ js/
   ├─ sessionState.js   (in-memory store — window.Store API, ไม่มี persistence)
   ├─ parseMaster.js
   ├─ parseProgress.js
   ├─ main.js           (router + toast + beforeunload guard)
   └─ views/
      ├─ upload-master.js
      ├─ upload-progress.js
      └─ dashboard.js
```

ข้อมูลทั้งหมดอยู่ใน **memory** ของ tab — ไม่ persist ที่ไหน ปิด tab/refresh = หาย (ฟอร์มเปล่าทุกครั้ง)
