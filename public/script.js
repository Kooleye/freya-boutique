/* =========================================================================
   Фрейя — клиентская логика
   Разделённые страницы (hash-роутер), галерея, корзина, фильтры,
   сортировка, маска телефона, валидация заказа.
   Зависимостей нет, работает и из file:// (двойной клик по файлу).
   ========================================================================= */
(function () {
  "use strict";

  /* ------------------------------ Данные (data.js) ------------------------------ */
  // Каталог, категории и настройки приходят из FreyaData:
  //   1) localStorage — правки, сохранённые в админке на этом устройстве
  //   2) catalog.json — опубликованный файл в корне сайта
  //   3) заводские значения из data.js
  var DATA = FreyaData.defaults();
  var PRODUCTS = [];      // только товары с галочкой «Показывать на сайте»
  var CATEGORIES = {};    // slug → название (+ служебный ключ all)

  // Начальная корзина — ровно как на макете: 3 позиции, итого 31 700 ₽
  var cart = [
    { id: "dress",  size: "М", color: "Изумрудный", qty: 1 },
    { id: "suit",   size: "S", color: "Бежевый",   qty: 1 },
    { id: "collar", size: "М", color: "Молочный",  qty: 1 }
  ];

  /* ------------------------------ Утилиты ------------------------------ */
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function price(n) {
    // разделитель тысяч — пробел, как на макете: «8 900 ₽»
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "\u2009") + " \u20bd";
  }

  function byId(id) {
    for (var i = 0; i < PRODUCTS.length; i++) if (PRODUCTS[i].id === id) return PRODUCTS[i];
    return null;
  }


  function esc(text) {
    return String(text === null || text === undefined ? "" : text)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // акция: старая цена зачёркнута, новая рядом
  function priceHTML(p) {
    return (p.oldPrice ? '<s class="price-old">' + price(p.oldPrice) + "</s> " : "") + price(p.price);
  }

  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }

  var toastTimer = null;
  function toast(message) {
    var el = $("#toast");
    el.textContent = message;
    el.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("is-visible"); }, 2200);
  }

  // если заглушка picsum не загрузилась (нет сети) — остаётся градиентный фон
  function imgFallback(img) {
    img.addEventListener("error", function () { img.style.visibility = "hidden"; });
    img.addEventListener("load", function () { img.style.visibility = "visible"; });
  }

  /* ------------------------------ Медиа: фото и видео ------------------------------ */

  // Видео работает как «живая картинка»: без звука, по кругу, без кнопок плеера
  function mediaList(p) {
    return FreyaData.mediaList(p);
  }

  function cardThumb(p) {
    // в плитке берём облегчённую версию фото (…thumb.webp) — страница открывается быстрее
    if (p.images.length) return FreyaData.mediaUrl(p.images[0], { thumb: true });
    if (p.videos && p.videos.length) return FreyaData.mediaUrl(p.videos[0].poster || "", { thumb: true });
    return "";
  }

  var videoToken = 0;

  /* Звук. Автозапуск со звуком браузеры блокируют, поэтому на кадре есть одна
     круглая кнопка со значком динамика. Выбор запоминается для всех следующих роликов. */
  var SOUND_KEY = "freya_video_sound";
  var soundOn = false;
  try { soundOn = localStorage.getItem(SOUND_KEY) === "1"; } catch (err) {}

  function saveSound() {
    try { localStorage.setItem(SOUND_KEY, soundOn ? "1" : "0"); } catch (err) {}
  }

  function soundIcon(on) {
    var speaker = '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/>';
    return on
      ? '<svg viewBox="0 0 24 24" aria-hidden="true">' + speaker +
        '<path d="M15.5 9.2c1.1 1.6 1.1 4 0 5.6"/><path d="M18.2 7c2 2.9 2 7.1 0 10"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true">' + speaker +
        '<path d="M16 9.5l5 5"/><path d="M21 9.5l-5 5"/></svg>';
  }

  function paintSoundBtn(btn, item, playing) {
    if (!btn) return;
    // динамик показываем только когда ролик уже играет
    var show = !!item && item.type === "video" && item.hasAudio !== false && playing !== false;
    btn.hidden = !show;
    if (!show) return;
    btn.innerHTML = soundIcon(soundOn);
    btn.setAttribute("aria-label", soundOn ? "Выключить звук" : "Включить звук");
    if (soundOn) btn.classList.add("is-on");
    else btn.classList.remove("is-on");
  }

  function paintSound() {
    var pv = $("#pdpVideo");
    var gv = $("#gVideo");
    paintSoundBtn($("#pdpSound"), pdp.items[pdp.index], !!pv && !pv.hidden);
    paintSoundBtn($("#gSound"), gallery.open ? gallery.items[gallery.index] : null, !!gv && !gv.hidden);
  }

  function toggleSound(e) {
    if (e) e.stopPropagation();
    soundOn = !soundOn;
    saveSound();

    var el = gallery.open ? $("#gVideo") : $("#pdpVideo");
    if (el && !el.hidden) {
      el.muted = !soundOn;
      var started = el.play();
      if (started && started.catch) {
        started.catch(function () {
          el.muted = true;
          soundOn = false;
          saveSound();
          paintSound();
        });
      }
    }
    paintSound();
  }

  $("#pdpSound").addEventListener("click", toggleSound);
  $("#gSound").addEventListener("click", toggleSound);

  // клиент сам решает, смотреть ли ролик: до нажатия видео не загружается
  function handlePlay(scope) {
    var inGallery = scope === "gallery";
    var item = inGallery ? gallery.items[gallery.index] : pdp.items[pdp.index];
    var btn = $(inGallery ? "#gPlay" : "#pdpPlay");
    var img = $(inGallery ? "#gImage" : "#pdpImage");
    var video = $(inGallery ? "#gVideo" : "#pdpVideo");
    if (!item || item.type !== "video") return;

    btn.hidden = true;
    img.hidden = true;
    startVideo(video, item, function (message) {
      // не вышло — возвращаем постер и кнопку, клиент видит причину
      img.hidden = false;
      btn.hidden = false;
      paintSound();
      if (message) toast(message);
    });
    paintSound();
  }

  $("#pdpPlay").addEventListener("click", function (e) {
    e.stopPropagation();
    handlePlay("pdp");
  });
  $("#gPlay").addEventListener("click", function (e) {
    e.stopPropagation();
    handlePlay("gallery");
  });

  function stopVideo(el) {
    if (!el) return;
    videoToken++;                 // отменяем ещё не дошедшую загрузку ролика
    try { el.pause(); } catch (err) {}
    // снимаем источник: иначе браузер держит ролик в памяти и тянет данные впустую
    try {
      el.onerror = null;
      el.removeAttribute("src");
      el.removeAttribute("data-key");
      el.load();
    } catch (err) {}
    el.hidden = true;
  }

  // Ролик грузится только после нажатия на кнопку: до этого на кадре лежит постер,
  // так сайт не тянет видео во всех карточках сам
  function startVideo(el, item, onFail) {
    var token = ++videoToken;
    var failed = false;

    function bail(message) {
      if (failed || token !== videoToken) return;
      failed = true;
      el.onerror = null;
      try { el.pause(); } catch (err) {}
      el.hidden = true;
      if (onFail) onFail(message);
    }

    el.hidden = false;
    if (item.poster) el.setAttribute("poster", FreyaData.mediaUrl(item.poster));
    else el.removeAttribute("poster");

    // ролик может лежать в браузерном хранилище (idb:...) — достаём его оттуда
    FreyaData.resolveVideo(item.src, function (src) {
      if (token !== videoToken) return;
      if (!src) { bail("Ролик не нашёлся в памяти браузера"); return; }

      el.setAttribute("data-key", item.src);
      el.src = src;
      el.loop = true;
      el.controls = false;
      el.playsInline = true;
      el.muted = !soundOn || item.hasAudio === false;

      // формат может быть не по зубам браузеру (WebM в Safari) — говорим об этом прямо
      el.onerror = function () {
        bail("Телефон не открывает формат этого ролика — перезалейте видео в админке");
      };

      function kick() {
        var started;
        try { started = el.play(); } catch (err) {
          bail("Браузер не дал включить видео");
          return;
        }
        if (started && started.catch) {
          started.catch(function () {
            if (failed || token !== videoToken) return;
            if (!el.muted) {
              // браузер не пустил ролик со звуком — играем без звука
              el.muted = true;
              soundOn = false;
              saveSound();
              paintSound();
              kick();
              return;
            }
            bail("Браузер не дал включить видео");
          });
        }
      }

      try { el.load(); } catch (err) {}
      kick();
    });
  }

  function dotHTML(cls, item, active) {
    return '<span class="' + cls + (item.type === "video" ? " " + cls + "--video" : "") +
      (active ? " is-active" : "") + '"></span>';
  }

  /* ------------------------------ Карточка товара ------------------------------ */
  function cardHTML(p) {
    var img = cardThumb(p);
    var badge = p.isSale
      ? '<span class="card-badge card-badge--sale">АКЦИЯ</span>'
      : (p.isNew ? '<span class="card-badge">NEW</span>' : "");
    return '<a class="card" href="#/product/' + p.id + '">' +
      '<span class="card-media">' +
        (img ? '<img src="' + esc(img) + '" alt="' + esc(p.name) + '" loading="lazy">' : "") +
        badge +
      '</span>' +
      '<span class="card-name">' + esc(p.name) + '</span>' +
      '<span class="card-price">' + priceHTML(p) + '</span>' +
    '</a>';
  }

  function renderCards(container, items) {
    container.innerHTML = items.map(cardHTML).join("");
    $$("img", container).forEach(imgFallback);
  }

  /* ------------------------------ Корзина ------------------------------ */
  function cartQty() {
    return cart.reduce(function (s, it) { return s + it.qty; }, 0);
  }

  function cartSum() {
    return cart.reduce(function (s, it) {
      var p = byId(it.id);
      return s + (p ? p.price * it.qty : 0);
    }, 0);
  }

  function renderCart() {
    var qty = cartQty();
    $("#cartCount").textContent = qty;
    $("#cartCount").hidden = qty === 0;
    $("#drawerCartCount").textContent = qty;
    $("#cartTitleCount").textContent = qty;
    $("#cartTotal").textContent = price(cartSum());

    var list = $("#cartList");
    list.innerHTML = cart.map(function (it, index) {
      var p = byId(it.id);
      if (!p) return "";
      return '<div class="cart-item" data-index="' + index + '">' +
        '<a class="ci-media" href="#/product/' + p.id + '">' +
          '<img src="' + esc(cardThumb(p)) + '" alt="' + esc(p.name) + '" loading="lazy">' +
        '</a>' +
        '<div class="ci-body">' +
          '<a class="ci-name" href="#/product/' + p.id + '">' + esc(p.name) + '</a>' +
          '<p class="ci-meta">' + esc(it.color) + ' / ' + esc(it.size) + '</p>' +
          '<p class="ci-price h-serif">' + price(p.price * it.qty) + '</p>' +
          '<div class="stepper">' +
            '<button type="button" data-step="-1" aria-label="Уменьшить">−</button>' +
            '<span>' + it.qty + '</span>' +
            '<button type="button" data-step="1" aria-label="Увеличить">+</button>' +
          '</div>' +
        '</div>' +
        '<button class="ci-remove" type="button" aria-label="Удалить">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13"/></svg>' +
        '</button>' +
      '</div>';
    }).join("");
    $$("img", list).forEach(imgFallback);

    var empty = cart.length === 0;
    $("#cartEmpty").hidden = !empty;
    $("#cartTotalRow").hidden = empty;
    $("#cartCheckout").hidden = empty;
  }

  function addToCart(id, size, color) {
    var p = byId(id);
    if (!p) return;
    var s = size || "M";
    var c = color || p.color;
    var found = null;
    for (var i = 0; i < cart.length; i++) {
      if (cart[i].id === id && cart[i].size === s) { found = cart[i]; break; }
    }
    if (found) found.qty += 1;
    else cart.push({ id: id, size: s, color: c, qty: 1 });
    renderCart();
    toast("Товар добавлен в корзину");
  }

  $("#cartList").addEventListener("click", function (e) {
    var row = e.target.closest(".cart-item");
    if (!row) return;
    var index = Number(row.getAttribute("data-index"));
    var stepBtn = e.target.closest("[data-step]");
    if (stepBtn) {
      var step = Number(stepBtn.getAttribute("data-step"));
      cart[index].qty += step;
      if (cart[index].qty < 1) cart.splice(index, 1);
      renderCart();
      return;
    }
    if (e.target.closest(".ci-remove")) {
      cart.splice(index, 1);
      renderCart();
      toast("Товар удалён из корзины");
    }
  });

  /* ------------------------------ Галерея ------------------------------ */
  var gallery = { items: [], index: 0, open: false, name: "" };

  function renderGalleryDots() {
    $("#gDots").innerHTML = gallery.items.map(function (item, i) {
      return dotHTML("g-dot", item, i === gallery.index);
    }).join("");
  }

  function showGalleryMedia() {
    var img = $("#gImage");
    var video = $("#gVideo");
    var item = gallery.items[gallery.index];
    if (!item) return;

    if (item.type === "video") {
      // до нажатия показываем только кадр-постер, сам ролик не грузится
      stopVideo(video);
      $("#gPlay").hidden = false;
      img.hidden = false;
      if (item.poster) img.src = FreyaData.mediaUrl(item.poster);
      else img.removeAttribute("src");
      img.alt = gallery.name + " — видео";
    } else {
      stopVideo(video);
      $("#gPlay").hidden = true;
      img.hidden = false;
      img.src = FreyaData.mediaUrl(item.src);
      img.alt = gallery.name + " — фото " + (gallery.index + 1);
    }
    paintSoundBtn($("#gSound"), item, !video.hidden);
    renderGalleryDots();
  }

  function openGallery(id, startIndex) {
    var p = byId(id);
    if (!p) return;
    var items = mediaList(p);
    if (!items.length) return;
    gallery.items = items;
    gallery.index = startIndex ? Math.min(startIndex, items.length - 1) : 0;
    stopVideo($("#pdpVideo"));      // в галерее играет своё видео
    gallery.open = true;
    gallery.name = p.name;
    $("#gallery").hidden = false;
    document.body.classList.add("is-locked");
    showGalleryMedia();
    $("#gClose").focus();
  }

  function closeGallery() {
    gallery.open = false;
    stopVideo($("#gVideo"));
    $("#gPlay").hidden = true;
    if (document.body.classList.contains("is-pdp")) showPdpMedia();
    $("#gallery").hidden = true;
    document.body.classList.remove("is-locked");
  }

  function slide(delta) {
    if (!gallery.items.length) return;
    gallery.index = (gallery.index + delta + gallery.items.length) % gallery.items.length;
    showGalleryMedia();
  }

  $("#gClose").addEventListener("click", closeGallery);
  $("#gPrev").addEventListener("click", function () { slide(-1); });
  $("#gNext").addEventListener("click", function () { slide(1); });
  $("#gallery").addEventListener("click", function (e) {
    if (e.target === e.currentTarget) closeGallery();
  });
  $("#gDots").addEventListener("click", function (e) {
    var dots = $$(".g-dot", e.currentTarget);
    var i = dots.indexOf(e.target);
    if (i > -1) { gallery.index = i; showGalleryMedia(); }
  });

  // свайп
  var touchX = 0, touchY = 0, swiping = false;
  var stage = $("#gStage");
  stage.addEventListener("touchstart", function (e) {
    if (e.touches.length !== 1) return;
    touchX = e.touches[0].clientX;
    touchY = e.touches[0].clientY;
    swiping = true;
  }, { passive: true });
  stage.addEventListener("touchend", function (e) {
    if (!swiping) return;
    swiping = false;
    var dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 40) slide(dx < 0 ? 1 : -1);
  });

  /* ------------------------------ Боковое меню ------------------------------ */
  function openDrawer() {
    $("#drawerOverlay").hidden = false;
    document.body.classList.add("is-locked");
    $("#menuBtn").setAttribute("aria-expanded", "true");
    requestAnimationFrame(function () { $("#drawerOverlay").classList.add("is-open"); });
  }
  function closeDrawer() {
    var overlay = $("#drawerOverlay");
    overlay.classList.remove("is-open");
    $("#menuBtn").setAttribute("aria-expanded", "false");
    document.body.classList.remove("is-locked");
    setTimeout(function () { overlay.hidden = true; }, 200);
  }
  $("#menuBtn").addEventListener("click", openDrawer);
  $("#drawerClose").addEventListener("click", closeDrawer);
  $("#drawerOverlay").addEventListener("click", function (e) {
    if (e.target === e.currentTarget) closeDrawer();
  });
  $$("#drawerOverlay a").forEach(function (a) {
    a.addEventListener("click", closeDrawer);
  });

  /* ------------------------------ Фильтры и сортировка ------------------------------ */
  function openFilters() {
    $("#filtersOverlay").hidden = false;
    document.body.classList.add("is-locked");
  }
  function closeFilters() {
    $("#filtersOverlay").hidden = true;
    document.body.classList.remove("is-locked");
  }
  $("#filtersBtn").addEventListener("click", openFilters);
  $("#filtersClose").addEventListener("click", closeFilters);
  $("#filtersOverlay").addEventListener("click", function (e) {
    if (e.target === e.currentTarget) closeFilters();
  });
  $("#filtersApply").addEventListener("click", function () {
    var picked = $$("#filtersOverlay input[type=checkbox]:checked").length;
    closeFilters();
    toast(picked ? "Фильтры применены: " + picked : "Фильтры сброшены");
  });

  var sortMode = "popular";
  $("#sortBtn").addEventListener("click", function () {
    var menu = $("#sortMenu");
    var open = menu.hidden;
    menu.hidden = !open;
    $("#sortBtn").setAttribute("aria-expanded", String(open));
  });
  $("#sortMenu").addEventListener("click", function (e) {
    var li = e.target.closest("li");
    if (!li) return;
    $$("li", e.currentTarget).forEach(function (x) { x.setAttribute("aria-selected", "false"); });
    li.setAttribute("aria-selected", "true");
    sortMode = li.getAttribute("data-sort");
    $("#sortLabel").textContent = li.textContent;
    $("#sortMenu").hidden = true;
    $("#sortBtn").setAttribute("aria-expanded", "false");
    renderCatalog(currentCategory);
  });
  document.addEventListener("click", function (e) {
    if (!e.target.closest(".tb-sort-wrap") && !$("#sortMenu").hidden) {
      $("#sortMenu").hidden = true;
      $("#sortBtn").setAttribute("aria-expanded", "false");
    }
  });

  /* ------------------------------ Рендер страниц ------------------------------ */
  var currentCategory = "all";

  function renderCatalog(cat) {
    currentCategory = CATEGORIES[cat] ? cat : "all";
    var items = PRODUCTS.filter(function (p) {
      return currentCategory === "all" || p.category === currentCategory;
    });

    if (sortMode === "asc") items.sort(function (a, b) { return a.price - b.price; });
    if (sortMode === "desc") items.sort(function (a, b) { return b.price - a.price; });
    if (sortMode === "new") items.sort(function (a, b) { return (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0); });

    $("#catalogTitle").textContent = CATEGORIES[currentCategory];
    $$("#catalogTabs .tab").forEach(function (t) {
      t.classList.toggle("is-active", t.getAttribute("data-cat") === currentCategory);
    });

    renderCards($("#catalogGrid"), items);
    $("#catalogEmpty").hidden = items.length > 0;
  }

  var pdp = { items: [], index: 0, name: "" };

  function showPdpMedia() {
    var img = $("#pdpImage");
    var video = $("#pdpVideo");
    var total = pdp.items.length;
    var many = total > 1;

    // стрелки, точки и счётчик нужны только когда кадров несколько
    $("#pdpPrev").hidden = !many;
    $("#pdpNext").hidden = !many;
    $("#pdpCounter").hidden = !many;
    $("#pdpDots").hidden = !many;
    $(".pdp-hero-hint").hidden = total === 0;

    if (!total) {
      stopVideo(video);
      $("#pdpSound").hidden = true;
      $("#pdpPlay").hidden = true;
      img.hidden = false;
      img.removeAttribute("src");
      img.alt = "";
      $("#pdpDots").innerHTML = "";
      return;
    }

    var item = pdp.items[pdp.index];
    if (item.type === "video") {
      // до нажатия показываем только кадр-постер, сам ролик не грузится
      stopVideo(video);
      $("#pdpPlay").hidden = false;
      img.hidden = false;
      if (item.poster) img.src = FreyaData.mediaUrl(item.poster);
      else img.removeAttribute("src");
      img.alt = pdp.name + " — видео";
    } else {
      stopVideo(video);
      $("#pdpPlay").hidden = true;
      img.hidden = false;
      img.src = FreyaData.mediaUrl(item.src);
      img.alt = pdp.name + " — фото " + (pdp.index + 1);
    }

    $(".pdp-hero-hint").textContent = item.type === "video" ? "Видео товара" : "Нажмите на фото";
    paintSoundBtn($("#pdpSound"), item, !video.hidden);
    $("#pdpCounter").textContent = (pdp.index + 1) + " / " + total;
    $("#pdpDots").innerHTML = pdp.items.map(function (it, i) {
      return dotHTML("hero-dot", it, i === pdp.index);
    }).join("");
  }

  // листание фото без открытия галереи (стрелки, точки, свайп)
  function pdpSlide(delta) {
    if (!pdp.items.length) return;
    pdp.index = (pdp.index + delta + pdp.items.length) % pdp.items.length;
    showPdpMedia();
  }

  function renderProduct(id) {
    if (!PRODUCTS.length) return;
    var p = byId(id) || PRODUCTS[0];

    pdp.items = mediaList(p);
    pdp.index = 0;
    pdp.name = p.name;
    showPdpMedia();

    $("#pdpTitle").textContent = p.name;
    $("#pdpPrice").innerHTML = priceHTML(p);
    $("#colorName").textContent = p.color;

    // размеры задаются в админке для каждого товара
    $("#sizes").innerHTML = p.sizes.map(function (size, i) {
      return '<button class="size' + (i === 0 ? " is-active" : "") + '" type="button">' + esc(size) + '</button>';
    }).join("");

    $("#pdpDescription").textContent = p.description;
    $("#pdpDescription").closest(".acc").hidden = !p.description;

    $("#pdpComposition").innerHTML = p.composition.map(function (row) {
      return "<li>" + esc(row) + "</li>";
    }).join("");
    $("#pdpComposition").closest(".acc").hidden = !p.composition.length;

    $("#swatches").innerHTML = p.colors.map(function (c, i) {
      return '<button class="swatch' + (i === 0 ? " is-active" : "") + '" type="button" style="--sw:' + esc(c) + '" aria-label="Цвет ' + (i + 1) + '"></button>';
    }).join("");

    $("#pdpHero").setAttribute("data-id", p.id);
    $("#pdpAdd").setAttribute("data-id", p.id);

    var related = PRODUCTS.filter(function (x) { return x.id !== p.id; }).slice(0, 2);
    renderCards($("#pdpRelated"), related);
  }

  $("#pdpHero").addEventListener("click", function (e) {
    if (e.target.closest(".pdp-hero-bar")) return;
    if (e.target.closest(".play-btn")) return;
    if (e.target.closest(".hero-arrow") || e.target.closest(".hero-dots")) return;
    if (heroSwiped) { heroSwiped = false; return; }
    openGallery(this.getAttribute("data-id"), pdp.index);
  });
  $("#pdpHero").addEventListener("keydown", function (e) {
    if (e.key === "ArrowLeft")  { e.preventDefault(); pdpSlide(-1); return; }
    if (e.key === "ArrowRight") { e.preventDefault(); pdpSlide(1);  return; }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openGallery(this.getAttribute("data-id"), pdp.index);
    }
  });

  $("#pdpPrev").addEventListener("click", function (e) { e.stopPropagation(); pdpSlide(-1); });
  $("#pdpNext").addEventListener("click", function (e) { e.stopPropagation(); pdpSlide(1); });
  $("#pdpDots").addEventListener("click", function (e) {
    e.stopPropagation();
    var dots = $$(".hero-dot", e.currentTarget);
    var i = dots.indexOf(e.target);
    if (i > -1) { pdp.index = i; showPdpMedia(); }
  });

  // свайп по фото в карточке (без анимации перелистывания)
  var heroX = 0, heroY = 0, heroTouch = false, heroSwiped = false;
  var hero = $("#pdpHero");
  hero.addEventListener("touchstart", function (e) {
    if (e.touches.length !== 1) return;
    heroX = e.touches[0].clientX;
    heroY = e.touches[0].clientY;
    heroTouch = true;
  }, { passive: true });
  hero.addEventListener("touchend", function (e) {
    if (!heroTouch) return;
    heroTouch = false;
    var dx = e.changedTouches[0].clientX - heroX;
    var dy = e.changedTouches[0].clientY - heroY;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
      heroSwiped = true;                 // свайп листает, но не открывает галерею
      pdpSlide(dx < 0 ? 1 : -1);
    }
  });

  // «Назад» — возврат туда, откуда пришли (история навигации)
  $("#pdpBack").addEventListener("click", function () {
    if (routeSteps > 1) history.back();
    else location.hash = "#/";          // прямой вход по ссылке — на главную
  });
  $("#sizes").addEventListener("click", function (e) {
    var b = e.target.closest(".size");
    if (!b) return;
    $$(".size", this).forEach(function (x) { x.classList.remove("is-active"); });
    b.classList.add("is-active");
  });
  $("#swatches").addEventListener("click", function (e) {
    var b = e.target.closest(".swatch");
    if (!b) return;
    $$(".swatch", this).forEach(function (x) { x.classList.remove("is-active"); });
    b.classList.add("is-active");
  });
  $$(".sizes--sheet").forEach(function (box) {
    box.addEventListener("click", function (e) {
      var b = e.target.closest(".size");
      if (!b) return;
      $$(".size", box).forEach(function (x) { x.classList.remove("is-active"); });
      b.classList.add("is-active");
    });
  });

  $("#pdpAdd").addEventListener("click", function () {
    var active = $("#sizes .size.is-active");
    addToCart(this.getAttribute("data-id"), active ? active.textContent : "M", $("#colorName").textContent);
    location.hash = "#/cart";          // сразу переходим в корзину
  });

  /* ------------------------------ Оформление заказа ------------------------------ */
  var lastOrder = null;

  /* Маска с макета: +7 (999) 999-9999 */
  function maskPhone(digits) {
    var d = String(digits).replace(/\D/g, "");
    if (d.charAt(0) === "8" || d.charAt(0) === "7") d = d.slice(1);
    d = d.slice(0, 10);
    var out = "+7";
    if (d.length) out += " (" + d.slice(0, 3);
    if (d.length >= 3) out += ")";
    if (d.length > 3) out += " " + d.slice(3, 6);
    if (d.length > 6) out += "-" + d.slice(6, 10);
    return out;
  }

  function phoneDigits() {
    var d = $("#orderPhone").value.replace(/\D/g, "");
    if (d.charAt(0) === "7" || d.charAt(0) === "8") d = d.slice(1);
    return d;
  }

  function renderCheckout() {
    $("#orderCount").textContent = cartQty();
    $("#orderTotal").textContent = price(cartSum());
  }

  function renderDone() {
    var el = $("#doneText");
    if (!lastOrder) {
      el.textContent = "Мы перезвоним для подтверждения заказа.";
      return;
    }
    el.textContent = lastOrder.name + ", спасибо за заказ на " + price(lastOrder.sum) +
      ". Мы перезвоним на " + lastOrder.phone + " для подтверждения.";
  }

  $("#orderPhone").addEventListener("input", function (e) {
    var d = this.value.replace(/\D/g, "");
    var del = e && e.inputType && e.inputType.indexOf("delete") === 0;
    // при стирании разделителя убираем цифру, а не возвращаем скобку
    if (del && this.value && !/\d$/.test(this.value)) d = d.slice(0, -1);
    this.value = d ? maskPhone(d) : "";
    this.classList.remove("is-invalid");
  });

  $("#orderPhone").addEventListener("focus", function () {
    if (!this.value) this.value = "+7 (";
  });

  $("#orderName").addEventListener("input", function () {
    this.classList.remove("is-invalid");
  });

  $("#orderForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var nameEl = $("#orderName");
    var phoneEl = $("#orderPhone");
    var bad = null;

    if (!nameEl.value.trim()) { nameEl.classList.add("is-invalid"); bad = nameEl; }
    else nameEl.classList.remove("is-invalid");

    if (phoneDigits().length < 10) {
      phoneEl.classList.add("is-invalid");
      if (!bad) bad = phoneEl;
    } else phoneEl.classList.remove("is-invalid");

    if (bad) {
      toast(bad === nameEl ? "Укажите имя" : "Укажите телефон полностью");
      bad.focus();
      return;
    }
    if (!$("#orderAgree").checked) {
      toast("Нужно согласие на обработку данных");
      return;
    }
    if (!cart.length) {
      toast("Корзина пуста");
      location.hash = "#/cart";
      return;
    }

    lastOrder = { name: nameEl.value.trim(), phone: phoneEl.value, sum: cartSum() };
    cart = [];
    renderCart();
    nameEl.value = "";
    phoneEl.value = "";
    location.hash = "#/done";
  });

  /* --------------- Запрет приближения (double-tap и pinch) --------------- */
  var lastTap = { time: 0, x: 0, y: 0 };
  var tapStart = { x: 0, y: 0, moved: false };

  document.addEventListener("touchstart", function (e) {
    var t = e.touches[0];
    if (!t) return;
    tapStart.x = t.clientX;
    tapStart.y = t.clientY;
    tapStart.moved = false;
  }, { passive: true });

  document.addEventListener("touchmove", function (e) {
    var t = e.touches[0];
    if (!t) return;
    if (Math.abs(t.clientX - tapStart.x) > 10 || Math.abs(t.clientY - tapStart.y) > 10) tapStart.moved = true;
  }, { passive: true });

  /* Гасим только двойной тап в одну и ту же точку. Если палец двигался (прокрутка),
     ничего не отменяем — иначе браузер рвёт инерцию и экран дрожит. */
  document.addEventListener("touchend", function (e) {
    var t = e.changedTouches[0];
    if (!t) return;
    if (tapStart.moved) { lastTap.time = 0; return; }
    var now = Date.now();
    var quick = now - lastTap.time < 320;
    var near = Math.abs(t.clientX - lastTap.x) < 30 && Math.abs(t.clientY - lastTap.y) < 30;
    if (quick && near) e.preventDefault();              // второй быстрый тап — без zoom
    lastTap.time = now;
    lastTap.x = t.clientX;
    lastTap.y = t.clientY;
  }, { passive: false });
  document.addEventListener("dblclick", function (e) { e.preventDefault(); }, { passive: false });
  document.addEventListener("gesturestart", function (e) { e.preventDefault(); });
  document.addEventListener("gesturechange", function (e) { e.preventDefault(); });

  /* ------------------------------ Роутер ------------------------------ */
  var VIEWS = {
    home: "#view-home",
    catalog: "#view-catalog",
    product: "#view-product",
    cart: "#view-cart",
    checkout: "#view-checkout",
    done: "#view-done",
    shops: "#view-shops",
    personal: "#view-personal",
    details: "#view-details",
    contacts: "#view-contacts",
    policy: "#view-policy"
  };

  var routeSteps = 0;

  function route() {
    routeSteps++;
    if (gallery.open) closeGallery();
    stopVideo($("#pdpVideo"));       // видео не играет в фоне при переходах

    var hash = location.hash.replace(/^#\/?/, "");
    var parts = hash.split("/").filter(Boolean);
    var name = parts[0] || "home";
    if (!VIEWS[name]) name = "home";

    if (name === "catalog") renderCatalog(parts[1] || "all");
    if (name === "product") renderProduct(parts[1]);
    if (name === "cart") renderCart();
    if (name === "checkout") {
      if (!cart.length) { location.replace("#/cart"); return; }   // пустую корзину оформлять нечего
      renderCheckout();
    }
    if (name === "done") renderDone();

    Object.keys(VIEWS).forEach(function (key) {
      $(VIEWS[key]).hidden = key !== name;
    });

    // на карточке товара шапка скрыта — как на макете (фото во всю ширину)
    document.body.classList.toggle("is-pdp", name === "product");
    document.body.classList.toggle("is-info", ["shops", "personal", "details", "contacts", "policy"].indexOf(name) !== -1);
    window.scrollTo(0, 0);
  }

  window.addEventListener("hashchange", route);
  var footerYear = $("#footerYear");
  if (footerYear) footerYear.textContent = new Date().getFullYear();

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (gallery.open) closeGallery();
      else if (!$("#filtersOverlay").hidden) closeFilters();
      else if (!$("#drawerOverlay").hidden) closeDrawer();
    }
    if (!gallery.open) {
      if (document.body.classList.contains("is-pdp")) {
        if (e.key === "ArrowLeft") pdpSlide(-1);
        if (e.key === "ArrowRight") pdpSlide(1);
      }
      return;
    }
    if (e.key === "ArrowLeft") slide(-1);
    if (e.key === "ArrowRight") slide(1);
  });

  /* --------------- Сборка интерфейса из данных админки --------------- */

  // Новинки: показываем только товары, отмеченные галочкой «Новинка» в админке
  function newProducts() {
    return PRODUCTS.filter(function (p) { return p.isNew; });
  }

  function renderCategoryNav() {
    var html = '<a class="cat cat--all" href="#/catalog/all">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true">' + FreyaData.icon("grid") + '</svg><span>Весь каталог</span></a>';
    html += DATA.categories.map(function (c) {
      return '<a class="cat" href="#/catalog/' + c.slug + '">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true">' + FreyaData.icon(c.icon) + '</svg>' +
        '<span>' + esc(c.title) + '</span></a>';
    }).join("");
    $("#catsNav").innerHTML = html;
  }

  function renderCatalogTabs() {
    var html = '<a class="tab" href="#/catalog/all" data-cat="all">Все</a>';
    html += DATA.categories.map(function (c) {
      return '<a class="tab" href="#/catalog/' + c.slug + '" data-cat="' + c.slug + '">' + esc(c.title) + '</a>';
    }).join("");
    $("#catalogTabs").innerHTML = html;
  }

  function renderDrawer() {
    var rows = [
      { href: "#/catalog/all", title: "Весь каталог", count: PRODUCTS.length },
      { href: "#/", title: "Новинки", count: newProducts().length }
    ];
    DATA.categories.forEach(function (c) {
      rows.push({
        href: "#/catalog/" + c.slug,
        title: c.title,
        count: PRODUCTS.filter(function (p) { return p.category === c.slug; }).length
      });
    });
    $("#drawerList").innerHTML = rows.map(function (r) {
      return '<li><a href="' + r.href + '">' + esc(r.title) + '<i>' + (r.count ? r.count : "") + '</i></a></li>';
    }).join("");
    $$("#drawerList a").forEach(function (a) { a.addEventListener("click", closeDrawer); });
  }

  function renderFilters() {
    $("#filtersCats").innerHTML = DATA.categories.map(function (c) {
      return '<label class="check"><input type="checkbox" value="' + c.slug + '"><span>' + esc(c.title) + '</span></label>';
    }).join("");

    var sizes = [];
    PRODUCTS.forEach(function (p) {
      p.sizes.forEach(function (size) { if (sizes.indexOf(size) === -1) sizes.push(size); });
    });
    $("#filtersSizes").innerHTML = sizes.map(function (size) {
      return '<button class="size" type="button">' + esc(size) + '</button>';
    }).join("");
  }

  function applySettings() {
    var s = DATA.settings;
    $(".logo").textContent = s.shopName;
    document.title = s.shopName + " — бутик женской одежды";

    var bar = $(".collection-bar");
    bar.textContent = s.banner;
    bar.hidden = !s.banner;

    var tagline = esc(s.tagline1) + "<br>" + esc(s.tagline2);
    $$(".brand-tagline, .drawer-foot").forEach(function (el) { el.innerHTML = tagline; });
  }

  function applyData(data) {
    DATA = data;
    PRODUCTS = DATA.products.filter(function (p) { return p.isActive !== false; });
    CATEGORIES = { all: "Каталог" };
    DATA.categories.forEach(function (c) { CATEGORIES[c.slug] = c.title; });

    applySettings();
    renderCategoryNav();
    renderCatalogTabs();
    renderDrawer();
    renderFilters();
    renderCards($("#newGrid"), newProducts());

    // товары, удалённые или скрытые в админке, убираются из корзины
    cart = cart.filter(function (it) { return byId(it.id); });
    renderCart();

    route();
  }

  /* ------------------------------ Старт ------------------------------ */
  if (!location.hash) location.replace("#/");

  // если админка открыта в другой вкладке — сайт подхватывает правки сразу
  window.addEventListener("storage", function (e) {
    if (e.key === FreyaData.STORAGE_KEY) FreyaData.load(applyData);
  });

  FreyaData.load(applyData);
})();

