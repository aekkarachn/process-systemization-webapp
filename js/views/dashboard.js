// Dashboard view
//
// Aggregation formula (mean of means at every level):
//   Record-level: rec.plan, rec.actual                      (from progression file)
//   Tag-level:    Tag.Plan%    = Σ(rec.plan)   / N_records_in_tag
//                 Tag.Actual%  = Σ(rec.actual) / N_records_in_tag
//   System-level: each tag counts as 1 entry (mean of tag means)
//                 System.Plan%   = Σ(Tag.Plan%)   / N_tags_in_system
//                 System.Actual% = Σ(Tag.Actual%) / N_tags_in_system
//   Project-level: each system + unmapped-bucket-as-1-pseudo-system counts equally
//                  Project.Plan%   = Σ(System.Plan%)   / M_systems
//                  Project.Actual% = Σ(System.Actual%) / M_systems
//   Delta = Actual − Plan (computed independently at each level)
//
// Decisions:
//   Q-A: tag's records are first averaged into Tag.%, then each tag = 1 entry at system level.
//   Q-B: tags in master without any progression record → not counted (denominator excludes them).
//   Q-C: systems with no progression record → not counted in project denominator.
//   Q-D: Unmapped bucket counts as 1 pseudo-system in project rollup if it has records.
//   Q-E: tag that belongs to multiple systems contributes to each system (duplicate count).

(function (global) {
  // Status from delta (actual − plan), strict comparison:
  //   delta < 0 → behind   (red)
  //   delta = 0 → on-track (green)   ← exactly equal at 1-decimal precision
  //   delta > 0 → ahead    (green)

  function $(id) { return document.getElementById(id); }
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  // Format a percentage value (number 0..100, or null/NaN for "no data").
  // Precision: 2 decimal places (0.01% resolution).
  function fmtPct(v) {
    if (v == null || isNaN(v)) return { text: "—", pct: 0, has: false, raw: 0 };
    const r = Math.round(v * 100) / 100;
    return { text: r.toFixed(2) + "%", pct: Math.max(0, Math.min(100, r)), has: true, raw: r };
  }
  // Compare the two displayed-rounded percentage values directly.
  // This matches what the user sees in the UI — e.g., if both display "60.0%", status is ON TRACK
  // regardless of any floating-point difference in the underlying means.
  function statusFromValues(actualRaw, planRaw) {
    if (actualRaw == null || planRaw == null || isNaN(actualRaw) || isNaN(planRaw)) return "none";
    if (actualRaw < planRaw) return "behind";
    if (actualRaw > planRaw) return "ahead";
    return "on-track";
  }
  // Round a raw percentage to 2 decimals (same precision as displayed text).
  function round2(v) {
    if (v == null || isNaN(v)) return null;
    return Math.round(v * 100) / 100;
  }
  function statusLabel(s) {
    return ({ behind: "⚠ BEHIND", "on-track": "✓ ON TRACK", ahead: "▲ AHEAD", none: "— NO DATA" })[s] || "—";
  }
  function ragClass(status) {
    if (status === "behind") return "rag-red";
    if (status === "at-risk") return "rag-amber";
    if (status === "on-track") return "rag-green";
    if (status === "ahead") return "rag-blue";
    return "";
  }
  function fmtDelta(actualPct, planPct, hasActual, hasPlan) {
    if (!hasActual || !hasPlan) return { text: "—", cls: "flat", raw: null };
    const d = Math.round((actualPct - planPct) * 100) / 100;
    if (d > 0.005) return { text: "▲ " + d.toFixed(2) + " vs plan", cls: "up", raw: d };
    if (d < -0.005) return { text: "▾ " + Math.abs(d).toFixed(2) + " vs plan", cls: "down", raw: d };
    return { text: "▪ on plan", cls: "flat", raw: d };
  }
  function fmtDeltaShort(actualPct, planPct, hasActual, hasPlan) {
    if (!hasActual || !hasPlan) return { text: "—", cls: "flat", raw: null };
    const d = Math.round((actualPct - planPct) * 100) / 100;
    if (d > 0.005) return { text: "▲ " + d.toFixed(2), cls: "up", raw: d };
    if (d < -0.005) return { text: "▾ " + Math.abs(d).toFixed(2), cls: "down", raw: d };
    return { text: "▪ on plan", cls: "flat", raw: d };
  }

  let state = {
    masters: [],
    progress: [],
    expandedProjects: new Set(["CDU-1", "FCCU"]),
    expandedSystems: new Set(),
    filter: { project: "", discipline: "", search: "", sort: "progress-asc" },
    tagSort: { col: "tag", dir: "asc" }, // sort state for the tag drill-down tables (global, applied to all)
  };

  async function loadData() {
    const [masters, progress] = await Promise.all([
      Store.getAllMasters(),
      Store.getProgress(),
    ]);
    state.masters = masters;
    state.progress = progress;
  }

  function buildTagToSystems() {
    const m = new Map();
    for (const x of state.masters) {
      m.set(x.project + "|" + x.tag, x.systems || []);
    }
    return m;
  }

  // Compute simple-average means on a node with planSum / actualSum / recordCount.
  function meanOf(node) {
    if (!node || !node.recordCount) return { plan: null, actual: null };
    return {
      plan: node.planSum / node.recordCount,
      actual: node.actualSum / node.recordCount,
    };
  }

  function aggregate() {
    const tagSystems = buildTagToSystems();
    const projects = new Map();
    const allDisciplines = new Set();
    let filteredRecordCount = 0;

    for (const rec of state.progress) {
      allDisciplines.add(rec.discipline || "OTHER");
      if (state.filter.project && rec.project !== state.filter.project) continue;
      if (state.filter.discipline && rec.discipline !== state.filter.discipline) continue;
      if (state.filter.search) {
        const q = state.filter.search.toLowerCase();
        const sys = tagSystems.get(rec.project + "|" + rec.tag) || [];
        const inTag = rec.tag.toLowerCase().includes(q);
        const inSys = sys.some((s) => s.toLowerCase().includes(q));
        if (!inTag && !inSys) continue;
      }
      filteredRecordCount++;

      if (!projects.has(rec.project)) {
        projects.set(rec.project, {
          project: rec.project,
          systems: new Map(),
          unmapped: new Map(),
        });
      }
      const proj = projects.get(rec.project);
      const plan = +rec.plan || 0;
      const actual = +rec.actual || 0;

      const systems = tagSystems.get(rec.project + "|" + rec.tag) || [];
      const buckets = systems.length ? systems : ["__UNMAPPED__"];
      const target = systems.length ? proj.systems : proj.unmapped;
      for (const sys of buckets) {
        if (!target.has(sys)) {
          target.set(sys, {
            system: sys,
            planSum: 0, actualSum: 0, recordCount: 0,
            tags: new Map(),
          });
        }
        const sg = target.get(sys);
        sg.planSum += plan;
        sg.actualSum += actual;
        sg.recordCount += 1;

        if (!sg.tags.has(rec.tag)) {
          sg.tags.set(rec.tag, {
            tag: rec.tag,
            planSum: 0, actualSum: 0, recordCount: 0,
            records: [],
          });
        }
        const tg = sg.tags.get(rec.tag);
        tg.planSum += plan;
        tg.actualSum += actual;
        tg.recordCount += 1;
        tg.records.push({
          discipline: rec.discipline,
          equipmentType: rec.equipmentType,
          sheet: rec.sheet,
          plan, actual,
          sourceFile: rec.sourceFile,
        });
      }
    }

    // System-level: mean of tag means (each tag = 1 entry, regardless of how many records the tag has).
    // Project-level: mean of system means + unmapped-as-1-pseudo-system if it has records.
    const computeSystemMean = (sg) => {
      let tSumPlan = 0, tSumActual = 0, nTags = 0;
      for (const tg of sg.tags.values()) {
        if (!tg.recordCount) continue;
        tSumPlan += tg.planSum / tg.recordCount;       // Tag mean
        tSumActual += tg.actualSum / tg.recordCount;
        nTags++;
      }
      sg.planMean = nTags ? tSumPlan / nTags : null;
      sg.actualMean = nTags ? tSumActual / nTags : null;
      sg.tagDenominator = nTags;
    };

    for (const proj of projects.values()) {
      for (const sg of proj.systems.values()) computeSystemMean(sg);
      for (const sg of proj.unmapped.values()) computeSystemMean(sg);

      let psumPlan = 0, psumActual = 0, mSystems = 0;
      for (const sg of proj.systems.values()) {
        if (sg.planMean == null) continue;
        psumPlan += sg.planMean;
        psumActual += sg.actualMean;
        mSystems++;
      }
      // Q-D: Unmapped bucket = 1 pseudo-system in project rollup (its mean from above counts as one).
      let unmappedCount = 0;
      for (const sg of proj.unmapped.values()) {
        if (sg.planMean == null) continue;
        psumPlan += sg.planMean;
        psumActual += sg.actualMean;
        mSystems++;
        unmappedCount += sg.recordCount;
      }
      proj.planMean = mSystems ? psumPlan / mSystems : null;
      proj.actualMean = mSystems ? psumActual / mSystems : null;
      proj.systemDenominator = mSystems;
      proj.unmappedRecordCount = unmappedCount;
    }

    return { projects, allDisciplines, filteredRecordCount };
  }

  function renderKpis(projects) {
    for (const projName of ["CDU-1", "FCCU"]) {
      const card = document.querySelector(`.kpi[data-project="${projName}"]`);
      if (!card) continue;
      const proj = projects.get(projName);
      const badge = card.querySelector(".status-badge");
      const valueEl = card.querySelector(".actual");
      const deltaEl = card.querySelector(".kpi-delta");
      const planEl = card.querySelector(".plan");
      const actualInline = card.querySelector(".actual-inline");
      const barFill = card.querySelector(".bar > span");
      const atRiskEl = card.querySelector(".kpi-at-risk");
      const metaEl = card.querySelector(".meta");

      if (!proj) {
        card.dataset.status = "";
        badge.dataset.status = "";
        badge.textContent = "— NO DATA";
        valueEl.textContent = "—";
        deltaEl.textContent = "—";
        deltaEl.className = "kpi-delta flat";
        planEl.textContent = "—";
        actualInline.textContent = "—";
        barFill.style.width = "0%";
        barFill.className = "";
        atRiskEl.textContent = "";
        metaEl.textContent = "no data";
        continue;
      }
      const actPct = fmtPct(proj.actualMean);
      const planPct = fmtPct(proj.planMean);
      const delta = fmtDelta(actPct.raw, planPct.raw, actPct.has, planPct.has);
      const status = statusFromValues(actPct.has ? actPct.raw : null, planPct.has ? planPct.raw : null);

      card.dataset.status = status;
      badge.dataset.status = status;
      badge.textContent = statusLabel(status);
      valueEl.textContent = actPct.text;
      deltaEl.textContent = delta.text;
      deltaEl.className = "kpi-delta " + delta.cls;
      planEl.textContent = planPct.text;
      actualInline.textContent = actPct.text;
      barFill.style.width = actPct.pct + "%";
      barFill.className = ragClass(status);

      // Count mapped systems where Actual < Plan (using rounded display values for consistency with badges).
      let behindCount = 0;
      for (const sg of proj.systems.values()) {
        if (sg.planMean == null) continue;
        if (round2(sg.actualMean) < round2(sg.planMean)) behindCount++;
      }
      atRiskEl.textContent = behindCount ? `⚠ ${behindCount} systems behind` : "";

      const sysCount = proj.systems.size;
      const unmappedTagCount = Array.from(proj.unmapped.values()).reduce((a, x) => a + x.tags.size, 0);
      const allTags = new Set();
      let projRecordCount = 0;
      for (const s of proj.systems.values()) { for (const t of s.tags.keys()) allTags.add(t); projRecordCount += s.recordCount; }
      for (const s of proj.unmapped.values()) { for (const t of s.tags.keys()) allTags.add(t); projRecordCount += s.recordCount; }
      metaEl.textContent = `${sysCount} systems · ${allTags.size} tags · ${projRecordCount} records${unmappedTagCount ? " · " + unmappedTagCount + " unmapped" : ""}`;
    }
  }

  function renderDisciplineFilter(allDisciplines) {
    const sel = $("filter-discipline");
    const current = sel.value;
    const opts = ['<option value="">ทั้งหมด</option>'];
    for (const d of Array.from(allDisciplines).sort()) {
      opts.push(`<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`);
    }
    sel.innerHTML = opts.join("");
    sel.value = current;
  }

  function renderFilterChips() {
    const root = $("filter-chips");
    const chips = [];
    if (state.filter.project) chips.push({ label: `โครงการ: ${state.filter.project}`, key: "project" });
    if (state.filter.discipline) chips.push({ label: `Discipline: ${state.filter.discipline}`, key: "discipline" });
    if (state.filter.search) chips.push({ label: `Search: ${state.filter.search}`, key: "search" });
    if (!chips.length) { root.innerHTML = ""; return; }
    root.innerHTML = chips.map((c) =>
      `<span class="filter-chip">${escapeHtml(c.label)}<button data-clear="${c.key}" title="Remove filter">×</button></span>`
    ).join("") + `<button class="filter-chip-clear" data-clear="all">Clear all</button>`;
  }

  function renderResultCount(projects, filteredRecordCount) {
    const el = $("result-count");
    const sysCount = Array.from(projects.values()).reduce((a, p) => a + p.systems.size + p.unmapped.size, 0);
    const tagSet = new Set();
    for (const p of projects.values()) {
      for (const s of p.systems.values()) for (const t of s.tags.keys()) tagSet.add(p.project + "|" + t);
      for (const s of p.unmapped.values()) for (const t of s.tags.keys()) tagSet.add(p.project + "|" + t);
    }
    const totalProgress = state.progress.length;
    const hasFilter = state.filter.project || state.filter.discipline || state.filter.search;
    if (!totalProgress) {
      el.innerHTML = `<span class="muted">ยังไม่มี progression data — ลอง upload ก่อน</span>`;
      return;
    }
    if (hasFilter) {
      el.innerHTML = `แสดง <strong>${tagSet.size}</strong> tags · <strong>${sysCount}</strong> systems · <strong>${filteredRecordCount}</strong> records (จาก ${totalProgress} records ทั้งหมด)`;
    } else {
      el.innerHTML = `<strong>${tagSet.size}</strong> tags · <strong>${sysCount}</strong> systems · <strong>${filteredRecordCount}</strong> progression records`;
    }
  }

  function systemSort(a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true });
  }

  // Sort tag entries based on state.tagSort (applied to all tag drill-down tables).
  function sortTags(entries) {
    const { col, dir } = state.tagSort;
    const factor = dir === "asc" ? 1 : -1;
    const arr = entries.slice();
    if (col === "tag") {
      arr.sort((x, y) => factor * String(x.tag).localeCompare(String(y.tag), undefined, { numeric: true }));
      return arr;
    }
    arr.sort((x, y) => {
      const mx = meanOf(x), my = meanOf(y);
      let av, bv;
      if (col === "plan") { av = mx.plan; bv = my.plan; }
      else if (col === "actual") { av = mx.actual; bv = my.actual; }
      else if (col === "delta") {
        av = mx.plan != null ? mx.actual - mx.plan : null;
        bv = my.plan != null ? my.actual - my.plan : null;
      }
      // Treat null as -Infinity for asc (pushed to bottom of "asc" results when reversed).
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return factor * (av - bv);
    });
    return arr;
  }
  function sortSystems(entries, mode) {
    const withPct = entries.map((sg) => {
      const delta = sg.planMean == null ? null : sg.actualMean - sg.planMean;
      return { sg, actualPct: sg.actualMean, delta, tagCount: sg.tags.size };
    });
    switch (mode) {
      case "progress-asc":
        withPct.sort((x, y) => (x.actualPct ?? -1) - (y.actualPct ?? -1) || systemSort(x.sg.system, y.sg.system));
        break;
      case "progress-desc":
        withPct.sort((x, y) => (y.actualPct ?? -1) - (x.actualPct ?? -1) || systemSort(x.sg.system, y.sg.system));
        break;
      case "delta-asc":
        withPct.sort((x, y) => (x.delta ?? 999) - (y.delta ?? 999) || systemSort(x.sg.system, y.sg.system));
        break;
      case "tags-desc":
        withPct.sort((x, y) => y.tagCount - x.tagCount || systemSort(x.sg.system, y.sg.system));
        break;
      case "name":
      default:
        withPct.sort((x, y) => systemSort(x.sg.system, y.sg.system));
    }
    return withPct.map((w) => w.sg);
  }

  function renderHierarchy(projects) {
    const root = $("hierarchy");
    const projectOrder = ["CDU-1", "FCCU"];
    const have = projectOrder.filter((p) => projects.has(p));
    if (!have.length) {
      root.innerHTML = `<div class="empty">ยังไม่มีข้อมูลตรงตามฟิลเตอร์ — ลองล้าง filter หรือ upload data ก่อน</div>`;
      return;
    }
    const html = have.map((pname) => {
      const proj = projects.get(pname);
      const projActPct = fmtPct(proj.actualMean);
      const projPlanPct = fmtPct(proj.planMean);
      const projDelta = fmtDeltaShort(projActPct.raw, projPlanPct.raw, projActPct.has, projPlanPct.has);

      const sortedSystems = sortSystems(Array.from(proj.systems.values()), state.filter.sort);
      const sortedUnmapped = sortSystems(Array.from(proj.unmapped.values()), state.filter.sort);

      const renderSystem = (sg, isUnmapped) => {
        const a = fmtPct(sg.actualMean);
        const p = fmtPct(sg.planMean);
        const delta = fmtDeltaShort(a.raw, p.raw, a.has, p.has);
        const status = statusFromValues(a.has ? a.raw : null, p.has ? p.raw : null);
        const tagEntries = sortTags(Array.from(sg.tags.values()));
        const tagRows = tagEntries.flatMap((tg) => {
          const tm = meanOf(tg);
          const tagA = fmtPct(tm.actual);
          const tagP = fmtPct(tm.plan);
          const tagD = fmtDeltaShort(tagA.raw, tagP.raw, tagA.has, tagP.has);
          return tg.records.map((rec, i) => {
            const behindCls = (Number(rec.actual) < Number(rec.plan)) ? "row-behind" : "";
            return `
            <tr class="${behindCls}">
              ${i === 0 ? `
                <td rowspan="${tg.records.length}"><strong>${escapeHtml(tg.tag)}</strong></td>
                <td rowspan="${tg.records.length}" class="num">${tagP.text}</td>
                <td rowspan="${tg.records.length}" class="num">${tagA.text}</td>
                <td rowspan="${tg.records.length}" class="num sys-delta ${tagD.cls}">${tagD.text}</td>
              ` : ""}
              <td>${escapeHtml(rec.discipline)}</td>
              <td>${escapeHtml(rec.equipmentType)}</td>
              <td class="num">${rec.plan}</td>
              <td class="num">${rec.actual}</td>
            </tr>
          `;
          });
        }).join("");
        const sysKey = pname + "|" + sg.system;
        const open = state.expandedSystems.has(sysKey) ? "open" : "";
        const sysLabel = sg.system === "__UNMAPPED__" ? "(ไม่ map กับ system ใด)" : sg.system;
        const rag = ragClass(status);
        const th = (col, label, isNum) => {
          const active = state.tagSort.col === col;
          const arrow = active ? (state.tagSort.dir === "asc" ? "▲" : "▼") : "↕";
          return `<th class="${isNum ? "num " : ""}sortable${active ? " sort-active" : ""}" data-tag-sort="${col}">${label} <span class="sort-arrow">${arrow}</span></th>`;
        };
        return `
          <div class="h-system ${open} ${isUnmapped ? "unmapped" : ""}" data-syskey="${escapeHtml(sysKey)}">
            <div class="h-system-head" data-action="toggle-system">
              <div class="sys-row1">
                <span class="collapse-icon"></span>
                <span class="sys-name">${escapeHtml(sysLabel)}</span>
                <span class="sys-meta">${tagEntries.length} tags · ${sg.recordCount} records</span>
                <span class="sys-status" data-status="${status}">${statusLabel(status)}</span>
              </div>
              <div class="sys-row2">
                <div class="sys-bars">
                  <div class="sys-bar-row row-plan">
                    <span class="bar-label">Plan</span>
                    <div class="sys-bar"><span style="width:${p.pct}%"></span></div>
                    <span class="sys-pct">${p.text}</span>
                  </div>
                  <div class="sys-bar-row row-actual">
                    <span class="bar-label">Actual</span>
                    <div class="sys-bar"><span class="${rag}" style="width:${a.pct}%"></span></div>
                    <span class="sys-pct">${a.text}</span>
                  </div>
                </div>
                <span class="sys-delta ${delta.cls}">${delta.text}</span>
              </div>
            </div>
            <div class="h-tag-list">
              <table class="data">
                <thead><tr>
                  ${th("tag", "Tag", false)}
                  ${th("plan", "Plan %", true)}
                  ${th("actual", "Actual %", true)}
                  ${th("delta", "Δ", true)}
                  <th>Discipline</th>
                  <th>Equipment / Sheet</th>
                  <th class="num">Rec Plan</th>
                  <th class="num">Rec Actual</th>
                </tr></thead>
                <tbody>${tagRows}</tbody>
              </table>
            </div>
          </div>
        `;
      };

      const mappedHtml = sortedSystems.map((sg) => renderSystem(sg, false)).join("");
      const unmappedHtml = sortedUnmapped.length
        ? `<div class="section-header warn"><span>⚠ ไม่ map กับ system ใด (นับเป็น 1 pseudo-system ใน project rollup)</span><span class="hr"></span></div>` +
          sortedUnmapped.map((sg) => renderSystem(sg, true)).join("")
        : "";

      const open = state.expandedProjects.has(pname) ? "open" : "";
      return `
        <div class="h-project ${open}" data-project="${escapeHtml(pname)}">
          <div class="h-project-head" data-action="toggle-project">
            <span class="collapse-icon"></span>
            <span>${escapeHtml(pname)}</span>
            <span class="muted" title="ค่า Plan/Actual คือค่าเฉลี่ยจากทุก system (mean of system means${sortedUnmapped.length ? " + Unmapped นับเป็น 1 pseudo-system" : ""}) → denominator = ${proj.systemDenominator}">— ${sortedSystems.length} systems${sortedUnmapped.length ? " + Unmapped" : ""} · Plan ${projPlanPct.text}, Actual ${projActPct.text}</span>
            <span class="proj-pct">${projActPct.text} <span class="sys-delta ${projDelta.cls}" style="font-size:11px;margin-left:8px">${projDelta.text}</span></span>
          </div>
          <div class="h-system-list">
            ${mappedHtml || '<div class="empty">ไม่มี system</div>'}
            ${unmappedHtml}
          </div>
        </div>
      `;
    }).join("");
    root.innerHTML = html;
  }

  async function render() {
    await loadData();
    // Guard: if Dashboard view not currently mounted, skip DOM updates (still keep state fresh for next mount).
    if (!$("hierarchy")) return;
    const { projects, allDisciplines, filteredRecordCount } = aggregate();
    renderDisciplineFilter(allDisciplines);
    renderFilterChips();
    renderResultCount(projects, filteredRecordCount);
    renderKpis(projects);
    renderHierarchy(projects);
    const refEl = $("last-refresh");
    if (refEl) {
      const t = new Date().toLocaleTimeString();
      refEl.textContent = `อัปเดต ${t} · ${state.masters.length} masters, ${state.progress.length} records`;
    }
    console.log("[Dashboard] render", {
      masters: state.masters.length,
      progress: state.progress.length,
      projects: Array.from(projects.keys()).map((p) => ({
        project: p,
        systems: projects.get(p).systems.size,
        unmapped: projects.get(p).unmapped.size,
        planMean: projects.get(p).planMean,
        actualMean: projects.get(p).actualMean,
      })),
      time: new Date().toISOString(),
    });
  }

  function onToggle(e) {
    // Tag table column sort — check FIRST so it doesn't bubble to toggle handlers.
    const sortTh = e.target.closest("th[data-tag-sort]");
    if (sortTh) {
      const col = sortTh.dataset.tagSort;
      if (state.tagSort.col === col) {
        state.tagSort.dir = state.tagSort.dir === "asc" ? "desc" : "asc";
      } else {
        state.tagSort.col = col;
        state.tagSort.dir = "asc";
      }
      render();
      return;
    }
    const sysHead = e.target.closest('[data-action="toggle-system"]');
    if (sysHead) {
      const parent = sysHead.parentElement;
      const key = parent.dataset.syskey;
      if (state.expandedSystems.has(key)) state.expandedSystems.delete(key);
      else state.expandedSystems.add(key);
      parent.classList.toggle("open");
      return;
    }
    const projHead = e.target.closest('[data-action="toggle-project"]');
    if (projHead) {
      const parent = projHead.parentElement;
      const pname = parent.dataset.project;
      if (state.expandedProjects.has(pname)) state.expandedProjects.delete(pname);
      else state.expandedProjects.add(pname);
      parent.classList.toggle("open");
    }
  }

  function onFilterChange() {
    state.filter.project = $("filter-project").value;
    state.filter.discipline = $("filter-discipline").value;
    state.filter.search = $("filter-search").value.trim();
    state.filter.sort = $("filter-sort").value;
    render();
  }

  function onChipClear(e) {
    const btn = e.target.closest("[data-clear]");
    if (!btn) return;
    const key = btn.dataset.clear;
    if (key === "all") {
      state.filter.project = ""; state.filter.discipline = ""; state.filter.search = "";
      $("filter-project").value = ""; $("filter-discipline").value = ""; $("filter-search").value = "";
    } else if (key === "project") { state.filter.project = ""; $("filter-project").value = ""; }
    else if (key === "discipline") { state.filter.discipline = ""; $("filter-discipline").value = ""; }
    else if (key === "search") { state.filter.search = ""; $("filter-search").value = ""; }
    render();
  }

  function expandAll() {
    const { projects } = aggregate();
    for (const [pname, proj] of projects) {
      state.expandedProjects.add(pname);
      for (const sys of proj.systems.keys()) state.expandedSystems.add(pname + "|" + sys);
      for (const sys of proj.unmapped.keys()) state.expandedSystems.add(pname + "|" + sys);
    }
    render();
  }
  function collapseAll() {
    state.expandedSystems.clear();
    render();
  }

  function exportXlsx() {
    const { projects } = aggregate();
    const rows = [[
      "Project", "System", "Tag", "Discipline", "Equipment/Sheet",
      "Rec Plan", "Rec Actual",
      "Tag Plan %", "Tag Actual %", "Tag Delta",
      "System Plan %", "System Actual %", "System Delta",
      "Project Plan %", "Project Actual %", "Project Delta",
    ]];
    for (const [pname, proj] of projects) {
      const pPlan = proj.planMean ?? 0;
      const pAct = proj.actualMean ?? 0;
      const pDelta = pAct - pPlan;
      const all = [...proj.systems.values(), ...proj.unmapped.values()];
      for (const sg of all) {
        const sPlan = sg.planMean ?? 0;
        const sAct = sg.actualMean ?? 0;
        const sDelta = sAct - sPlan;
        for (const tg of sg.tags.values()) {
          const tm = meanOf(tg);
          const tPlan = tm.plan ?? 0;
          const tAct = tm.actual ?? 0;
          const tDelta = tAct - tPlan;
          for (const rec of tg.records) {
            rows.push([
              pname,
              sg.system === "__UNMAPPED__" ? "(unmapped)" : sg.system,
              tg.tag,
              rec.discipline,
              rec.equipmentType,
              rec.plan,
              rec.actual,
              Math.round(tPlan * 100) / 100,
              Math.round(tAct * 100) / 100,
              Math.round(tDelta * 100) / 100,
              Math.round(sPlan * 100) / 100,
              Math.round(sAct * 100) / 100,
              Math.round(sDelta * 100) / 100,
              Math.round(pPlan * 100) / 100,
              Math.round(pAct * 100) / 100,
              Math.round(pDelta * 100) / 100,
            ]);
          }
        }
      }
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Progression");
    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `TOC1-MTA2026-progression-${stamp}.xlsx`);
  }

  function mount() {
    $("hierarchy").addEventListener("click", onToggle);
    $("filter-project").addEventListener("change", onFilterChange);
    $("filter-discipline").addEventListener("change", onFilterChange);
    $("filter-sort").addEventListener("change", onFilterChange);
    $("filter-search").addEventListener("input", debounce(onFilterChange, 200));
    $("filter-chips").addEventListener("click", onChipClear);
    $("expand-all").addEventListener("click", expandAll);
    $("collapse-all").addEventListener("click", collapseAll);
    $("export-btn").addEventListener("click", exportXlsx);
    $("refresh-btn").addEventListener("click", render);
    window.addEventListener("data:masters-changed", render);
    window.addEventListener("data:progress-changed", render);
    render();
  }

  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  global.DashboardView = { mount };
})(window);
