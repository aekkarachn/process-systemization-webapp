// IndexedDB wrapper for the Process Systemization app.
// Two object stores:
//   masters  — keyPath: [project, tag]      — one row per tag in master file
//   progress — keyPath: id (auto)           — one row per (project, sourceFile, sheet, rowIdx) progression record
//
// Indexes let us query by project quickly and replace records on re-upload.

(function (global) {
  const DB_NAME = "tocmta2026";
  const DB_VERSION = 1;

  let _dbPromise = null;

  function openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("masters")) {
          const s = db.createObjectStore("masters", { keyPath: ["project", "tag"] });
          s.createIndex("by_project", "project", { unique: false });
        }
        if (!db.objectStoreNames.contains("progress")) {
          const s = db.createObjectStore("progress", { keyPath: "id", autoIncrement: true });
          s.createIndex("by_project", "project", { unique: false });
          s.createIndex("by_project_file", ["project", "sourceFile"], { unique: false });
          s.createIndex("by_tag", "tag", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return _dbPromise;
  }

  function tx(stores, mode) {
    return openDB().then((db) => db.transaction(stores, mode));
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // ---------- Masters ----------
  async function replaceMasters(project, sourceFile, records) {
    const t = await tx(["masters"], "readwrite");
    const store = t.objectStore("masters");
    const idx = store.index("by_project");
    await new Promise((resolve, reject) => {
      const range = IDBKeyRange.only(project);
      const cur = idx.openCursor(range);
      cur.onsuccess = (e) => {
        const c = e.target.result;
        if (c) { c.delete(); c.continue(); }
        else resolve();
      };
      cur.onerror = () => reject(cur.error);
    });
    const uploadedAt = new Date().toISOString();
    for (const r of records) {
      store.put({ project, sourceFile, uploadedAt, ...r });
    }
    return new Promise((resolve, reject) => {
      t.oncomplete = () => resolve(records.length);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  async function getMasters(project) {
    const t = await tx(["masters"], "readonly");
    const idx = t.objectStore("masters").index("by_project");
    return reqToPromise(idx.getAll(IDBKeyRange.only(project)));
  }

  async function getAllMasters() {
    const t = await tx(["masters"], "readonly");
    return reqToPromise(t.objectStore("masters").getAll());
  }

  async function masterSummary() {
    const all = await getAllMasters();
    const byProject = {};
    for (const m of all) {
      const p = m.project;
      if (!byProject[p]) byProject[p] = { project: p, tags: 0, systems: new Set(), sourceFile: m.sourceFile || "", uploadedAt: m.uploadedAt || "" };
      byProject[p].tags++;
      for (const s of (m.systems || [])) byProject[p].systems.add(s);
      // Use the latest uploadedAt (records of the same project share one upload session).
      if (m.uploadedAt && m.uploadedAt > byProject[p].uploadedAt) {
        byProject[p].uploadedAt = m.uploadedAt;
        byProject[p].sourceFile = m.sourceFile || byProject[p].sourceFile;
      }
    }
    return Object.values(byProject).map((p) => ({
      project: p.project,
      tags: p.tags,
      systems: p.systems.size,
      sourceFile: p.sourceFile,
      uploadedAt: p.uploadedAt,
    }));
  }

  // ---------- Progress ----------
  async function replaceProgressForFile(project, sourceFile, records) {
    const t = await tx(["progress"], "readwrite");
    const store = t.objectStore("progress");
    const idx = store.index("by_project_file");
    await new Promise((resolve, reject) => {
      const range = IDBKeyRange.only([project, sourceFile]);
      const cur = idx.openCursor(range);
      cur.onsuccess = (e) => {
        const c = e.target.result;
        if (c) { c.delete(); c.continue(); }
        else resolve();
      };
      cur.onerror = () => reject(cur.error);
    });
    const uploadedAt = new Date().toISOString();
    for (const r of records) {
      store.add({ project, sourceFile, uploadedAt, ...r });
    }
    return new Promise((resolve, reject) => {
      t.oncomplete = () => resolve(records.length);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  async function clearProgressForProject(project) {
    const t = await tx(["progress"], "readwrite");
    const idx = t.objectStore("progress").index("by_project");
    await new Promise((resolve, reject) => {
      const cur = idx.openCursor(IDBKeyRange.only(project));
      cur.onsuccess = (e) => {
        const c = e.target.result;
        if (c) { c.delete(); c.continue(); }
        else resolve();
      };
      cur.onerror = () => reject(cur.error);
    });
    return new Promise((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }

  async function clearMastersForProject(project) {
    const t = await tx(["masters"], "readwrite");
    const idx = t.objectStore("masters").index("by_project");
    await new Promise((resolve, reject) => {
      const cur = idx.openCursor(IDBKeyRange.only(project));
      cur.onsuccess = (e) => {
        const c = e.target.result;
        if (c) { c.delete(); c.continue(); }
        else resolve();
      };
      cur.onerror = () => reject(cur.error);
    });
    return new Promise((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }

  async function clearAllMasters() {
    const t = await tx(["masters"], "readwrite");
    t.objectStore("masters").clear();
    return new Promise((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }

  async function clearAllProgress() {
    const t = await tx(["progress"], "readwrite");
    t.objectStore("progress").clear();
    return new Promise((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }

  async function getProgress(project) {
    const t = await tx(["progress"], "readonly");
    if (project) {
      const idx = t.objectStore("progress").index("by_project");
      return reqToPromise(idx.getAll(IDBKeyRange.only(project)));
    }
    return reqToPromise(t.objectStore("progress").getAll());
  }

  async function progressFileSummary() {
    const all = await getProgress();
    const map = new Map();
    for (const r of all) {
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
    return Array.from(map.values()).map((e) => ({
      project: e.project,
      sourceFile: e.sourceFile,
      uploadedAt: e.uploadedAt,
      sheets: e.sheets.size,
      tags: e.tags,
    }));
  }

  global.Store = {
    openDB,
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
  };
})(window);
