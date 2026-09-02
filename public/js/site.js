(function () {
  var toggle = document.querySelector(".nav-toggle");
  var links = document.getElementById("nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", function () {
      var open = links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    });
    links.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () {
        links.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-label", "Open menu");
      });
    });
  }

  function setOpen(item, open) {
    var q = item.querySelector(".faq-q");
    item.classList.toggle("open", open);
    if (q) q.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function toggleItem(item) {
    var list = item.parentElement;
    var willOpen = !item.classList.contains("open");
    if (list) {
      list.querySelectorAll(".faq-item.open").forEach(function (openItem) {
        if (openItem !== item) setOpen(openItem, false);
      });
    }
    setOpen(item, willOpen);
  }

  document.querySelectorAll(".faq-q").forEach(function (q) {
    var item = q.parentElement;
    if (!item) return;
    q.setAttribute("role", "button");
    q.setAttribute("tabindex", "0");
    q.setAttribute("aria-expanded", item.classList.contains("open") ? "true" : "false");
    q.addEventListener("click", function () {
      toggleItem(item);
    });
    q.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleItem(item);
      }
    });
  });
})();
