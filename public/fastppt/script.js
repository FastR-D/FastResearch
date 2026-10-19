(() => {
  "use strict";
  const root = document.documentElement;
  let storedTheme = "light";
  try {
    storedTheme = localStorage.getItem("fastppt-promo-theme") === "dark" ? "dark" : "light";
  } catch (_) {}
  root.dataset.theme = storedTheme;

  const initialize = () => {
    const themeToggle = document.getElementById("theme-toggle");
    const themeLabel = themeToggle.querySelector(".theme-label");
    const themeColor = document.querySelector('meta[name="theme-color"]');
    const applyTheme = (theme) => {
      root.dataset.theme = theme;
      const dark = theme === "dark";
      const label = dark ? "切换到日间模式" : "切换到深色模式";
      themeToggle.setAttribute("aria-pressed", String(dark));
      themeToggle.setAttribute("aria-label", label);
      themeToggle.title = label;
      themeLabel.textContent = dark ? "日间模式" : "深色模式";
      themeColor.content = dark ? "#0b1322" : "#f6f6f9";
    };
    applyTheme(storedTheme);
    themeToggle.addEventListener("click", () => {
      const next = root.dataset.theme === "dark" ? "light" : "dark";
      applyTheme(next);
      try { localStorage.setItem("fastppt-promo-theme", next); } catch (_) {}
    });

    const galleryItems = [...document.querySelectorAll("[data-gallery-item]")];
    const galleries = new Map();
    galleryItems.forEach((item) => {
      const key = item.dataset.gallery;
      if (!galleries.has(key)) galleries.set(key, []);
      galleries.get(key).push(item);
    });
    const dialog = document.getElementById("preview-dialog");
    const image = document.getElementById("preview-image");
    const title = document.getElementById("preview-title");
    const counter = document.getElementById("preview-counter");
    const status = document.getElementById("preview-status");
    const original = document.getElementById("original-image");
    const close = document.getElementById("close-preview");
    let currentIndex = 0;
    let currentSlides = [];
    let imageRequest = 0;
    const openers = new WeakMap();

    const openDialog = (target, source, focusTarget) => {
      if (typeof target.showModal !== "function") return false;
      openers.set(target, source);
      if (!target.open) target.showModal();
      document.body.classList.add("preview-open");
      focusTarget.focus({ preventScroll: true });
      return true;
    };
    const setupDialog = (target, closeButton) => {
      closeButton.addEventListener("click", () => target.close());
      target.addEventListener("close", () => {
        if (!document.querySelector("dialog[open]")) document.body.classList.remove("preview-open");
        openers.get(target)?.focus({ preventScroll: true });
      });
      target.addEventListener("click", (event) => {
        const rect = target.getBoundingClientRect();
        if (event.target === target && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) target.close();
      });
    };
    setupDialog(dialog, close);

    const showSlide = (index) => {
      currentIndex = (index + currentSlides.length) % currentSlides.length;
      const card = currentSlides[currentIndex];
      title.textContent = `${card.dataset.galleryTitle} · ${card.dataset.title}`;
      counter.textContent = `预览 ${currentIndex + 1} / ${currentSlides.length} · 原稿第 ${card.dataset.page} 页`;
      image.alt = `${card.dataset.galleryTitle}：${card.dataset.title}，原稿第 ${card.dataset.page} 页`;
      status.textContent = "正在加载高清预览…";
      image.src = card.href;
      original.href = card.href;
      const request = ++imageRequest;
      image.decode().then(() => {
        if (request === imageRequest) status.textContent = "支持键盘左右方向键切换";
      }).catch(() => {
        if (request === imageRequest) status.textContent = "图片暂未加载，请尝试打开原图";
      });
      const adjacent = new Image();
      adjacent.src = currentSlides[(currentIndex + 1) % currentSlides.length].href;
    };
    const openPreview = (key, index, source) => {
      if (typeof dialog.showModal !== "function") return false;
      currentSlides = galleries.get(key) || [];
      if (!currentSlides.length) return false;
      showSlide(index);
      return openDialog(dialog, source, close);
    };
    galleryItems.forEach((card) => card.addEventListener("click", (event) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const key = card.dataset.gallery;
      if (openPreview(key, galleries.get(key).indexOf(card), card)) event.preventDefault();
    }));
    document.querySelectorAll("[data-open-gallery]").forEach((link) => link.addEventListener("click", (event) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const key = link.dataset.openGallery;
      const index = Math.max(0, (galleries.get(key) || []).findIndex((card) => card.dataset.page === link.dataset.startPage));
      if (openPreview(key, index, link)) event.preventDefault();
    }));
    document.getElementById("previous-slide").addEventListener("click", () => showSlide(currentIndex - 1));
    document.getElementById("next-slide").addEventListener("click", () => showSlide(currentIndex + 1));
    document.addEventListener("keydown", (event) => {
      if (!dialog.open) return;
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        showSlide(currentIndex + (event.key === "ArrowRight" ? 1 : -1));
      }
    });

    const updateComparison = (range, value) => {
      const position = Math.max(0, Math.min(100, Number(value)));
      range.value = String(position);
      range.setAttribute("aria-valuetext", position === 0 ? "完整原版" : position === 100 ? "完整更新版" : `更新版显示 ${position}%，原版显示 ${100 - position}%`);
      range.closest(".image-comparison").style.setProperty("--position", `${position}%`);
    };
    document.querySelectorAll(".comparison-range").forEach((range) => {
      updateComparison(range, range.value);
      range.addEventListener("input", () => updateComparison(range, range.value));
      const moveToPointer = (event) => {
        const rect = range.getBoundingClientRect();
        updateComparison(range, Math.round((event.clientX - rect.left) / rect.width * 100));
      };
      range.addEventListener("pointerdown", (event) => {
        if (!event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        range.setPointerCapture(event.pointerId);
        range.focus({ preventScroll: true });
        moveToPointer(event);
      });
      range.addEventListener("pointermove", (event) => {
        if (range.hasPointerCapture(event.pointerId)) moveToPointer(event);
      });
      range.addEventListener("pointerup", (event) => {
        if (range.hasPointerCapture(event.pointerId)) range.releasePointerCapture(event.pointerId);
      });
    });
    document.querySelectorAll("[data-compare-position]").forEach((button) => {
      button.addEventListener("click", () => {
        const range = button.closest(".comparison-card, #comparison-dialog").querySelector(".comparison-range");
        updateComparison(range, button.dataset.comparePosition);
      });
    });

    const comparisonDialog = document.getElementById("comparison-dialog");
    const comparisonClose = document.getElementById("close-comparison");
    const modalRange = comparisonDialog.querySelector(".comparison-range");
    let activeComparisonCard = null;
    setupDialog(comparisonDialog, comparisonClose);
    comparisonDialog.addEventListener("close", () => {
      if (activeComparisonCard) updateComparison(activeComparisonCard.querySelector(".comparison-range"), modalRange.value);
    });
    document.querySelectorAll("[data-open-comparison]").forEach((button) => {
      button.addEventListener("click", () => {
        const card = button.closest(".comparison-card");
        activeComparisonCard = card;
        document.getElementById("comparison-dialog-title").textContent = card.dataset.title;
        const before = card.querySelector(".comparison-before");
        const after = card.querySelector(".comparison-after img");
        const modalBefore = comparisonDialog.querySelector(".comparison-before");
        const modalAfter = comparisonDialog.querySelector(".comparison-after img");
        modalBefore.src = before.src;
        modalBefore.alt = before.alt;
        modalAfter.src = after.src;
        modalAfter.alt = after.alt;
        modalRange.setAttribute("aria-label", `${card.dataset.title}前后对比，向左查看原版，向右查看更新版`);
        document.getElementById("comparison-before-link").href = before.src;
        document.getElementById("comparison-after-link").href = after.src;
        comparisonDialog.querySelector('[data-compare-position="0"]').textContent = `← 原版 · 第 ${card.dataset.beforePage} 页`;
        comparisonDialog.querySelector('[data-compare-position="100"]').textContent = `更新版 · 第 ${card.dataset.afterPage} 页 →`;
        updateComparison(modalRange, card.querySelector(".comparison-range").value);
        openDialog(comparisonDialog, button, comparisonClose);
      });
    });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
