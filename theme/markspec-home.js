// Adds a "home" icon to the mdBook menu bar, linking back to the MarkSpec
// documentation cover page (docs/index.html). Shared by all published books
// via additional-js, the same convention theme/markspec.css uses for
// additional-css — see each book.toml's comment. Do not delete without
// updating every book.toml that references it.
//
// Font Awesome Free 6.2.0 "house" solid glyph (CC BY 4.0), matching the
// inline-SVG icon markup mdBook's own menu-bar buttons (print/git/edit) use
// in this mdBook version — a bare `<i class="fa fa-home">` renders nothing
// here: this version dropped the icon font in favor of inline SVGs, so
// depending on the old font-icon class silently produces a zero-size,
// invisible element.
const HOME_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512">' +
  '<path d="M575.8 255.5c0 18-15 32.1-32 32.1h-32l.7 160.2c0 2.7-.2 5.4-.5 8.1V472c0 22.1-17.9 40-40 40H456c-1.1 0-2.2 0-3.3-.1c-1.4 .1-2.8 .1-4.2 .1H416 392c-22.1 0-40-17.9-40-40V448 384c0-17.7-14.3-32-32-32H256c-17.7 0-32 14.3-32 32v64 24c0 22.1-17.9 40-40 40H160 128.1c-1.5 0-3-.1-4.5-.2c-1.2 .1-2.4 .2-3.6 .2H104c-22.1 0-40-17.9-40-40V360c0-.9 0-1.9 .1-2.8V287.6H32c-18 0-32-14-32-32.1c0-9 3-17 10-24L266.4 8c7-7 15-8 22-8s15 2 21 7L564.8 231.5c8 7 12 15 11 24z"></path>' +
  "</svg>";

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

    const iconWrapper = document.createElement("span");
    iconWrapper.id = "home-button";
    iconWrapper.className = "fa-svg";
    iconWrapper.innerHTML = HOME_ICON_SVG;
    link.appendChild(iconWrapper);

    rightButtons.insertBefore(link, rightButtons.firstChild);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", addHomeLink);
  } else {
    addHomeLink();
  }
})();
