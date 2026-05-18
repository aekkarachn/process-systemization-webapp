(function () {
  const VIEWS = {
    dashboard: { tpl: "tpl-dashboard", mount: () => DashboardView.mount() },
    master: { tpl: "tpl-master", mount: () => UploadMasterView.mount() },
    progress: { tpl: "tpl-progress", mount: () => UploadProgressView.mount() },
  };

  function renderView(name) {
    const def = VIEWS[name] || VIEWS.dashboard;
    const tpl = document.getElementById(def.tpl);
    const root = document.getElementById("view-root");
    root.innerHTML = "";
    root.appendChild(tpl.content.cloneNode(true));
    document.querySelectorAll(".tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.view === name);
    });
    def.mount();
    location.hash = "#/" + name;
  }

  function currentRoute() {
    const h = location.hash.replace(/^#\/?/, "");
    return VIEWS[h] ? h : "master";
  }

  // Toast helper, exposed globally
  window.toast = function (msg, kind) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.className = "toast show " + (kind || "");
    clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(() => {
      el.className = "toast " + (kind || "");
    }, 3000);
  };

  // Warn before refresh/close if session has data — data lives only in memory
  // and would be lost on reload.
  window.addEventListener("beforeunload", (e) => {
    if (window.Store && Store.hasData && Store.hasData()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".tab").forEach((t) => {
      t.addEventListener("click", () => renderView(t.dataset.view));
    });
    window.addEventListener("hashchange", () => renderView(currentRoute()));
    renderView(currentRoute());
  });
})();
