(function (global) {
  let pending = []; // [{file, project, result}]
  let cachedSummary = []; // [{project, sourceFile, uploadedAt, sheets, tags}]

  function $(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function setFileboxLabel(text, hasFile) {
    const box = $("progress-filebox");
    const label = box.querySelector(".filebox-label");
    label.textContent = text;
    box.classList.toggle("has-file", !!hasFile);
  }

  function existingFile(project, sourceFile) {
    return cachedSummary.find((s) => s.project === project && s.sourceFile === sourceFile);
  }

  function renderPreview() {
    const el = $("progress-preview");
    if (!pending.length) {
      el.className = "preview muted"; el.textContent = "ยังไม่มีไฟล์";
      $("progress-save").disabled = true;
      return;
    }
    const totalRecords = pending.reduce((a, p) => a + p.result.records.length, 0);
    const projectMismatch = pending.filter(
      (p) => p.result.inferredProject && p.result.inferredProject !== p.project
    );
    const reUploads = pending.map((p) => ({
      file: p.file.name,
      existing: existingFile(p.project, p.file.name),
    })).filter((x) => x.existing);

    el.className = "preview ok";
    el.innerHTML = `
      <strong>${pending.length} ไฟล์</strong> · รวม ${totalRecords} progression records
      <table class="data" style="margin-top:8px">
        <thead><tr><th>File</th><th>Inferred discipline</th><th class="num">Sheets</th><th class="num">Skipped</th><th class="num">Records</th><th>สถานะ</th></tr></thead>
        <tbody>
          ${pending.map((p) => {
            const exist = existingFile(p.project, p.file.name);
            const status = exist
              ? `<span style="color:var(--rag-amber);font-weight:600">⚠ จะแทนที่ของเดิมใน session (โหลดเมื่อ ${new Date(exist.uploadedAt).toLocaleTimeString()})</span>`
              : `<span style="color:var(--rag-green)">✓ ไฟล์ใหม่</span>`;
            const warn = p.result.warnings.length ? `<br/><span class="muted" style="font-size:11px">${escapeHtml(p.result.warnings.join(" · "))}</span>` : "";
            return `
              <tr>
                <td>${escapeHtml(p.file.name)}${warn}</td>
                <td>${escapeHtml(p.result.discipline)}</td>
                <td class="num">${p.result.sheetCount}</td>
                <td class="num">${p.result.skippedSheets}</td>
                <td class="num">${p.result.records.length}</td>
                <td>${status}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
      ${projectMismatch.length ? `<div class="preview-warning">⚠ ${projectMismatch.length} ไฟล์ชื่อบ่งบอกโครงการอื่น — จะโหลดเข้า ${escapeHtml(pending[0].project)} ตามที่เลือกไว้</div>` : ""}
      ${reUploads.length ? `<div class="preview-warning">⚠ ${reUploads.length} ไฟล์ชื่อซ้ำกับที่โหลดอยู่ — กดโหลดข้อมูลเพื่อ <strong>แทนที่</strong></div>` : ""}
    `;
    $("progress-save").disabled = totalRecords === 0;
  }

  async function refreshStatus() {
    const el = $("progress-status");
    cachedSummary = await Store.progressFileSummary();
    if (!cachedSummary.length) {
      el.innerHTML = `<div class="empty">ยังไม่มี progression data ใน session — กดโหลดไฟล์ก่อน</div>`;
      return;
    }
    cachedSummary.sort((a, b) => a.project.localeCompare(b.project) || a.sourceFile.localeCompare(b.sourceFile));
    el.innerHTML = `
      <table class="data">
        <thead><tr><th>Project</th><th>File</th><th class="num">Sheets</th><th class="num">Records</th><th>Uploaded</th></tr></thead>
        <tbody>
          ${cachedSummary.map((s) => `
            <tr>
              <td>${escapeHtml(s.project)}</td>
              <td>${escapeHtml(s.sourceFile)}</td>
              <td class="num">${s.sheets}</td>
              <td class="num">${s.tags}</td>
              <td class="muted">${new Date(s.uploadedAt).toLocaleString()}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      <div class="next-step">
        <a href="#/dashboard" class="primary next-btn">ต่อไป: ดู Dashboard →</a>
      </div>
    `;
  }

  async function onFilesChange(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) {
      pending = [];
      setFileboxLabel("เลือกหลายไฟล์ได้ หรือลากมาวาง...", false);
      renderPreview();
      return;
    }
    setFileboxLabel(files.length === 1 ? files[0].name : `${files.length} ไฟล์ที่เลือก`, true);
    const project = $("progress-project").value;
    pending = [];
    for (const file of files) {
      try {
        const result = await parseProgressFile(file);
        pending.push({ file, project, result });
      } catch (err) {
        console.error("Parse failed:", file.name, err);
        toast(`Parse ${file.name} failed: ${err.message}`, "err");
      }
    }
    renderPreview();
  }

  async function onSave() {
    if (!pending.length) return;
    const project = $("progress-project").value;
    let savedFiles = 0, savedRecords = 0;
    for (const p of pending) {
      try {
        const n = await Store.replaceProgressForFile(project, p.file.name, p.result.records);
        savedRecords += n;
        savedFiles++;
      } catch (err) {
        console.error(err);
        toast(`โหลด ${p.file.name} ไม่สำเร็จ: ${err.message}`, "err");
      }
    }
    toast(`โหลด ${savedFiles}/${pending.length} ไฟล์ · ${savedRecords} records`, savedFiles === pending.length ? "ok" : "err");
    pending = [];
    $("progress-files").value = "";
    setFileboxLabel("เลือกหลายไฟล์ได้ หรือลากมาวาง...", false);
    renderPreview();
    refreshStatus();
    window.dispatchEvent(new CustomEvent("data:progress-changed", { detail: { project } }));
  }

  async function onClear() {
    const project = $("progress-project").value;
    const existingCount = cachedSummary.filter((s) => s.project === project).length;
    if (!existingCount) {
      toast(`ไม่มี progression ของ ${project} ให้ล้าง`, "");
      return;
    }
    if (!confirm(`ลบ progression data ของ ${project} ทั้งหมด (${existingCount} ไฟล์)?`)) return;
    try {
      await Store.clearProgressForProject(project);
      toast(`ล้าง progression ของ ${project} แล้ว`, "ok");
      refreshStatus();
      window.dispatchEvent(new CustomEvent("data:progress-changed", { detail: { project } }));
    } catch (err) {
      toast("ล้างไม่สำเร็จ: " + err.message, "err");
    }
  }

  async function onClearAll() {
    if (!cachedSummary.length) {
      toast("ไม่มี progression data ให้ล้าง", "");
      return;
    }
    const totalFiles = cachedSummary.length;
    const totalRecords = cachedSummary.reduce((a, s) => a + s.tags, 0);
    const byProject = {};
    for (const s of cachedSummary) {
      if (!byProject[s.project]) byProject[s.project] = 0;
      byProject[s.project] += s.tags;
    }
    const projectList = Object.entries(byProject).map(([p, n]) => `${p} (${n} records)`).join(", ");
    if (!confirm(`ล้าง progression data ทุกโครงการ?\n${projectList}\nรวม ${totalFiles} ไฟล์ · ${totalRecords} records`)) return;
    try {
      await Store.clearAllProgress();
      toast(`ล้าง progression data ทั้งหมด (${totalFiles} ไฟล์) แล้ว`, "ok");
      refreshStatus();
      window.dispatchEvent(new CustomEvent("data:progress-changed", { detail: { project: "*" } }));
    } catch (err) {
      toast("ล้างไม่สำเร็จ: " + err.message, "err");
    }
  }

  function setupDragDrop() {
    const box = $("progress-filebox");
    if (!box) return;
    const prevent = (e) => { e.preventDefault(); e.stopPropagation(); };
    ["dragenter", "dragover"].forEach((evt) => box.addEventListener(evt, (e) => {
      prevent(e); box.classList.add("dragging");
    }));
    ["dragleave", "drop"].forEach((evt) => box.addEventListener(evt, (e) => {
      prevent(e); box.classList.remove("dragging");
    }));
    box.addEventListener("drop", (e) => {
      const files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;
      const input = $("progress-files");
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(f);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  function mount() {
    $("progress-files").addEventListener("change", onFilesChange);
    $("progress-save").addEventListener("click", onSave);
    $("progress-clear").addEventListener("click", onClear);
    $("progress-clear-all").addEventListener("click", onClearAll);
    $("progress-project").addEventListener("change", () => {
      const project = $("progress-project").value;
      pending.forEach((p) => (p.project = project));
      renderPreview();
    });
    setupDragDrop();
    refreshStatus();
  }

  global.UploadProgressView = { mount };
})(window);
