/* =========================================================================
   Фрейя — логика панели управления
   Закрытый раздел: вход по паролю (по умолчанию 242564).
   Все данные хранятся через FreyaData (data.js) — тот же слой, что читает сайт.
   ========================================================================= */
(function () {
  "use strict";

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  var SESSION_KEY = "freya_admin_session";
  var STD_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "42", "44", "46", "48"];

  var data = null;        // текущие данные магазина
  var draft = null;       // товар в редакторе
  var draftIndex = -1;    // -1 = новый товар
  var query = "";         // строка поиска
  var pendingCatDelete = null;  // slug категории, для которой спрашиваем подтверждение
  var orderRows = [];
  var orderFilter = "active";
  var ordersLoading = false;
  var ordersTimer = null;
  var ORDER_STATUSES = [
    { id: "new", label: "Новый" },
    { id: "processing", label: "В работе" },
    { id: "awaiting_customer", label: "Ожидает ответа клиента" },
    { id: "confirmed", label: "Подтверждён" },
    { id: "shipped", label: "Отправлен" },
    { id: "completed", label: "Выполнен" },
    { id: "cancelled", label: "Отменён" }
  ];

  /* ------------------------------ Служебное ------------------------------ */

  function esc(text) {
    return String(text === null || text === undefined ? "" : text)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function price(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "\u2009") + "\u2009\u20bd";
  }

  function plural(n, one, few, many) {
    var m10 = n % 10;
    var m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }

  var toastTimer = null;
  function toast(message) {
    var box = $("#aToast");
    box.textContent = message;
    box.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("is-visible"); }, 2200);
  }

  // Любое изменение данных идёт только через mutate():
  // сразу показываем результат в панели, параллельно отправляем каталог на сервер.
  // Сервер тут же делает резервную копию. Если сервер отказал — возвращаем как было.
  var saving = 0;

  window.addEventListener('beforeunload', function (e) {
    if (!saving) return;
    e.preventDefault();
    e.returnValue = '';
  });

  function mutate(change, message) {
    var backup = FreyaData.clone(data);
    change();
    data.updatedAt = new Date().toISOString();
    data = FreyaData.normalize(data);
    renderAll();

    saving++;
    FreyaApi.putCatalog(FreyaData.clone(data), function (res) {
      saving--;
      if (!res.ok) {
        data = backup;
        renderAll();
        if (res.status === 401) {
          toast('Сеанс закончился — войдите в панель заново');
          setTimeout(function () { location.reload(); }, 1800);
          return;
        }
        toast(res.error || 'Сервер не принял изменения');
        return;
      }
      if (message) toast(message);
      renderDataTab();
    });
    return true;
  }

  /* ------------------------------ Вход по паролю ------------------------------ */

  function openAdmin() {
    $("#lock").hidden = true;
    $("#app").hidden = false;
    boot();
  }

  // Пароль проверяет сервер: в браузере он больше не хранится.
  $("#lockForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var entered = $("#pass").value.trim();
    if (!entered) return;
    $("#lockError").hidden = true;
    FreyaApi.login(entered, function (res) {
      $("#pass").value = "";
      if (res.ok) { openAdmin(); return; }
      var box = $("#lockError");
      if (res.error) box.textContent = res.error;
      box.hidden = false;
      $("#pass").focus();
    });
  });

  $("#logoutBtn").addEventListener("click", function () {
    FreyaApi.logout(function () { location.reload(); });
  });

  /* ------------------------------ Загрузка данных ------------------------------ */

  function boot() {
    FreyaApi.getCatalog(function (res) {
      if (res.ok && res.data && res.data.catalog) {
        data = FreyaData.normalize(res.data.catalog);
        renderAll();
        loadOrders(true);
        startOrdersPolling();
        return;
      }
      data = FreyaData.defaults();
      renderAll();
      loadOrders(true);
      startOrdersPolling();
      toast(res.error || "Сервер не отдал каталог — показываю заводские товары");
    });
  }

  /* ------------------------------ Табы ------------------------------ */

  $("#aTabs").addEventListener("click", function (e) {
    var tab = e.target.closest(".a-tab");
    if (!tab) return;
    $$(".a-tab").forEach(function (t) { t.classList.toggle("is-active", t === tab); });
    var name = tab.getAttribute("data-tab");
    $$(".a-view").forEach(function (view) {
      view.hidden = view.id !== "tab-" + name;
    });
    if (name === "orders") loadOrders(true);
    window.scrollTo(0, 0);
  });

  /* ============================== ЗАКАЗЫ ============================== */

  function orderStatusLabel(status) {
    for (var i = 0; i < ORDER_STATUSES.length; i++) {
      if (ORDER_STATUSES[i].id === status) return ORDER_STATUSES[i].label;
    }
    return status || "Новый";
  }

  function orderDate(value) {
    var date = new Date(value);
    if (isNaN(date.getTime())) return "";
    return date.toLocaleString("ru-RU", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit"
    });
  }

  function orderStatusOptions(selected) {
    return ORDER_STATUSES.map(function (item) {
      return '<option value="' + item.id + '"' + (item.id === selected ? " selected" : "") + '>' + esc(item.label) + '</option>';
    }).join("");
  }

  function orderCardHTML(order) {
    var customer = order.customer || {};
    var items = Array.isArray(order.items) ? order.items : [];
    var phoneHref = String(customer.phone || "").replace(/[^+\d]/g, "");
    var itemsHtml = items.map(function (item) {
      var details = [item.color, item.size].filter(Boolean).join(" / ");
      var productHref = "index.html#/product/" + encodeURIComponent(item.productId || "");
      return '<div class="o-item">' +
        '<div><b>' + esc(item.name || "Товар") + '</b>' +
          (details ? '<div class="o-item-meta">' + esc(details) + '</div>' : '') +
          (item.productId ? '<a class="o-item-link" href="' + esc(productHref) + '" target="_blank" rel="noopener">Открыть товар</a>' : '') + '</div>' +
        '<div>' + (Number(item.qty) || 1) + ' × ' + price(Number(item.unitPrice) || 0) + '</div>' +
      '</div>';
    }).join("");

    return '<article class="o-card" data-id="' + esc(order.id) + '" data-status="' + esc(order.status) + '">' +
      '<div class="o-head"><div><h2 class="o-number">Заказ №' + esc(order.number) + '</h2>' +
        '<p class="o-date">' + esc(orderDate(order.createdAt)) + '</p></div>' +
        '<div class="o-total">' + price(Number(order.total) || 0) + '</div></div>' +
      '<p class="o-customer"><b>' + esc(customer.name || "Без имени") + '</b><br>' +
        '<a href="tel:' + esc(phoneHref) + '">' + esc(customer.phone || "Телефон не указан") + '</a></p>' +
      '<div class="o-items">' + itemsHtml + '</div>' +
      '<label class="o-status-label">Статус заказа</label>' +
      '<select class="input o-status" data-previous="' + esc(order.status) + '" aria-label="Статус заказа №' + esc(order.number) + '">' +
        orderStatusOptions(order.status) + '</select>' +
    '</article>';
  }

  function filteredOrders() {
    if (orderFilter === "all") return orderRows;
    if (orderFilter === "active") {
      return orderRows.filter(function (order) {
        return order.status !== "completed" && order.status !== "cancelled";
      });
    }
    return orderRows.filter(function (order) { return order.status === orderFilter; });
  }

  function renderOrders() {
    var rows = filteredOrders();
    $("#oList").innerHTML = rows.map(orderCardHTML).join("");
    $("#oEmpty").hidden = rows.length > 0;
    $("#oEmpty").textContent = orderRows.length ? "В этом разделе заказов нет" : "Заказов пока нет";
    var fresh = orderRows.filter(function (order) { return order.status === "new"; }).length;
    $("#ordersBadge").textContent = fresh;
    $("#ordersBadge").hidden = fresh === 0;
  }

  function loadOrders(silent) {
    if (ordersLoading) return;
    ordersLoading = true;
    if (!silent) toast("Обновляю заказы…");
    FreyaApi.getOrders(function (res) {
      ordersLoading = false;
      if (!res.ok || !res.data) {
        if (res.status === 401) {
          toast("Сеанс закончился — войдите заново");
          setTimeout(function () { location.reload(); }, 1500);
          return;
        }
        if (!silent) toast(res.error || "Не удалось получить заказы");
        return;
      }
      orderRows = Array.isArray(res.data.orders) ? res.data.orders : [];
      if (Array.isArray(res.data.statuses) && res.data.statuses.length) ORDER_STATUSES = res.data.statuses;
      renderOrders();
      $("#ordersUpdated").textContent = orderRows.length
        ? "Обновлено: " + new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
        : "Новых заказов пока нет. Список обновляется автоматически.";
    });
  }

  function startOrdersPolling() {
    if (ordersTimer) return;
    ordersTimer = setInterval(function () {
      if (!document.hidden) loadOrders(true);
    }, 30000);
  }

  $("#orderFilter").addEventListener("change", function () {
    orderFilter = this.value;
    renderOrders();
  });

  $("#refreshOrders").addEventListener("click", function () { loadOrders(false); });

  $("#oList").addEventListener("change", function (e) {
    var select = e.target.closest(".o-status");
    if (!select) return;
    var card = select.closest(".o-card");
    var id = card.getAttribute("data-id");
    var previous = select.getAttribute("data-previous") || "new";
    var next = select.value;
    select.disabled = true;
    FreyaApi.updateOrderStatus(id, next, function (res) {
      select.disabled = false;
      if (!res.ok || !res.data || !res.data.order) {
        select.value = previous;
        toast(res.error || "Не удалось изменить статус");
        return;
      }
      for (var i = 0; i < orderRows.length; i++) {
        if (orderRows[i].id === id) { orderRows[i] = res.data.order; break; }
      }
      renderOrders();
      toast("Статус: " + orderStatusLabel(next));
    });
  });

  /* ============================== ТОВАРЫ ============================== */

  function matchesQuery(p) {
    if (!query) return true;
    var needle = query.toLowerCase();
    return p.name.toLowerCase().indexOf(needle) > -1 ||
      FreyaData.categoryTitle(data, p.category).toLowerCase().indexOf(needle) > -1;
  }

  function productRowHTML(p, index, total) {
    var thumb = p.images.length
      ? '<img src="' + esc(p.images[0]) + '" alt="">'
      : "";
    var meta = [
      esc(FreyaData.categoryTitle(data, p.category) || "без категории"),
      (p.oldPrice ? '<span class="p-old">' + price(p.oldPrice) + "</span> " : "") + price(p.price),
      p.images.length + " " + plural(p.images.length, "фото", "фото", "фото")
    ].join(" · ");

    return '<div class="p-row' + (p.isActive ? "" : " is-off") + '" data-id="' + esc(p.id) + '">' +
      '<div class="p-thumb">' + thumb + "</div>" +
      "<div>" +
        '<p class="p-name">' + esc(p.name) + "</p>" +
        '<p class="p-meta">' + meta + "</p>" +
        '<div class="p-flags">' +
          '<label class="check"><input type="checkbox" data-flag="isNew"' + (p.isNew ? " checked" : "") + "><span>Новинка</span></label>" +
          '<label class="check"><input type="checkbox" data-flag="isSale"' + (p.isSale ? " checked" : "") + "><span>Акция</span></label>" +
          '<label class="check"><input type="checkbox" data-flag="isActive"' + (p.isActive ? " checked" : "") + "><span>Виден</span></label>" +
        "</div>" +
      "</div>" +
      '<div class="p-actions">' +
        '<button class="p-btn p-btn--main" type="button" data-act="edit">Изменить</button>' +
        '<button class="p-btn" type="button" data-act="up"' + (index === 0 ? " disabled" : "") + ">↑</button>" +
        '<button class="p-btn" type="button" data-act="down"' + (index === total - 1 ? " disabled" : "") + ">↓</button>" +
        '<button class="p-btn" type="button" data-act="copy">Дублировать</button>' +
        '<a class="p-btn" href="index.html#/product/' + esc(p.id) + '" target="_blank" rel="noopener">На сайте</a>' +
        '<button class="p-btn p-btn--del" type="button" data-act="del">Удалить</button>' +
      "</div>" +
    "</div>";
  }

  function renderProducts() {
    var total = data.products.length;
    var rows = [];
    data.products.forEach(function (p, i) {
      if (matchesQuery(p)) rows.push(productRowHTML(p, i, total));
    });
    $("#pList").innerHTML = rows.join("");
    $("#pEmpty").hidden = rows.length > 0;
    $("#pEmpty").textContent = total ? "Ничего не найдено" : "Товаров пока нет — нажмите «+ Товар»";
  }

  $("#search").addEventListener("input", function () {
    query = this.value.trim();
    renderProducts();
  });

  // быстрые галочки в списке: новинка / акция / виден на сайте
  $("#pList").addEventListener("change", function (e) {
    var box = e.target.closest("input[data-flag]");
    if (!box) return;
    var row = e.target.closest(".p-row");
    var id = row.getAttribute("data-id");
    var flag = box.getAttribute("data-flag");
    var value = box.checked;
    mutate(function () {
      var p = FreyaData.productById(data, id);
      if (p) p[flag] = value;
    }, "Сохранено");
  });

  $("#pList").addEventListener("click", function (e) {
    var btn = e.target.closest("button[data-act]");
    if (!btn) return;
    var id = btn.closest(".p-row").getAttribute("data-id");
    var index = -1;
    data.products.forEach(function (p, i) { if (p.id === id) index = i; });
    if (index < 0) return;
    var act = btn.getAttribute("data-act");

    if (act === "edit") { openEditor(index); return; }

    if (act === "up" || act === "down") {
      var to = act === "up" ? index - 1 : index + 1;
      if (to < 0 || to >= data.products.length) return;
      mutate(function () {
        var moved = data.products.splice(index, 1)[0];
        data.products.splice(to, 0, moved);
      }, "Порядок изменён");
      return;
    }

    if (act === "copy") {
      mutate(function () {
        var copy = FreyaData.clone(data.products[index]);
        var taken = data.products.map(function (p) { return p.id; });
        copy.id = FreyaData.uniqueId(FreyaData.slugify(copy.name) || "tovar", taken);
        copy.name = copy.name + " (копия)";
        copy.isActive = false;
        data.products.splice(index + 1, 0, copy);
      }, "Создана копия — она скрыта до правки");
      return;
    }

    if (act === "del") {
      if (!confirm("Удалить товар «" + data.products[index].name + "»?")) return;
      mutate(function () { data.products.splice(index, 1); }, "Товар удалён");
    }
  });

  /* ============================== РЕДАКТОР ТОВАРА ============================== */

  function blankProduct() {
    return {
      id: "",
      name: "",
      price: 0,
      oldPrice: null,
      category: data.categories.length ? data.categories[0].slug : "",
      isNew: true,
      isSale: false,
      isActive: true,
      color: "",
      colors: ["#1E3A2B"],
      sizes: FreyaData.SIZES_DEFAULT.slice(),
      images: [],
      videos: [],
      description: "",
      composition: []
    };
  }

  $("#addProduct").addEventListener("click", function () {
    if (!data.categories.length) {
      toast("Сначала добавьте хотя бы одну категорию");
      return;
    }
    openEditor(-1);
  });

  function openEditor(index) {
    draftIndex = index;
    draft = index > -1 ? FreyaData.clone(data.products[index]) : blankProduct();
    if (!Array.isArray(draft.videos)) draft.videos = [];

    $("#eTitle").textContent = index > -1 ? "Изменить товар" : "Новый товар";
    $("#eDelete").hidden = index < 0;

    $("#fName").value = draft.name;
    $("#fCategory").innerHTML = data.categories.map(function (c) {
      return '<option value="' + esc(c.slug) + '"' + (c.slug === draft.category ? " selected" : "") + ">" + esc(c.title) + "</option>";
    }).join("");
    $("#fPrice").value = draft.price || "";
    $("#fOldPrice").value = draft.oldPrice || "";
    $("#fNew").checked = !!draft.isNew;
    $("#fSale").checked = !!draft.isSale;
    $("#fActive").checked = draft.isActive !== false;
    $("#fColor").value = draft.color;
    $("#fDesc").value = draft.description;
    $("#fComp").value = draft.composition.join("\n");
    $("#photoUrl").value = "";
    $("#videoUrl").value = "";
    $("#newSize").value = "";

    renderPhotos();
    renderVideos();
    renderColors();
    renderSizes();

    $("#editor").hidden = false;
    document.body.classList.add("is-locked");
    $("#editor").scrollTop = 0;
  }

  function closeEditor() {
    $("#editor").hidden = true;
    document.body.classList.remove("is-locked");
    draft = null;
    draftIndex = -1;
  }

  /* ---------------------------- Фотографии ---------------------------- */

  function renderPhotos() {
    var box = $("#fPhotos");
    if (!draft.images.length) {
      box.innerHTML = '<p class="ph-empty">Фотографий пока нет</p>';
      return;
    }
    box.innerHTML = draft.images.map(function (src, i) {
      return '<div class="ph' + (i === 0 ? " is-main" : "") + '">' +
        '<img src="' + esc(FreyaApi.mediaUrl(src, { thumb: true })) + '" alt="Фото ' + (i + 1) + '">' +
        (i === 0 ? '<span class="ph-badge">Основное</span>' : "") +
        '<div class="ph-btns">' +
          (i === 0 ? "" : '<button type="button" data-ph="main" data-i="' + i + '" title="Сделать основным">★</button>') +
          '<button type="button" data-ph="left" data-i="' + i + '" title="Левее">←</button>' +
          '<button type="button" data-ph="right" data-i="' + i + '" title="Правее">→</button>' +
          '<button type="button" data-ph="del" data-i="' + i + '" title="Удалить">✕</button>' +
        "</div>" +
      "</div>";
    }).join("");
  }

  $("#fPhotos").addEventListener("click", function (e) {
    var btn = e.target.closest("button[data-ph]");
    if (!btn || !draft) return;
    var i = Number(btn.getAttribute("data-i"));
    var act = btn.getAttribute("data-ph");

    if (act === "main") {
      draft.images.unshift(draft.images.splice(i, 1)[0]);
    } else if (act === "left" && i > 0) {
      draft.images.splice(i - 1, 0, draft.images.splice(i, 1)[0]);
    } else if (act === "right" && i < draft.images.length - 1) {
      draft.images.splice(i + 1, 0, draft.images.splice(i, 1)[0]);
    } else if (act === "del") {
      draft.images.splice(i, 1);
    }
    renderPhotos();
  });

  // Фото уходят на сервер как есть — там ffmpeg делает два webp:
  // большой для карточки товара и маленький для плитки каталога.
  // Телефон ничего не считает и не греется.
  var photoBusy = false;

  $("#photoFile").addEventListener("change", function () {
    var files = Array.prototype.slice.call(this.files || []);
    this.value = "";
    if (!files.length || !draft) return;
    if (photoBusy) { toast("Дождитесь загрузки предыдущих фото"); return; }

    var limitMb = FreyaApi.limits().uploadPhotoMb;
    var total = files.length;
    var index = 0;
    var added = 0;
    photoBusy = true;

    function next() {
      if (index >= total) {
        photoBusy = false;
        renderPhotos();
        toast(added
          ? "Загружено фото: " + added + " — не забудьте «Сохранить»"
          : "Фото загрузить не удалось");
        return;
      }
      var file = files[index];
      var human = index + 1;
      index++;

      if (!/^image\//.test(file.type)) { toast("«" + file.name + "» — не картинка"); next(); return; }
      if (file.size > limitMb * 1024 * 1024) {
        toast("«" + file.name + "» тяжелее " + limitMb + " МБ");
        next();
        return;
      }

      FreyaApi.uploadPhoto(file, draft.id || "common", function (percent) {
        toast(percent < 100
          ? "Фото " + human + " из " + total + " — " + percent + "%"
          : "Фото " + human + " из " + total + " — обрабатываю…");
      }, function (res) {
        if (res.ok && res.data && res.data.src) {
          draft.images.push(res.data.src);
          added++;
          renderPhotos();
        } else {
          toast(res.error || "Фото не загрузилось");
        }
        next();
      });
    }

    next();
  });

  $("#photoUrlAdd").addEventListener("click", function () {
    var url = $("#photoUrl").value.trim();
    if (!url || !draft) return;
    draft.images.push(url);
    $("#photoUrl").value = "";
    renderPhotos();
  });

  /* ---------------------------- Видео ---------------------------- */

  // Ролики пережимает СЕРВЕР через ffmpeg: всегда 1080p, всегда 30 кадров,
  // максимум 20 секунд, H.264 + AAC и faststart — такое видео открывает и iPhone,
  // и Android. Браузер только отдаёт файл: ничего не считает и не греется.

  function mb(bytes) {
    if (!bytes) return "";
    var value = bytes / (1024 * 1024);
    return (value < 10 ? value.toFixed(1) : Math.round(value)) + " МБ";
  }

  function renderVideos() {
    var box = $("#fVideos");
    if (!draft.videos.length) {
      box.innerHTML = '<p class="ph-empty">Видео пока нет</p>';
      return;
    }
    box.innerHTML = draft.videos.map(function (v, i) {
      var legacy = v.src.indexOf("idb:") === 0;
      var poster = v.poster ? FreyaApi.mediaUrl(v.poster) : "";
      var preview = poster
        ? '<img src="' + esc(poster) + '" alt="Видео ' + (i + 1) + '">'
        : (legacy
            ? '<span class="vd-stub">старое видео</span>'
            : '<video src="' + esc(FreyaApi.mediaUrl(v.src)) + '" muted playsinline preload="metadata"></video>');
      var meta = [
        v.label || (legacy ? "старое видео" : "по ссылке"),
        mb(v.bytes),
        v.hasAudio === false ? "без звука" : "со звуком"
      ].filter(function (x) { return x; }).join(" · ");

      return '<div class="ph vd">' +
        preview +
        '<span class="ph-badge">' + esc(meta) + '</span>' +
        '<div class="ph-btns">' +
          '<button type="button" data-vd="left" data-i="' + i + '" title="Левее">←</button>' +
          '<button type="button" data-vd="right" data-i="' + i + '" title="Правее">→</button>' +
          '<button type="button" data-vd="del" data-i="' + i + '" title="Удалить">✕</button>' +
        "</div>" +
      "</div>";
    }).join("");
  }

  $("#fVideos").addEventListener("click", function (e) {
    var btn = e.target.closest("button[data-vd]");
    if (!btn || !draft) return;
    var i = Number(btn.getAttribute("data-i"));
    var act = btn.getAttribute("data-vd");

    if (act === "left" && i > 0) {
      draft.videos.splice(i - 1, 0, draft.videos.splice(i, 1)[0]);
    } else if (act === "right" && i < draft.videos.length - 1) {
      draft.videos.splice(i + 1, 0, draft.videos.splice(i, 1)[0]);
    } else if (act === "del") {
      draft.videos.splice(i, 1);
    }
    renderVideos();
  });

  var videoBusy = false;

  $("#videoFile").addEventListener("change", function () {
    var file = (this.files || [])[0];
    this.value = "";
    if (!file || !draft) return;
    if (!/^video\//.test(file.type)) { toast("Это не видеофайл"); return; }
    if (videoBusy) { toast("Дождитесь загрузки предыдущего ролика"); return; }

    var lim = FreyaApi.limits();
    if (file.size > lim.uploadVideoMb * 1024 * 1024) {
      toast("Ролик тяжелее " + lim.uploadVideoMb + " МБ — снимите короче");
      return;
    }

    var wantSound = $("#videoSound") ? $("#videoSound").checked : true;
    videoBusy = true;
    toast("Отправляю ролик на сервер…");

    FreyaApi.uploadVideo(file, draft.id || "common", wantSound, function (percent) {
      toast(percent < 100
        ? "Отправляю ролик — " + percent + "%"
        : "Сервер пережимает видео в 1080p…");
    }, function (res) {
      videoBusy = false;
      if (!res.ok || !res.data || !res.data.src) {
        toast(res.error || "Не удалось добавить видео");
        return;
      }
      var info = res.data;
      draft.videos.push({
        src: info.src,
        poster: info.poster || "",
        bytes: info.bytes || 0,
        label: info.label || "1080p",
        hasAudio: info.hasAudio !== false
      });
      renderVideos();
      toast("Видео " + (info.label || "1080p") +
        " · " + Math.round(info.duration || 0) + " сек" +
        (info.bytes ? " · " + mb(info.bytes) : "") +
        (info.trimmed ? " · обрезано до " + lim.video.maxSeconds + " сек" : "") +
        " — не забудьте «Сохранить»");
    });
  });

  $("#videoUrlAdd").addEventListener("click", function () {
    var url = $("#videoUrl").value.trim();
    if (!url || !draft) return;
    draft.videos.push({ src: url, poster: "" });
    $("#videoUrl").value = "";
    renderVideos();
    toast("Видео по ссылке добавлено");
  });

  /* ---------------------------- Оттенки ---------------------------- */

  function renderColors() {
    $("#fColors").innerHTML = draft.colors.map(function (c, i) {
      return '<span class="sw">' +
        '<input type="color" value="' + esc(c) + '" data-i="' + i + '" aria-label="Оттенок ' + (i + 1) + '">' +
        '<button class="sw-x" type="button" data-del="' + i + '" aria-label="Удалить оттенок">✕</button>' +
      "</span>";
    }).join("");
  }

  $("#fColors").addEventListener("input", function (e) {
    var input = e.target.closest('input[type="color"]');
    if (!input || !draft) return;
    draft.colors[Number(input.getAttribute("data-i"))] = input.value;
  });

  $("#fColors").addEventListener("click", function (e) {
    var btn = e.target.closest("button[data-del]");
    if (!btn || !draft) return;
    if (draft.colors.length === 1) { toast("Нужен хотя бы один оттенок"); return; }
    draft.colors.splice(Number(btn.getAttribute("data-del")), 1);
    renderColors();
  });

  $("#addColor").addEventListener("click", function () {
    if (!draft) return;
    draft.colors.push("#C0A275");
    renderColors();
  });

  /* ---------------------------- Размеры ---------------------------- */

  function renderSizes() {
    var all = STD_SIZES.slice();
    draft.sizes.forEach(function (s) { if (all.indexOf(s) === -1) all.push(s); });
    $("#fSizes").innerHTML = all.map(function (s) {
      return '<button class="sz' + (draft.sizes.indexOf(s) > -1 ? " is-on" : "") + '" type="button" data-size="' + esc(s) + '">' + esc(s) + "</button>";
    }).join("");
  }

  $("#fSizes").addEventListener("click", function (e) {
    var btn = e.target.closest("button[data-size]");
    if (!btn || !draft) return;
    var size = btn.getAttribute("data-size");
    var at = draft.sizes.indexOf(size);
    if (at > -1) draft.sizes.splice(at, 1);
    else draft.sizes.push(size);
    renderSizes();
  });

  $("#addSize").addEventListener("click", function () {
    var value = $("#newSize").value.trim();
    if (!value || !draft) return;
    if (draft.sizes.indexOf(value) === -1) draft.sizes.push(value);
    $("#newSize").value = "";
    renderSizes();
  });

  /* ---------------------------- Сохранение товара ---------------------------- */

  $("#eCancel").addEventListener("click", closeEditor);

  $("#eSave").addEventListener("click", function () {
    var name = $("#fName").value.trim();
    if (!name) { toast("Впишите название товара"); $("#fName").focus(); return; }

    var priceValue = Number($("#fPrice").value);
    if (!isFinite(priceValue) || priceValue < 0) { toast("Проверьте цену"); $("#fPrice").focus(); return; }

    var oldValue = $("#fOldPrice").value.trim() === "" ? null : Number($("#fOldPrice").value);
    if (oldValue !== null && (!isFinite(oldValue) || oldValue <= priceValue)) {
      toast("Цена до скидки должна быть больше текущей");
      $("#fOldPrice").focus();
      return;
    }
    if (!draft.sizes.length) { toast("Выберите хотя бы один размер"); return; }

    draft.name = name;
    draft.price = Math.round(priceValue);
    draft.oldPrice = oldValue === null ? null : Math.round(oldValue);
    draft.category = $("#fCategory").value;
    draft.isNew = $("#fNew").checked;
    draft.isSale = $("#fSale").checked;
    draft.isActive = $("#fActive").checked;
    draft.color = $("#fColor").value.trim();
    draft.description = $("#fDesc").value.trim();
    draft.composition = $("#fComp").value.split("\n").map(function (row) {
      return row.trim();
    }).filter(function (row) { return row.length > 0; });

    var isNewProduct = draftIndex < 0;
    var savedIndex = draftIndex;
    var body = FreyaData.clone(draft);

    var ok = mutate(function () {
      if (!body.id) {
        var taken = data.products.map(function (p) { return p.id; });
        body.id = FreyaData.uniqueId(FreyaData.slugify(body.name) || "tovar", taken);
      }
      if (isNewProduct) data.products.push(body);
      else data.products[savedIndex] = body;
    }, isNewProduct ? "Товар добавлен" : "Товар сохранён");

    if (ok) closeEditor();
  });

  $("#eDelete").addEventListener("click", function () {
    if (draftIndex < 0) return;
    if (!confirm("Удалить товар «" + data.products[draftIndex].name + "»?")) return;
    var index = draftIndex;
    if (mutate(function () { data.products.splice(index, 1); }, "Товар удалён")) closeEditor();
  });

  /* ============================== КАТЕГОРИИ ============================== */

  function iconOptions(selected) {
    return FreyaData.ICON_NAMES.map(function (item) {
      return '<option value="' + item.value + '"' + (item.value === selected ? " selected" : "") + ">" + esc(item.label) + "</option>";
    }).join("");
  }

  function countInCategory(slug) {
    return data.products.filter(function (p) { return p.category === slug; }).length;
  }

  function renderCats() {
    $("#newCatIcon").innerHTML = iconOptions("hanger");

    $("#cList").innerHTML = data.categories.map(function (c, i) {
      var count = countInCategory(c.slug);
      var confirmBlock = "";

      if (pendingCatDelete === c.slug) {
        var others = data.categories.filter(function (x) { return x.slug !== c.slug; });
        confirmBlock = '<div class="c-confirm">' +
          "<p>В категории " + count + " " + plural(count, "товар", "товара", "товаров") + ". Куда их перенести?</p>" +
          '<select class="input c-move">' + others.map(function (x) {
            return '<option value="' + esc(x.slug) + '">' + esc(x.title) + "</option>";
          }).join("") + "</select>" +
          '<div class="c-actions" style="margin-top:8px">' +
            '<button class="p-btn p-btn--del" type="button" data-act="del-confirm">Перенести и удалить</button>' +
            '<button class="p-btn" type="button" data-act="del-cancel">Отмена</button>' +
          "</div>" +
        "</div>";
      }

      return '<div class="c-row" data-slug="' + esc(c.slug) + '">' +
        '<div class="c-head">' +
          '<span class="c-icon"><svg viewBox="0 0 24 24" aria-hidden="true">' + FreyaData.icon(c.icon) + "</svg></span>" +
          '<input class="input c-title" value="' + esc(c.title) + '" aria-label="Название категории">' +
          '<span class="c-count">' + count + "</span>" +
        "</div>" +
        '<div class="c-body">' +
          '<select class="input c-icon-sel" aria-label="Иконка">' + iconOptions(c.icon) + "</select>" +
          '<div class="c-actions">' +
            '<button class="p-btn" type="button" data-act="up"' + (i === 0 ? " disabled" : "") + ">↑</button>" +
            '<button class="p-btn" type="button" data-act="down"' + (i === data.categories.length - 1 ? " disabled" : "") + ">↓</button>" +
            '<a class="p-btn" href="index.html#/catalog/' + esc(c.slug) + '" target="_blank" rel="noopener">На сайте</a>' +
            '<button class="p-btn p-btn--del" type="button" data-act="del">Удалить</button>' +
          "</div>" +
        "</div>" +
        confirmBlock +
      "</div>";
    }).join("");
  }

  $("#addCat").addEventListener("click", function () {
    var title = $("#newCatTitle").value.trim();
    if (!title) { toast("Впишите название категории"); return; }
    var iconName = $("#newCatIcon").value;
    mutate(function () {
      var taken = data.categories.map(function (c) { return c.slug; }).concat(["all", "new"]);
      data.categories.push({
        slug: FreyaData.uniqueId(FreyaData.slugify(title) || "category", taken),
        title: title,
        icon: iconName
      });
    }, "Категория добавлена");
    $("#newCatTitle").value = "";
  });

  $("#cList").addEventListener("change", function (e) {
    var row = e.target.closest(".c-row");
    if (!row) return;
    var slug = row.getAttribute("data-slug");

    if (e.target.classList.contains("c-title")) {
      var title = e.target.value.trim();
      if (!title) { toast("Название не может быть пустым"); renderCats(); return; }
      mutate(function () {
        data.categories.forEach(function (c) { if (c.slug === slug) c.title = title; });
      }, "Название обновлено");
      return;
    }

    if (e.target.classList.contains("c-icon-sel")) {
      var iconName = e.target.value;
      mutate(function () {
        data.categories.forEach(function (c) { if (c.slug === slug) c.icon = iconName; });
      }, "Иконка обновлена");
    }
  });

  $("#cList").addEventListener("click", function (e) {
    var btn = e.target.closest("button[data-act]");
    if (!btn) return;
    var row = btn.closest(".c-row");
    var slug = row.getAttribute("data-slug");
    var index = -1;
    data.categories.forEach(function (c, i) { if (c.slug === slug) index = i; });
    if (index < 0) return;
    var act = btn.getAttribute("data-act");

    if (act === "up" || act === "down") {
      var to = act === "up" ? index - 1 : index + 1;
      if (to < 0 || to >= data.categories.length) return;
      mutate(function () {
        var moved = data.categories.splice(index, 1)[0];
        data.categories.splice(to, 0, moved);
      }, "Порядок изменён");
      return;
    }

    if (act === "del") {
      var count = countInCategory(slug);
      if (!count) {
        if (data.categories.length === 1) { toast("Нужна хотя бы одна категория"); return; }
        mutate(function () { data.categories.splice(index, 1); }, "Категория удалена");
        return;
      }
      if (data.categories.length === 1) {
        toast("Сначала добавьте другую категорию — товары нельзя оставить без раздела");
        return;
      }
      pendingCatDelete = slug;
      renderCats();
      return;
    }

    if (act === "del-cancel") {
      pendingCatDelete = null;
      renderCats();
      return;
    }

    if (act === "del-confirm") {
      var target = $(".c-move", row).value;
      pendingCatDelete = null;
      mutate(function () {
        data.products.forEach(function (p) { if (p.category === slug) p.category = target; });
        data.categories.splice(index, 1);
      }, "Категория удалена, товары перенесены");
    }
  });

  /* ============================== НАСТРОЙКИ ============================== */

  function renderSettings() {
    $("#sShop").value = data.settings.shopName;
    $("#sBanner").value = data.settings.banner;
    $("#sTag1").value = data.settings.tagline1;
    $("#sTag2").value = data.settings.tagline2;
    $("#passHint").textContent = "Пароль хранится на сервере в виде хеша. Забыли — поменяйте ADMIN_PASSWORD в файле .env и перезапустите сервис.";
  }

  $("#saveSettings").addEventListener("click", function () {
    var shopName = $("#sShop").value.trim();
    if (!shopName) { toast("Название магазина не может быть пустым"); return; }
    var banner = $("#sBanner").value.trim();
    var tag1 = $("#sTag1").value.trim();
    var tag2 = $("#sTag2").value.trim();
    mutate(function () {
      data.settings.shopName = shopName;
      data.settings.banner = banner;
      data.settings.tagline1 = tag1;
      data.settings.tagline2 = tag2;
    }, "Тексты сохранены");
  });

  $("#savePass").addEventListener("click", function () {
    var next = $("#pass1").value.trim();
    var again = $("#pass2").value.trim();
    if (next.length < 6) { toast("Пароль — не короче 6 символов"); return; }
    if (next !== again) { toast("Пароли не совпадают"); return; }

    // текущий пароль спрашиваем отдельно — чтобы его не поменял случайный человек
    var current = prompt("Введите текущий пароль");
    if (current === null) return;

    FreyaApi.changePassword(current, next, function (res) {
      if (!res.ok) { toast(res.error || "Не удалось сменить пароль"); return; }
      $("#pass1").value = "";
      $("#pass2").value = "";
      toast("Пароль изменён");
    });
  });

  /* ============================== ДАННЫЕ ============================== */

  function renderDataTab() {
    var visible = data.products.filter(function (p) { return p.isActive; }).length;
    var news = data.products.filter(function (p) { return p.isNew && p.isActive; }).length;
    var sales = data.products.filter(function (p) { return p.isSale && p.isActive; }).length;
    var photos = data.products.reduce(function (sum, p) { return sum + p.images.length; }, 0);
    var videos = data.products.reduce(function (sum, p) { return sum + (p.videos ? p.videos.length : 0); }, 0);
    var when = data.updatedAt ? new Date(data.updatedAt).toLocaleString("ru-RU") : "правок не было";

    // Место в браузере больше ни на что не влияет: фото и видео лежат в S3,
    // а в каталоге остаются только текст и короткие ключи файлов.
    $("#dStats").innerHTML =
      '<div class="d-row"><span>Категорий</span><b>' + data.categories.length + "</b></div>" +
      '<div class="d-row"><span>Товаров всего</span><b>' + data.products.length + "</b></div>" +
      '<div class="d-row"><span>Из них видны на сайте</span><b>' + visible + "</b></div>" +
      '<div class="d-row"><span>Новинок / по акции</span><b>' + news + " / " + sales + "</b></div>" +
      '<div class="d-row"><span>Фотографий</span><b>' + photos + "</b></div>" +
      '<div class="d-row"><span>Видео</span><b>' + videos + "</b></div>" +
      '<div class="d-row"><span>Последняя правка</span><b>' + esc(when) + "</b></div>" +
      '<div class="d-row" id="dBackups"><span>Резервных копий</span><b>…</b></div>' +
      '<div class="d-row" id="dStorage"><span>Хранилище медиа</span><b>проверяю…</b></div>';

    FreyaApi.stats(function (res) {
      var backupRow = $("#dBackups");
      if (!backupRow || !res.ok || !res.data) return;
      if (backupRow) {
        backupRow.innerHTML = "<span>Резервных копий</span><b>" + (res.data.backups || 0) + "</b>";
      }
    });

    FreyaApi.health(true, function (res) {
      var row = $("#dStorage");
      if (!row || !res.ok || !res.data) return;
      var info = res.data;
      var name = info.storage === "s3" ? "Timeweb S3" : "диск сервера";
      var state = info.storageOk === false
        ? "ошибка: " + (info.storageError || "нет доступа")
        : "работает";
      row.innerHTML = "<span>Хранилище медиа</span><b>" + esc(name + " · " + state) + "</b>";
    });
  }

  /* ============================== Общая отрисовка ============================== */

  function renderAll() {
    renderProducts();
    renderCats();
    renderSettings();
    renderDataTab();
  }

  /* ------------------------------ Старт ------------------------------ */

  // Сначала спрашиваем у сервера адрес хранилища и лимиты,
  // потом проверяем, жив ли сеанс (cookie), и только тогда открываем панель.
  FreyaApi.config(function () {
    FreyaApi.session(function (res) {
      if (res.ok && res.data && res.data.authorized) {
        openAdmin();
        return;
      }
      setTimeout(function () { $("#pass").focus(); }, 200);
    });
  });
})();
