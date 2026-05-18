// In-memory session state — replaces the old IndexedDB-backed store.
// Data lives only in memory; closing/refreshing the tab clears everything.
// Keeps the `window.Store` API surface so views (upload-master, upload-progress,
// dashboard) don't need to change call sites.

(function (global) {
  const _state = {
    masters: [],   // { project, sourceFile, uploadedAt, tag, discipline, equipmentType, description, systems }
    progress: [],  // { project, sourceFile, uploadedAt, sheet, tag, plan, actual, discipline, equipmentType }
  };

  // Wipe any leftover IndexedDB from earlier persistent-mode versions so it
  // doesn't sit on disk wasting space and confusing future debugging.
  try { indexedDB.deleteDatabase("tocmta2026"); } catch (_) { /* ignore */ }

  function nowIso() { return new Date().toISOString(); }

  // ---------- Masters ----------
  function replaceMasters(project, sourceFile, records) {
    const uploadedAt = nowIso();
    _state.masters = _state.masters.filter((m) => m.project !== project);
    for (const r of records) {
      _state.masters.push({ project, sourceFile, uploadedAt, ...r });
    }
    return Promise.resolve(records.length);
  }

  function getMasters(project) {
    return Promise.resolve(_state.masters.filter((m) => m.project === project));
  }

  function getAllMasters() {
    return Promise.resolve(_state.masters.slice());
  }

  function masterSummary() {
    const byProject = {};
    for (const m of _state.masters) {
      const p = m.project;
      if (!byProject[p]) byProject[p] = { project: p, tags: 0, systems: new Set(), sourceFile: m.sourceFile || "", uploadedAt: m.uploadedAt || "" };
      byProject[p].tags++;
      for (const s of (m.systems || [])) byProject[p].systems.add(s);
      if (m.uploadedAt && m.uploadedAt > byProject[p].uploadedAt) {
        byProject[p].uploadedAt = m.uploadedAt;
        byProject[p].sourceFile = m.sourceFile || byProject[p].sourceFile;
      }
    }
    return Promise.resolve(Object.values(byProject).map((p) => ({
      project: p.project,
      tags: p.tags,
      systems: p.systems.size,
      sourceFile: p.sourceFile,
      uploadedAt: p.uploadedAt,
    })));
  }

  function clearMastersForProject(project) {
    _state.masters = _state.masters.filter((m) => m.project !== project);
    return Promise.resolve();
  }

  function clearAllMasters() {
    _state.masters = [];
    return Promise.resolve();
  }

  // ---------- Progress ----------
  function replaceProgressForFile(project, sourceFile, records) {
    const uploadedAt = nowIso();
    _state.progress = _state.progress.filter(
      (r) => !(r.project === project && r.sourceFile === sourceFile)
    );
    for (const r of records) {
      _state.progress.push({ project, sourceFile, uploadedAt, ...r });
    }
    return Promise.resolve(records.length);
  }

  function clearProgressForProject(project) {
    _state.progress = _state.progress.filter((r) => r.project !== project);
    return Promise.resolve();
  }

  function clearAllProgress() {
    _state.progress = [];
    return Promise.resolve();
  }

  function getProgress(project) {
    if (project) {
      return Promise.resolve(_state.progress.filter((r) => r.project === project));
    }
    return Promise.resolve(_state.progress.slice());
  }

  function progressFileSummary() {
    const map = new Map();
    for (const r of _state.progress) {
      const key = r.project + "|" + r.sourceFile;
      if (!map.has(key)) {
        map.set(key, {
          project: r.project,
          sourceFile: r.sourceFile,
          uploadedAt: r.uploadedAt,
          sheets: new Set(),
          tags: 0,
        });
      }
      const e = map.get(key);
      e.sheets.add(r.sheet);
      e.tags++;
      if (r.uploadedAt > e.uploadedAt) e.uploadedAt = r.uploadedAt;
    }
    return Promise.resolve(Array.from(map.values()).map((e) => ({
      project: e.project,
      sourceFile: e.sourceFile,
      uploadedAt: e.uploadedAt,
      sheets: e.sheets.size,
      tags: e.tags,
    })));
  }

  function hasData() {
    return _state.masters.length > 0 || _state.progress.length > 0;
  }

  global.Store = {
    replaceMasters,
    getMasters,
    getAllMasters,
    masterSummary,
    clearMastersForProject,
    clearAllMasters,
    replaceProgressForFile,
    clearProgressForProject,
    clearAllProgress,
    getProgress,
    progressFileSummary,
    hasData,
  };
})(window);
