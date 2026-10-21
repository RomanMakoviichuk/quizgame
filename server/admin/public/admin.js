/* «Хто є хто!» admin panel — vanilla JS SPA. No build step, no framework.
   Hash routes: #/dashboard  #/categories  #/questions  #/import  */
(function () {
  "use strict";

  var TOKEN_KEY = "quizgame_admin_token";
  var state = {
    token: localStorage.getItem(TOKEN_KEY) || null,
    meta: null,
    categories: [],
  };

  var app = document.getElementById("app");
  var toastEl = document.getElementById("toast");

  // -------------------------------------------------------------- helpers

  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === "class") el.className = attrs[k];
      else if (k === "html") el.innerHTML = attrs[k];
      else if (k === "text") el.textContent = attrs[k];
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null && attrs[k] !== false) el.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      if (c == null) return;
      el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return el;
  }

  function toast(msg, kind) {
    toastEl.textContent = msg;
    toastEl.className = "toast " + (kind || "");
    toastEl.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { toastEl.hidden = true; }, 3200);
  }

  function api(method, path, body) {
    var opts = { method: method, headers: {} };
    if (state.token) opts.headers["Authorization"] = "Bearer " + state.token;
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    return fetch(path, opts).then(function (res) {
      if (res.status === 401 && path.indexOf("/login") === -1) {
        logout();
        throw new Error("Сесія завершилася. Увійдіть знову.");
      }
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || "Помилка запиту (" + res.status + ")");
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  function logout() {
    state.token = null;
    localStorage.removeItem(TOKEN_KEY);
    render();
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // -------------------------------------------------------------- login

  function renderLogin() {
    var input = h("input", { type: "password", placeholder: "Пароль", id: "pw", autocomplete: "current-password" });
    var btn = h("button", { class: "btn block", text: "Увійти" });
    var form = h("form", { class: "card" }, [
      h("div", { class: "login-logo", text: "🎉" }),
      h("h2", { text: "Хто є хто!" }),
      h("p", { class: "login-sub", text: "Керування питаннями" }),
      h("p", { class: "hint", text: "Введіть пароль адміністратора." }),
      h("div", { class: "field" }, [input]),
      btn,
    ]);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      btn.disabled = true;
      api("POST", "/api/admin/login", { password: input.value })
        .then(function (data) {
          state.token = data.token;
          localStorage.setItem(TOKEN_KEY, data.token);
          if (!location.hash) location.hash = "#/dashboard";
          render();
        })
        .catch(function (err) { toast(err.message, "err"); btn.disabled = false; });
    });
    app.innerHTML = "";
    app.appendChild(h("div", { class: "login-wrap" }, [form]));
  }

  // -------------------------------------------------------------- shell

  function shell(activeRoute, content) {
    var routes = [
      ["#/dashboard", "📊", "Дашборд"],
      ["#/categories", "📚", "Категорії"],
      ["#/questions", "❓", "Питання"],
      ["#/import", "⇅", "Імпорт / Експорт", "Імпорт"],
    ];
    // one nav: in the top bar on a computer, a tab bar at the bottom on a phone
    var nav = h("nav", { class: "nav" }, routes.map(function (r) {
      return h("a", { href: r[0], class: activeRoute === r[0] ? "active" : "" }, [
        h("span", { class: "nav-ico", text: r[1] }),
        h("span", { class: "nav-long", text: r[2] }),
        h("span", { class: "nav-short", text: r[3] || r[2] }),
      ]);
    }));
    var top = h("div", { class: "topbar" }, [
      h("span", { class: "brand" }, [
        h("span", { class: "brand-logo", text: "🎉" }),
        h("span", { text: "Хто є хто!" }),
        h("span", { class: "brand-sub", text: "адмін" }),
      ]),
      nav,
      h("button", { class: "btn secondary small logout", text: "Вийти", onclick: function () {
        api("POST", "/api/admin/logout").catch(function () {}).then(logout);
      } }),
    ]);
    app.innerHTML = "";
    app.appendChild(top);
    var wrap = h("div", { class: "wrap" });
    wrap.appendChild(content);
    app.appendChild(wrap);
  }

  // A table whose cells know their column (data-label): on a phone every row
  // turns into a card and the column names become the captions inside it.
  function table(headers, rows, empty) {
    rows.forEach(function (tr) {
      Array.prototype.forEach.call(tr.children, function (td, i) {
        if (headers[i]) td.setAttribute("data-label", headers[i]);
      });
    });
    return h("div", { class: "table-wrap" }, [h("table", { class: "cards" }, [
      h("thead", {}, [h("tr", {}, headers.map(function (t) { return h("th", { text: t }); }))]),
      h("tbody", {}, rows.length ? rows : [h("tr", { class: "empty" }, [h("td", { colspan: headers.length, text: empty })])]),
    ])]);
  }

  function loadingCard() { return h("div", { class: "card", text: "Завантаження…" }); }

  // -------------------------------------------------------------- dashboard

  function viewDashboard() {
    var container = h("div");
    shell("#/dashboard", container);
    container.appendChild(loadingCard());
    api("GET", "/api/admin/stats").then(function (s) {
      container.innerHTML = "";
      container.appendChild(h("h1", { class: "page-title", text: "Дашборд" }));
      container.appendChild(h("div", { class: "stat-grid" }, [
        stat(s.totalCategories, "Категорій", "📚"),
        stat(s.activeCategories, "Активних категорій", "✅"),
        stat(s.inactiveCategories, "Неактивних категорій", "💤"),
        stat(s.totalQuestions, "Питань усього", "❓"),
        stat(s.activeQuestions, "Активних питань", "⚡"),
      ]));
      var rows = s.perCategory.map(function (c) {
        return h("tr", {}, [
          h("td", { class: "cell-title", text: (c.icon ? c.icon + " " : "") + c.name }),
          h("td", {}, [h("span", { class: "tag " + (c.isActive ? "on" : "off"), text: c.isActive ? "активна" : "вимкнена" })]),
          h("td", { class: "num-cell", text: String(c.total) }),
          h("td", { class: "num-cell", text: String(c.active) }),
        ]);
      });
      container.appendChild(h("div", { class: "card" }, [
        h("h3", { text: "Питання за категоріями" }),
        table(["Категорія", "Статус", "Питань", "Активних"], rows, "Немає категорій"),
      ]));
    }).catch(function (e) { toast(e.message, "err"); });
  }

  function stat(num, lbl, icon) {
    return h("div", { class: "stat" }, [
      h("div", { class: "ico", text: icon || "" }),
      h("div", { class: "num", text: String(num) }),
      h("div", { class: "lbl", text: lbl }),
    ]);
  }

  // -------------------------------------------------------------- categories

  function loadCategories() {
    return api("GET", "/api/admin/categories").then(function (d) {
      state.categories = d.categories;
      return d.categories;
    });
  }

  function viewCategories() {
    var container = h("div");
    shell("#/categories", container);
    container.appendChild(h("div", { class: "toolbar" }, [
      h("h1", { text: "Категорії", class: "grow page-title" }),
      h("button", { class: "btn", text: "+ Нова категорія", onclick: function () { categoryModal(null); } }),
    ]));
    var tableCard = h("div", { class: "card flush", text: "Завантаження…" });
    container.appendChild(tableCard);

    loadCategories().then(function (cats) {
      tableCard.innerHTML = "";
      var rows = cats.map(function (c) {
        return h("tr", {}, [
          h("td", { class: "cell-title" }, [
            h("div", { class: "title", text: (c.icon ? c.icon + " " : "") + c.name }),
            h("div", { class: "hint", text: c.slug }),
            c.description ? h("div", { class: "hint", text: c.description }) : null,
          ]),
          h("td", {}, [
            h("span", { class: "tag " + (c.isActive ? "on" : "off"), text: c.isActive ? "активна" : "вимкнена" }),
            !c.playable ? h("div", {}, [h("span", { class: "tag warn", text: "мало питань" })]) : null,
          ]),
          h("td", { text: c.questionCount + " (актив.: " + c.activeQuestionCount + ")" }),
          h("td", { class: "actions-cell" }, [
            h("button", { class: "btn small secondary", text: "Редагувати", onclick: function () { categoryModal(c); } }),
            h("button", { class: "btn small secondary", text: c.isActive ? "Вимкнути" : "Увімкнути", onclick: function () {
              api("PUT", "/api/admin/categories/" + c.id, { isActive: !c.isActive })
                .then(function () { toast("Оновлено", "ok"); viewCategories(); })
                .catch(function (e) { toast(e.message, "err"); });
            } }),
            h("button", { class: "btn small secondary", text: "Питання →", onclick: function () {
              location.hash = "#/questions?category=" + c.id;
            } }),
            h("button", { class: "btn small danger", text: "Видалити", onclick: function () { deleteCategory(c); } }),
          ]),
        ]);
      });
      tableCard.appendChild(table(["Назва", "Статус", "Питання", "Дії"], rows, "Ще немає категорій"));
    }).catch(function (e) { toast(e.message, "err"); });
  }

  function categoryModal(cat) {
    var isEdit = !!cat;
    var f = {
      name: h("input", { type: "text", value: cat ? cat.name : "" }),
      icon: h("input", { type: "text", value: cat && cat.icon ? cat.icon : "", placeholder: "🌍 (емодзі, необов'язково)" }),
      slug: h("input", { type: "text", value: cat ? cat.slug : "", placeholder: "авто з назви" }),
      description: h("textarea", {}, [cat && cat.description ? cat.description : ""]),
      isActive: h("input", { type: "checkbox" }),
    };
    if (!cat || cat.isActive) f.isActive.checked = true;
    var errBox = h("div");
    var body = h("div", {}, [
      errBox,
      field("Назва *", f.name),
      h("div", { class: "row" }, [field("Емодзі / іконка", f.icon), field("Ідентифікатор (slug)", f.slug)]),
      field("Опис", f.description),
      h("div", { class: "field checkline" }, [f.isActive, h("span", { text: "Активна (доступна для вибору у грі)" })]),
    ]);
    modal(isEdit ? "Редагувати категорію" : "Нова категорія", body, function (close, saveBtn) {
      saveBtn.disabled = true;
      var payload = {
        name: f.name.value, icon: f.icon.value, slug: f.slug.value,
        description: f.description.value, isActive: f.isActive.checked,
      };
      var p = isEdit
        ? api("PUT", "/api/admin/categories/" + cat.id, payload)
        : api("POST", "/api/admin/categories", payload);
      p.then(function () { close(); toast("Збережено", "ok"); viewCategories(); })
       .catch(function (e) { showErrors(errBox, e); saveBtn.disabled = false; });
    });
  }

  function deleteCategory(c) {
    var force = false;
    function attempt() {
      api("DELETE", "/api/admin/categories/" + c.id + (force ? "?force=1" : ""))
        .then(function (r) {
          toast("Категорію видалено" + (r.deletedQuestions ? " разом із " + r.deletedQuestions + " питаннями" : ""), "ok");
          viewCategories();
        })
        .catch(function (e) {
          if (e.data && e.data.requiresForce) {
            if (confirm(e.data.error + "\n\nВидалити категорію РАЗОМ з усіма " + e.data.questionCount + " питаннями? Це незворотно.")) {
              force = true; attempt();
            }
          } else {
            toast(e.message, "err");
          }
        });
    }
    if (confirm("Видалити категорію «" + c.name + "»?")) attempt();
  }

  // -------------------------------------------------------------- questions

  function parseQuery() {
    var q = (location.hash.split("?")[1] || "");
    var out = {};
    q.split("&").forEach(function (kv) {
      if (!kv) return;
      var p = kv.split("=");
      out[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || "");
    });
    return out;
  }

  var qState = { page: 1, pageSize: 25, search: "", category: "", status: "all", difficulty: "", sort: "created_desc" };
  var DIFF_LABELS = { easy: "легка", medium: "середня", hard: "складна" };

  function viewQuestions() {
    var qp = parseQuery();
    if (qp.category !== undefined) qState.category = qp.category;

    var container = h("div");
    shell("#/questions", container);

    Promise.resolve(state.categories.length ? state.categories : loadCategories()).then(function () {
      container.innerHTML = "";
      container.appendChild(h("div", { class: "toolbar" }, [
        h("h1", { text: "Питання", class: "grow page-title" }),
        h("button", { class: "btn", text: "+ Нове питання", onclick: function () { questionModal(null); } }),
      ]));

      var searchInput = h("input", { type: "search", placeholder: "Пошук за текстом…", value: qState.search });
      var catSelect = h("select", {}, [h("option", { value: "", text: "Усі категорії" })].concat(
        state.categories.map(function (c) {
          return h("option", { value: c.id, text: c.name, selected: c.id === qState.category ? "selected" : false });
        })
      ));
      var statusSelect = h("select", {}, [
        ["all", "Усі статуси"], ["active", "Активні"], ["inactive", "Вимкнені"],
      ].map(function (o) {
        return h("option", { value: o[0], text: o[1], selected: o[0] === qState.status ? "selected" : false });
      }));
      var diffSelect = h("select", {}, [
        ["", "Усі складності"], ["easy", "Легкі"], ["medium", "Середні"], ["hard", "Складні"],
      ].map(function (o) {
        return h("option", { value: o[0], text: o[1], selected: o[0] === qState.difficulty ? "selected" : false });
      }));
      var sortSelect = h("select", {}, [
        ["created_desc", "Спочатку нові"], ["created_asc", "Спочатку старі"],
        ["text_asc", "За текстом (А-Я)"], ["category_asc", "За категорією"], ["order_asc", "За порядком"],
        ["difficulty_asc", "За складністю (легкі → складні)"], ["difficulty_desc", "За складністю (складні → легкі)"],
      ].map(function (o) {
        return h("option", { value: o[0], text: o[1], selected: o[0] === qState.sort ? "selected" : false });
      }));

      var apply = debounce(function () {
        qState.search = searchInput.value;
        qState.category = catSelect.value;
        qState.status = statusSelect.value;
        qState.difficulty = diffSelect.value;
        qState.sort = sortSelect.value;
        qState.page = 1;
        loadRows();
      }, 250);
      [searchInput, catSelect, statusSelect, diffSelect, sortSelect].forEach(function (el) {
        el.addEventListener("input", apply);
        el.addEventListener("change", apply);
      });

      container.appendChild(h("div", { class: "filters card" }, [
        h("div", { class: "f-search" }, [label("Пошук"), searchInput]),
        h("div", {}, [label("Категорія"), catSelect]),
        h("div", {}, [label("Статус"), statusSelect]),
        h("div", {}, [label("Складність"), diffSelect]),
        h("div", {}, [label("Сортування"), sortSelect]),
      ]));

      var tableCard = h("div", { class: "card flush", text: "Завантаження…" });
      container.appendChild(tableCard);

      function loadRows() {
        var params = new URLSearchParams({
          category: qState.category, status: qState.status, difficulty: qState.difficulty, search: qState.search,
          page: qState.page, pageSize: qState.pageSize, sort: qState.sort,
        });
        api("GET", "/api/admin/questions?" + params.toString()).then(function (res) {
          tableCard.innerHTML = "";
          var rows = res.items.map(function (q) {
            var correct = (q.answers.find(function (a) { return a.isCorrect; }) || {}).text || "—";
            return h("tr", {}, [
              h("td", { class: "cell-title" }, [
                h("div", { class: "title", text: q.text }),
                h("div", { class: "hint", text: "складність: " + (DIFF_LABELS[q.difficulty] || "середня (не вказана)") }),
              ]),
              h("td", { text: q.categoryName }),
              h("td", { class: "correct-cell", text: correct }),
              h("td", {}, [h("span", { class: "tag " + (q.isActive ? "on" : "off"), text: q.isActive ? "активне" : "вимкнене" })]),
              h("td", { class: "actions-cell" }, [
                h("button", { class: "btn small secondary", text: "Редагувати", onclick: function () { questionModal(q); } }),
                h("button", { class: "btn small secondary", text: "Дублювати", onclick: function () {
                  api("POST", "/api/admin/questions/" + q.id + "/duplicate")
                    .then(function (r) { toast("Створено копію", "ok"); questionModal(r.question); loadRows(); })
                    .catch(function (e) { toast(e.message, "err"); });
                } }),
                h("button", { class: "btn small secondary", text: q.isActive ? "Вимкнути" : "Увімкнути", onclick: function () {
                  api("PUT", "/api/admin/questions/" + q.id, { isActive: !q.isActive })
                    .then(function () { loadRows(); }).catch(function (e) { toast(e.message, "err"); });
                } }),
                h("button", { class: "btn small danger", text: "Видалити", onclick: function () {
                  if (confirm("Видалити це питання?")) {
                    api("DELETE", "/api/admin/questions/" + q.id)
                      .then(function () { toast("Видалено", "ok"); loadRows(); })
                      .catch(function (e) { toast(e.message, "err"); });
                  }
                } }),
              ]),
            ]);
          });
          tableCard.appendChild(table(["Питання", "Категорія", "Правильна", "Статус", "Дії"], rows, "Нічого не знайдено"));
          tableCard.appendChild(h("div", { class: "pager" }, [
            h("button", { class: "btn small secondary", text: "‹ Назад", disabled: res.page <= 1 ? "disabled" : false, onclick: function () { qState.page = res.page - 1; loadRows(); } }),
            h("span", { class: "pager-info", html: "<b>" + res.page + "</b> / " + res.totalPages + " · усього " + res.total }),
            h("button", { class: "btn small secondary", text: "Далі ›", disabled: res.page >= res.totalPages ? "disabled" : false, onclick: function () { qState.page = res.page + 1; loadRows(); } }),
          ]));
        }).catch(function (e) { toast(e.message, "err"); });
      }
      loadRows();
    });
  }

  function questionModal(q) {
    var isEdit = !!q;
    var cats = state.categories;
    if (!cats.length) { toast("Спочатку створіть категорію", "err"); return; }

    var answers = (q && q.answers && q.answers.length === 4)
      ? q.answers.map(function (a) { return { id: a.id, text: a.text, isCorrect: a.isCorrect }; })
      : [0, 1, 2, 3].map(function () { return { text: "", isCorrect: false }; });
    if (!answers.some(function (a) { return a.isCorrect; })) answers[0].isCorrect = true;

    var catSelect = h("select", {}, cats.map(function (c) {
      return h("option", { value: c.id, text: c.name, selected: q && q.categoryId === c.id ? "selected" : false });
    }));
    var textInput = h("textarea", {}, [q ? q.text : ""]);
    var diffSelect = h("select", {}, [h("option", { value: "", text: "— без складності —" })].concat(
      (state.meta.difficulties || []).map(function (d) {
        return h("option", { value: d, text: DIFF_LABELS[d] || d, selected: q && q.difficulty === d ? "selected" : false });
      })
    ));
    var activeCheck = h("input", { type: "checkbox" });
    if (!q || q.isActive) activeCheck.checked = true;
    var explInput = h("textarea", {}, [q && q.explanation ? q.explanation : ""]);

    var answerRows = answers.map(function (a, i) {
      var radio = h("input", { type: "radio", name: "correct", checked: a.isCorrect ? "checked" : false });
      var inp = h("input", { type: "text", value: a.text });
      a._radio = radio; a._input = inp;
      return h("div", { class: "answer-row" }, [
        radio,
        h("span", { class: "a-label", text: String.fromCharCode(65 + i) }),
        inp,
      ]);
    });

    var errBox = h("div");
    var body = h("div", {}, [
      errBox,
      h("div", { class: "row" }, [field("Категорія *", catSelect), field("Складність", diffSelect)]),
      field("Текст питання *", textInput),
      h("div", { class: "field" }, [
        label("Відповіді * (позначте правильну)"),
        h("div", {}, answerRows),
      ]),
      field("Пояснення (необов'язково)", explInput),
      h("div", { class: "field checkline" }, [activeCheck, h("span", { text: "Активне" })]),
    ]);

    modal((isEdit ? "Редагувати питання" : "Нове питання"), body, function (close, saveBtn) {
      saveBtn.disabled = true;
      var correctIdx = answers.findIndex(function (a) { return a._radio.checked; });
      var payloadAnswers = answers.map(function (a, i) {
        return { id: a.id, text: a._input.value, isCorrect: i === correctIdx };
      });
      var payload = {
        categoryId: catSelect.value,
        text: textInput.value,
        difficulty: diffSelect.value || null,
        isActive: activeCheck.checked,
        explanation: explInput.value,
        answers: payloadAnswers,
      };
      var p = isEdit
        ? api("PUT", "/api/admin/questions/" + q.id, payload)
        : api("POST", "/api/admin/questions", payload);
      p.then(function () { close(); toast("Збережено", "ok"); viewQuestions(); })
       .catch(function (e) { showErrors(errBox, e); saveBtn.disabled = false; });
    }, [
      h("button", { class: "btn secondary", text: "Зберегти і додати ще", onclick: function () {
        var mb = document.querySelector(".modal-back");
        var correctIdx = answers.findIndex(function (a) { return a._radio.checked; });
        var payload = {
          categoryId: catSelect.value, text: textInput.value,
          difficulty: diffSelect.value || null, isActive: activeCheck.checked,
          explanation: explInput.value,
          answers: answers.map(function (a, i) { return { text: a._input.value, isCorrect: i === correctIdx }; }),
        };
        api("POST", "/api/admin/questions", payload).then(function () {
          toast("Додано. Форма очищена.", "ok");
          if (mb) mb.remove();
        document.body.classList.remove("modal-open");
          questionModal({ categoryId: catSelect.value });
          viewQuestions();
        }).catch(function (e) { showErrors(errBox, e); });
      } }),
    ]);
  }

  // -------------------------------------------------------------- import / export

  function viewImport() {
    var container = h("div");
    shell("#/import", container);
    container.appendChild(h("h1", { class: "page-title", text: "Імпорт / Експорт" }));

    // export
    container.appendChild(h("div", { class: "card" }, [
      h("h3", { text: "Експорт" }),
      h("p", { class: "hint", text: "CSV зручний для редагування у таблицях; JSON зберігає всю структуру." }),
      h("div", { class: "btn-row" }, [
        h("button", { class: "btn secondary", text: "Завантажити CSV", onclick: function () { download("csv"); } }),
        h("button", { class: "btn secondary", text: "Завантажити JSON", onclick: function () { download("json"); } }),
      ]),
    ]));

    // import
    var fmt = h("select", {}, [h("option", { value: "csv", text: "CSV" }), h("option", { value: "json", text: "JSON" })]);
    var fileInput = h("input", { type: "file", accept: ".csv,.json,text/csv,application/json" });
    var textArea = h("textarea", { placeholder: "…або вставте вміст сюди" });
    var createMissing = h("input", { type: "checkbox", checked: "checked" });
    var resultBox = h("div");
    var importBtn = h("button", { class: "btn", text: "Перевірити та імпортувати" });

    fileInput.addEventListener("change", function () {
      var file = fileInput.files[0];
      if (!file) return;
      if (/\.json$/i.test(file.name)) fmt.value = "json";
      if (/\.csv$/i.test(file.name)) fmt.value = "csv";
      var reader = new FileReader();
      reader.onload = function () { textArea.value = reader.result; };
      reader.readAsText(file);
    });

    importBtn.addEventListener("click", function () {
      resultBox.innerHTML = "";
      importBtn.disabled = true;
      api("POST", "/api/admin/import", {
        format: fmt.value,
        data: textArea.value,
        createMissingCategories: createMissing.checked,
      }).then(function (r) {
        importBtn.disabled = false;
        resultBox.appendChild(h("div", { class: "errbox", html:
          "<strong>Готово.</strong> Додано питань: " + r.inserted +
          (r.createdCategories ? ", створено категорій: " + r.createdCategories : "") }));
        toast("Імпортовано " + r.inserted + " питань", "ok");
        loadCategories();
      }).catch(function (e) {
        importBtn.disabled = false;
        var d = e.data || {};
        if (d.errors && d.errors.length) {
          resultBox.appendChild(h("div", { class: "errbox" }, [
            h("strong", { text: "Імпорт скасовано — знайдено помилки (нічого не змінено):" }),
            h("ul", {}, d.errors.slice(0, 100).map(function (er) {
              return h("li", { text: "Рядок " + er.row + ": " + er.message });
            })),
          ]));
        } else {
          toast(e.message, "err");
        }
      });
    });

    container.appendChild(h("div", { class: "card" }, [
      h("h3", { text: "Імпорт" }),
      h("p", { class: "hint", html:
        "Формат CSV: <code>" + esc((state.meta.csvHeader || []).join(",")) +
        "</code>. Дані перевіряються повністю перед вставкою — за наявності хоча б однієї помилки не додається нічого." }),
      h("div", { class: "row" }, [field("Формат", fmt), field("Файл", fileInput)]),
      field("Вміст", textArea),
      h("div", { class: "field checkline" }, [createMissing, h("span", { text: "Створювати відсутні категорії автоматично" })]),
      h("div", { class: "btn-row" }, [importBtn]),
      resultBox,
    ]));
  }

  function download(format) {
    fetch("/api/admin/export?format=" + format, { headers: { Authorization: "Bearer " + state.token } })
      .then(function (r) { return r.blob(); })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = format === "csv" ? "quizgame-questions.csv" : "quizgame-content.json";
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
      })
      .catch(function (e) { toast(e.message, "err"); });
  }

  // -------------------------------------------------------------- generic modal

  function modal(title, body, onSave, extraButtons) {
    var closeBtn = h("button", { class: "btn secondary", text: "Скасувати" });
    var saveBtn = h("button", { class: "btn", text: "Зберегти" });
    var xBtn = h("button", { class: "modal-x", type: "button", "aria-label": "Закрити", text: "✕" });
    var back = h("div", { class: "modal-back" }, [
      h("div", { class: "modal" }, [
        h("div", { class: "modal-head" }, [h("h2", { text: title }), xBtn]),
        h("div", { class: "modal-body" }, [body]),
        h("div", { class: "modal-foot" }, (extraButtons || []).concat([closeBtn, saveBtn])),
      ]),
    ]);
    function close() { back.remove(); document.body.classList.remove("modal-open"); }
    document.body.classList.add("modal-open");
    closeBtn.addEventListener("click", close);
    xBtn.addEventListener("click", close);
    back.addEventListener("click", function (e) { if (e.target === back) close(); });
    saveBtn.addEventListener("click", function () { onSave(close, saveBtn); });
    document.body.appendChild(back);
  }

  function field(lbl, control) {
    return h("div", { class: "field" }, [label(lbl), control]);
  }
  function label(text) { return h("label", { text: text }); }

  function showErrors(box, err) {
    box.innerHTML = "";
    var list = (err.data && err.data.errors) || [err.message];
    box.appendChild(h("div", { class: "errbox" }, [
      h("strong", { text: "Не збережено:" }),
      h("ul", {}, list.map(function (m) { return h("li", { text: m }); })),
    ]));
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  // -------------------------------------------------------------- router

  function render() {
    if (!state.token) { renderLogin(); return; }
    if (!state.meta) {
      api("GET", "/api/admin/meta").then(function (m) {
        state.meta = m;
        return loadCategories();
      }).then(render).catch(function (e) { toast(e.message, "err"); });
      app.innerHTML = "<div class='wrap'><div class='card'>Завантаження…</div></div>";
      return;
    }
    var route = (location.hash.split("?")[0]) || "#/dashboard";
    if (route === "#/" || route === "#") route = "#/dashboard";
    if (route === "#/dashboard") viewDashboard();
    else if (route === "#/categories") viewCategories();
    else if (route === "#/questions") viewQuestions();
    else if (route === "#/import") viewImport();
    else { location.hash = "#/dashboard"; }
  }

  window.addEventListener("hashchange", render);
  render();
})();
