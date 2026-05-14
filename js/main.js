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
    return VIEWS[h] ? h : "dashboard";
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

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".tab").forEach((t) => {
      t.addEventListener("click", () => renderView(t.dataset.view));
    });
    window.addEventListener("hashchange", () => renderView(currentRoute()));
    renderView(currentRoute());
  });
})();
