// Adds a "home" icon to the mdBook menu bar, linking back to the MarkSpec
// documentation cover page (docs/index.html). Shared by all published books
// via additional-js, the same convention theme/markspec.css uses for
// additional-css — see each book.toml's comment. Do not delete without
// updating every book.toml that references it.
(function () {
  function addHomeLink() {
    // Not scoped by the menu bar's own id: mdBook has renamed it before
    // (plain "menu-bar" -> "mdbook-menu-bar") across versions, while the
    // ".right-buttons" class name has stayed stable — depend on the stable
    // part.
    const rightButtons = document.querySelector(".right-buttons");
    if (!rightButtons || document.getElementById("home-button")) return;

    // path_to_root is declared by mdBook's own inline script (head.hbs) as a
    // page-relative prefix back to the book's root (e.g. "../../" for a
    // chapter two levels deep, "" for the book's own index page). One more
    // "../" escapes the book root to the site root, where docs/index.html
    // (the cover page) is deployed — every published book's build-dir sits
    // exactly one level under _site/ (see ADR-033).
    const root = typeof path_to_root !== "undefined" ? path_to_root : "";

    const link = document.createElement("a");
    link.href = root + "../";
    link.title = "MarkSpec Documentation home";
    link.setAttribute("aria-label", "MarkSpec Documentation home");

    const icon = document.createElement("i");
    icon.id = "home-button";
    icon.className = "fa fa-home";
    link.appendChild(icon);

    rightButtons.insertBefore(link, rightButtons.firstChild);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", addHomeLink);
  } else {
    addHomeLink();
  }
})();
