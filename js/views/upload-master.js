(function (global) {
  let pendingParse = null;
  let cachedSummary = []; // [{project, tags, systems}]

  function $(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function setFileboxLabel(text, hasFile) {
    const box = $("master-filebox");
    const label = box.querySelector(".filebox-label");
    label.textContent = text;
    box.classList.toggle("has-file", !!hasFile);
  }

  function existingMasterCount(project) {
    const row = cachedSummary.find((s) => s.project === project);
    return row ? row.tags : 0;
  }

  function renderPreview(state) {
    const el = $("master-preview");
    if (!state) { el.className = "preview muted"; el.textContent = "ยังไม่มีไฟล์"; return; }
    if (state.error) {
      el.className = "preview err";
      el.textContent = "Error: " + state.error;
      return;
    }
    const { result, file, project } = state;
    const uniqSystems = new Set();
    for (const r of result.records) for (const s of r.systems) uniqSystems.add(s);

    const existing = existingMasterCount(project);
    const warnHtml = existing
      ? `<div class="preview-warning">⚠ จะเขียนทับ master เดิมของ ${escapeHtml(project)} (${existing} tags) — กดยืนยันบันทึก เพื่อแทนที่</div>`
      : "";

    el.className = "preview ok";
    el.innerHTML = `
      <strong>${escapeHtml(file.name)}</strong> → โครงการ <strong>${escapeHtml(project)}</strong><br/>
      อ่านได้ ${result.records.length} tag · ${uniqSystems.size} unique systems · ${result.totalRows} rows ในไฟล์
      ${result.warnings.length ? "<br/><span class='muted'>⚠ " + result.warnings.map(escapeHtml).join("; ") + "</span>" : ""}
      ${warnHtml}
    `;
  }

  async function refreshStatus() {
    const el = $("master-status");
    cachedSummary = await Store.masterSummary();
    if (!cachedSummary.length) {
      el.innerHTML = `<div class="empty">ยังไม่มี master data ในฐานข้อมูล</div>`;
      return;
    }
    cachedSummary.sort((a, b) => a.project.localeCompare(b.project));
    el.innerHTML = `
      <table class="data">
        <thead><tr><th>Project</th><th>File</th><th class="num">Tags</th><th class="num">Systems</th><th>Uploaded</th></tr></thead>
        <tbody>
          ${cachedSummary.map((s) => `
            <tr>
              <td>${escapeHtml(s.project)}</td>
              <td>${escapeHtml(s.sourceFile || "—")}</td>
              <td class="num">${s.tags}</td>
              <td class="num">${s.systems}</td>
              <td class="muted">${s.uploadedAt ? new Date(s.uploadedAt).toLocaleString() : "—"}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  async function onFileChange(e) {
    const file = e.target.files[0];
    if (!file) {
      pendingParse = null;
      $("master-save").disabled = true;
      setFileboxLabel("เลือกไฟล์ Excel หรือลากมาวาง...", false);
      renderPreview(null);
      return;
    }
    setFileboxLabel(file.name, true);
    const project = $("master-project").value;
    try {
      const result = await parseMasterFile(file);
      pendingParse = { file, project, result };
      $("master-save").disabled = result.records.length === 0;
      renderPreview(pendingParse);
    } catch (err) {
      console.error(err);
      pendingParse = null;
      $("master-save").disabled = true;
      renderPreview({ error: err.message });
    }
  }

  async function onSave() {
    if (!pendingParse) return;
    const { file, project, result } = pendingParse;
    const existing = existingMasterCount(project);
    if (existing && !confirm(`โครงการ ${project} มี master เดิม ${existing} tags อยู่แล้ว — ยืนยันเขียนทับด้วย ${result.records.length} tags ใหม่?`)) {
      return;
    }
    try {
      const n = await Store.replaceMasters(project, file.name, result.records);
      toast(`บันทึก ${n} tags ของ ${project} เรียบร้อย`, "ok");
      pendingParse = null;
      $("master-file").value = "";
      $("master-save").disabled = true;
      setFileboxLabel("เลือกไฟล์ Excel หรือลากมาวาง...", false);
      renderPreview(null);
      refreshStatus();
      window.dispatchEvent(new CustomEvent("data:masters-changed", { detail: { project } }));
    } catch (err) {
      console.error(err);
      toast("บันทึกไม่สำเร็จ: " + err.message, "err");
    }
  }

  async function onClear() {
    const project = $("master-project").value;
    const existing = existingMasterCount(project);
    if (!existing) {
      toast(`ไม่มี master ของ ${project} ให้ล้าง`, "");
      return;
    }
    if (!confirm(`ลบ master data ของ ${project} ทั้งหมด (${existing} tags)?`)) return;
    try {
      await Store.clearMastersForProject(project);
      toast(`ล้าง master data ของ ${project} แล้ว`, "ok");
      refreshStatus();
      window.dispatchEvent(new CustomEvent("data:masters-changed", { detail: { project } }));
    } catch (err) {
      toast("ล้างไม่สำเร็จ: " + err.message, "err");
    }
  }

  async function onClearAll() {
    const totalTags = cachedSummary.reduce((a, s) => a + s.tags, 0);
    if (!totalTags) {
      toast("ไม่มี master data ให้ล้าง", "");
      return;
    }
    const projectList = cachedSummary.map((s) => `${s.project} (${s.tags} tags)`).join(", ");
    if (!confirm(`⚠ ลบ master data ทุกโครงการ?\n\n${projectList}\n\nรวม ${totalTags} tags — ยืนยัน?`)) return;
    if (!confirm(`ยืนยันอีกครั้ง: จะลบ ${totalTags} tags ของทุกโครงการ ไม่สามารถกู้คืนได้`)) return;
    try {
      await Store.clearAllMasters();
      toast(`ล้าง master data ทั้งหมด (${totalTags} tags) แล้ว`, "ok");
      refreshStatus();
      window.dispatchEvent(new CustomEvent("data:masters-changed", { detail: { project: "*" } }));
    } catch (err) {
      toast("ล้างไม่สำเร็จ: " + err.message, "err");
    }
  }

  function setupDragDrop() {
    const box = $("master-filebox");
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
      const input = $("master-file");
      const dt = new DataTransfer();
      dt.items.add(files[0]);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  function mount() {
    $("master-file").addEventListener("change", onFileChange);
    $("master-save").addEventListener("click", onSave);
    $("master-clear").addEventListener("click", onClear);
    $("master-clear-all").addEventListener("click", onClearAll);
    $("master-project").addEventListener("change", () => {
      if (pendingParse) {
        pendingParse.project = $("master-project").value;
        renderPreview(pendingParse);
      }
    });
    setupDragDrop();
    refreshStatus();
  }

  global.UploadMasterView = { mount };
})(window);
