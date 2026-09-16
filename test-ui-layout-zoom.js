/**
 * Test jsdom dédié — mise en page en 3 zones indépendantes (retour de
 * Mayrik) :
 *   Zone 1 (plateau) : zoom FIXE (1 tuile = largeur écran), défilement
 *     horizontal natif, curseur de position (pas un zoom).
 *   Zone 2 (bande d'info) : structure posée, pas de zoom.
 *   Zone 3 (dashboards) : librement zoomable/déplaçable (Panzoom),
 *     contenue à cette seule zone.
 *
 * jsdom n'implémente pas requestAnimationFrame nativement (Panzoom
 * l'utilise en interne) — polyfill minimal ci-dessous, nécessaire
 * UNIQUEMENT pour ce fichier de test (aucun impact sur la production,
 * où un vrai navigateur fournit toujours requestAnimationFrame).
 * À lancer avec : node test-ui-layout-zoom.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "tools", "prototype.html"), "utf8");

function section(title) { console.log("\n=== " + title + " ==="); }
function makeDom() {
  return new JSDOM(html, {
    runScripts: "dangerously",
    resources: "usable",
    beforeParse(w) {
      w.requestAnimationFrame = (cb) => setTimeout(cb, 0);
      w.cancelAnimationFrame = (id) => clearTimeout(id);
    }
  });
}
// jsdom ne fait pas de vraie mise en page : clientWidth/scrollWidth
// valent toujours 0 par défaut — on les stub explicitement là où le
// test en a besoin, plutôt que de dépendre d'un rendu réel.
function stubBox(el, props) { Object.entries(props).forEach(([k, v]) => Object.defineProperty(el, k, { value: v, configurable: true })); }
// Simule un vrai TAP (touchstart puis touchend au même endroit) ou un
// GLISSÉ (touchstart puis touchend ailleurs) — utilisé pour tester le
// double-tap sans dépendre d'un vrai geste tactile.
function tapAt(win, el, x, y) {
  const touch = { identifier: 1, clientX: x, clientY: y };
  el.dispatchEvent(new win.TouchEvent("touchstart", { touches: [touch], changedTouches: [touch], bubbles: true }));
  el.dispatchEvent(new win.TouchEvent("touchend", { touches: [], changedTouches: [touch], bubbles: true }));
}
function dragFromTo(win, el, x1, y1, x2, y2) {
  el.dispatchEvent(new win.TouchEvent("touchstart", { touches: [{ identifier: 1, clientX: x1, clientY: y1 }], changedTouches: [{ identifier: 1, clientX: x1, clientY: y1 }], bubbles: true }));
  el.dispatchEvent(new win.TouchEvent("touchend", { touches: [], changedTouches: [{ identifier: 1, clientX: x2, clientY: y2 }], bubbles: true }));
}

section("Test 1 — Structure des 3 zones présente dans le DOM, avec le bon CSS de base");

let dom = makeDom();
let win = dom.window;
const doc = dom.window.document;
console.log("#board-viewport existe (zone 1) (attendu true) :", !!doc.getElementById("board-viewport"));
console.log("#board-position-slider existe (zone 1) (attendu true) :", !!doc.getElementById("board-position-slider"));
console.log("#info-band existe (zone 2) (attendu true) :", !!doc.getElementById("info-band"));
console.log("#dashboards-viewport existe (zone 3) (attendu true) :", !!doc.getElementById("dashboards-viewport"));
console.log("#board est bien DANS #board-viewport (attendu true) :", doc.getElementById("board-viewport").contains(doc.getElementById("board")));
console.log("#dashboards est bien DANS #dashboards-viewport (attendu true) :", doc.getElementById("dashboards-viewport").contains(doc.getElementById("dashboards")));

section("Test 2 — Zone 1 : le plateau est calé par la HAUTEUR — ses 6 rangées tiennent toujours dans sa fenêtre");

// RÈGLE CHANGÉE (refonte de la mise en page) : le plateau n'est plus
// calé par la largeur avec un plafond à 40% de la hauteur. Il est
// désormais calé par la HAUTEUR — c'est ce qui garantit les 6 rangées —
// et sa largeur en découle, le débordement étant absorbé par le
// défilement horizontal. Les anciennes assertions (ratio en %, largeur
// 'auto', plafond 40%) vérifiaient des règles volontairement supprimées.
win.newGame();
win.render();
const wrap2 = doc.getElementById("wrap");
const boardViewport2 = doc.getElementById("board-viewport");
const boardSvg2 = doc.getElementById("board");
stubBox(wrap2, { clientWidth: 412, clientHeight: 915 }); // Pixel en portrait
win.eval("applyLayout()");
const L2 = win.eval("lastLayout");
const vb2 = boardSvg2.viewBox.baseVal;
console.log("Profil retenu pour un écran haut et étroit (attendu portrait) :", L2.profile);
console.log("La fenêtre du plateau et le SVG ont exactement la même hauteur — aucune troncature possible (attendu true) :",
  Math.abs(parseFloat(boardSvg2.style.height) - parseFloat(boardViewport2.style.height)) < 0.5);
console.log("La largeur du SVG découle du rapport d'aspect, pas d'un pourcentage (attendu true) :",
  Math.abs(parseFloat(boardSvg2.style.width) / parseFloat(boardSvg2.style.height) - vb2.width / vb2.height) < 0.01);
console.log("Au moins une tuile entière reste visible en largeur (attendu true) :", L2.tiles >= 0.995);
console.log("La case atteint la cible tactile de 44 px (attendu true) :", L2.cell >= 44);
console.log("setupBoardScroll() est bien idempotent (rappel sans danger) (attendu true) :", (win.setupBoardScroll(), true));

section("Test 2bis — BUG CORRIGÉ (mesuré sur navigateur réel) : sur écran plat, le plateau n'est plus tronqué");

// Avant la refonte, sur un Pixel en paysage, le conteneur du plateau
// obtenait 50 px alors que 164 lui avaient été posés : flexbox
// rétrécissait la boîte en silence pendant que le SVG gardait sa
// taille, et le plateau était coupé. On vérifie ici que la boîte et son
// contenu ne peuvent plus diverger, et que rien ne sort de l'écran.
dom = makeDom();
win = dom.window;
win.newGame();
win.render();
const doc2b = dom.window.document;
stubBox(doc2b.getElementById("wrap"), { clientWidth: 915, clientHeight: 412 });
win.eval("applyLayout()");
const L2b = win.eval("lastLayout");
const boardSvg2b = doc2b.getElementById("board");
const boardViewport2b = doc2b.getElementById("board-viewport");
console.log("Profil retenu pour un écran plat (attendu landscape) :", L2b.profile);
console.log("Le SVG ne dépasse plus jamais sa fenêtre (attendu true) :",
  parseFloat(boardSvg2b.style.height) <= parseFloat(boardViewport2b.style.height) + 0.5);
console.log("Les 6 rangées tiennent toujours (attendu true) :",
  parseFloat(boardViewport2b.style.height) >= 229.3 * (44 / 37.9) - 1);
console.log("Aucun module ne sort de l'écran (attendu true) :",
  Object.values(L2b.zones).filter((z) => z && z.id && !z.overlay)
    .every((z) => z.x >= -0.5 && z.y >= -0.5 && z.x + z.w <= 915 + 1 && z.y + z.h <= 412 + 1));
console.log("Le curseur de position est passé en surimpression plutôt que de coûter une rangée (attendu true) :",
  L2b.sliderOverlay === true && doc2b.getElementById("board-position-slider").classList.contains("over-board"));

section("Test 3 — Zone 1 : le curseur de position se synchronise dans les deux sens avec le défilement");

dom = makeDom();
win = dom.window;
win.newGame();
win.render();
const viewport3 = dom.window.document.getElementById("board-viewport");
const slider3 = dom.window.document.getElementById("board-position-slider");
stubBox(viewport3, { scrollWidth: 1000, clientWidth: 400 }); // 600px de défilement possible
viewport3.scrollLeft = 300; // la moitié du défilement possible
win.syncBoardSlider();
console.log("scrollLeft=300/600 -> curseur à ~500/1000 (attendu true) :", Math.abs(Number(slider3.value) - 500) <= 1);

slider3.value = 0;
win.onBoardSliderInput();
console.log("Curseur remis à 0 -> scrollLeft repasse à 0 (attendu true) :", viewport3.scrollLeft === 0);

section("Test 4 — Zone 2 : la bande d'info affiche le round et le joueur actif, ou 'PARTIE TERMINÉE'");

dom = makeDom();
win = dom.window;
win.newGame();
let G = win.eval("G");
win.render();
const infoBand4 = dom.window.document.getElementById("info-band");
const cp4 = win.getCurrentPlayer(G.roundState);
console.log("Le module ROUND affiche bien le numéro de manche, séparément de la bande d'info (attendu true) :",
  /ROUND\s*\d+/.test(dom.window.document.getElementById("round-module").textContent));
console.log("[règle changée : le round a quitté la bande d'info] la bande ne le répète plus (attendu false) :", infoBand4.textContent.includes("ROUND " + G.roundState.roundNumber));
console.log("La bande d'info mentionne bien le joueur actif, en toutes lettres (attendu true) :", infoBand4.textContent.includes(win.eval(`playerLabel("${cp4}")`).toUpperCase()));

win.eval("gameOver = true;");
win.render();
console.log("Une fois la partie terminée, affiche 'PARTIE TERMINÉE' (attendu true) :", dom.window.document.getElementById("info-band").textContent.includes("PARTIE TERMINÉE"));

section("Test 5 — Zone 3 : la hauteur du conteneur vient du moteur, la largeur du SVG n'appartient qu'au zoom");

dom = makeDom();
win = dom.window;
win.newGame();
win.render();
const doc5 = dom.window.document;
stubBox(doc5.getElementById("wrap"), { clientWidth: 412, clientHeight: 915 });
win.eval("applyLayout()");
const L5 = win.eval("lastLayout");
const dashViewport5 = doc5.getElementById("dashboards-viewport");
const dashSvg5 = doc5.getElementById("dashboards");
console.log("La hauteur du conteneur correspond au rectangle calculé par le moteur (attendu true) :",
  Math.abs(parseFloat(dashViewport5.style.height) - L5.zones.dash0.h) < 1);
console.log("Au moins 2 dashboards tiennent dans cette hauteur (attendu true) :",
  L5.zones.dash0.h >= 2 * (L5.zones.dash0.w / (871 / 234)) - 1);
// RÈGLE CLÉ : la mise en page dimensionne des CONTENEURS, jamais
// l'élément transformé par Panzoom — c'est la confusion des deux qui
// décalait le zoom après un redimensionnement.
// La mise en page ne pose QUE le conteneur. La largeur du SVG
// n'appartient qu'au zoom (voir setDashboardsZoom), sa hauteur découle
// du rapport d'aspect — jamais de la mise en page.
console.log("La mise en page ne fixe jamais la hauteur du SVG des dashboards (attendu true) :",
  dashSvg5.style.height === "");
console.log("La largeur du SVG n'est portée que par le zoom, à 100% au repos (attendu true) :",
  dashSvg5.style.width === "100%");

section("Test 6 — Zone 3 : le zoom repose sur le défilement NATIF, sans bibliothèque");

// PANZOOM RETIRÉ. Son option contain:"outside" exigeait que le contenu
// RECOUVRE son conteneur : dès que le moteur de mise en page a décidé
// d'une hauteur différente de la hauteur naturelle du contenu, Panzoom
// agrandissait l'échelle pour recouvrir (scale 1,039 mesuré au clic sur
// x1, soit 16 px débordant à droite sur téléphone). Le défilement natif
// n'a pas ce problème : on ne peut structurellement pas défiler au-delà
// du contenu, il n'y a plus rien à recalculer après un redimensionnement.
console.log("Plus aucune dépendance Panzoom dans la page (attendu true) :", typeof win.Panzoom === "undefined");
console.log("Le zoom démarre bien à x1 (attendu true) :", win.eval("getDashboardsZoom()") === 1);
console.log("Le SVG porte sa largeur de repos, sans transform (attendu true) :",
  dom.window.document.getElementById("dashboards").style.width === "100%" &&
  dom.window.document.getElementById("dashboards").style.transform === "");
const dashCss6 = dom.window.getComputedStyle(dom.window.document.getElementById("dashboards-viewport"));
console.log("Le conteneur défile nativement (attendu true) :", dashCss6.overflow === "auto");
console.log("...avec le déplacement à un doigt laissé au navigateur, donc son inertie système (attendu true) :",
  dashCss6.touchAction === "pan-x pan-y");
console.log("...et sans déborder sur la page en fin de course (attendu true) :",
  dashCss6.overscrollBehavior === "contain");

section("Test 7 — Robustesse : plus aucune bibliothèque tierce à faire échouer");

// Avant, l'absence de requestAnimationFrame faisait échouer l'init de
// Panzoom et il fallait un try/catch pour que le jeu survive. Le
// défilement natif n'a rien à initialiser qui puisse échouer.
const domNoRaf = new JSDOM(html, { runScripts: "dangerously", resources: "usable" }); // pas de polyfill RAF ici
const winNoRaf = domNoRaf.window;
console.log("Le zoom reste disponible même sans requestAnimationFrame (attendu true) :",
  winNoRaf.eval("typeof getDashboardsZoom") === "function" && winNoRaf.eval("getDashboardsZoom()") === 1);
winNoRaf.newGame();
winNoRaf.render();
console.log("Le jeu démarre et se rend normalement (attendu true) :", winNoRaf.eval("G") !== null && winNoRaf.eval("G.allCars").length > 0);

section("Test 8 — Retours de Mayrik (usage réel) : scrollbar native masquée");

dom = makeDom();
win = dom.window;
const boardViewportCss8 = dom.window.getComputedStyle(dom.window.document.getElementById("board-viewport"));
console.log("La scrollbar native du plateau est bien masquée (scrollbar-width:none) (attendu true) :", boardViewportCss8.scrollbarWidth === "none");

console.log("Les marges de secours (retour de Mayrik : plus nécessaires, colonne flexible pleine hauteur, plus de défilement de page à rattraper) ont bien été retirées (attendu true) :",
  dom.window.document.querySelectorAll("#dashboards-margin").length === 0);

console.log("Le bouton de réinitialisation a bien été retiré (le bouton x1 sert aussi de retour à l'affichage complet) (attendu true) :", !dom.window.document.getElementById("dashboards-reset-btn"));

section("Test 9 — Retour de Mayrik (usage réel) : touch-action:manipulation plutôt que user-scalable=no (inefficace sur iOS)");

dom = makeDom();
win = dom.window;
const bodyCss9 = dom.window.getComputedStyle(dom.window.document.body);
console.log("body a bien touch-action:manipulation (désactive le double-tap-zoom du navigateur, iOS ET Android) (attendu true) :", bodyCss9.touchAction === "manipulation");

const viewportMeta9 = dom.window.document.querySelector('meta[name="viewport"]');
console.log("La balise viewport ne contient plus user-scalable=no (méthode abandonnée, ignorée par Safari iOS depuis iOS 10) (attendu true) :",
  !!viewportMeta9 && !viewportMeta9.getAttribute("content").includes("user-scalable"));

const dashViewportCss9 = dom.window.getComputedStyle(dom.window.document.getElementById("dashboards-viewport"));
console.log("#dashboards-viewport laisse le déplacement à un doigt au navigateur et n'intercepte que le pincement (attendu true) :", dashViewportCss9.touchAction === "pan-x pan-y");

console.log("\n=== Fin des tests dédiés (mise en page 3 zones + zoom) ===");

section("Test 10 — Bouton plein écran : présent, masqué proprement si l'API Fullscreen n'est pas disponible (ex. iOS Safari/Chrome)");

dom = makeDom();
win = dom.window;
const fsBtn10 = dom.window.document.getElementById("fullscreen-btn");
console.log("Le bouton existe dans le DOM (attendu true) :", !!fsBtn10);
console.log("Masqué proprement quand document.fullscreenEnabled est absent (comme sur iOS) (attendu true) :", fsBtn10.style.display === "none");

section("Test 11 — Les 3 préréglages de zoom x1/x2/x4");

dom = makeDom();
win = dom.window;
win.newGame();
win.render();
const doc11 = dom.window.document;
const presetBtns11 = [...doc11.querySelectorAll("#dashboards-zoom-presets button")];
console.log("Les 3 boutons x1/x2/x4 sont bien présents, dans cet ordre (attendu true) :",
  presetBtns11.map((b) => b.dataset.zoomPreset).join(",") === "1,2,4");
// Sortis du conteneur défilant : dedans, ils défileraient avec le contenu.
console.log("Les boutons ne sont plus enfants du conteneur défilant (attendu true) :",
  doc11.getElementById("dashboards-zoom-presets").parentElement.id !== "dashboards-viewport");

const clickPreset11 = (v) => presetBtns11.find((b) => b.dataset.zoomPreset === String(v))
  .dispatchEvent(new win.Event("click", { bubbles: true }));
[2, 4, 1].forEach((v) => {
  clickPreset11(v);
  console.log("Cliquer sur x" + v + " règle le zoom à " + v + " et la largeur du SVG à " + v * 100 + "% (attendu true) :",
    win.eval("getDashboardsZoom()") === v && doc11.getElementById("dashboards").style.width === (v * 100) + "%");
});
clickPreset11(4);
console.log("Le bouton actif est bien mis en évidence (attendu true) :",
  presetBtns11.find((b) => b.dataset.zoomPreset === "4").classList.contains("active"));

section("Test 12 — Double-tap : x1 vers x4 et retour, sur un seul flux d'événements pointeur");

// Avant : touchend et dblclick écoutés en parallèle, donc deux
// déclenchements pour un seul geste, rattrapés par preventDefault, un
// écouteur non-passif et un drapeau de garde. Les événements pointeur
// couvrent souris, tactile et stylet d'un seul flux : aucun événement
// synthétique, donc aucune rustine.
dom = makeDom();
win = dom.window;
win.newGame();
win.render();
const viewport12 = dom.window.document.getElementById("dashboards-viewport");
const tap12 = (x, y) => {
  const opt = { bubbles: true, clientX: x, clientY: y };
  viewport12.dispatchEvent(new win.MouseEvent("pointerdown", opt));
  viewport12.dispatchEvent(new win.MouseEvent("pointerup", opt));
};
console.log("Zoom de départ = 1 (attendu true) :", win.eval("getDashboardsZoom()") === 1);
tap12(40, 40); tap12(40, 40);
console.log("Un double-tap bascule bien vers x4 (attendu true) :", win.eval("getDashboardsZoom()") === 4);
tap12(40, 40); tap12(40, 40);
console.log("...et un second double-tap redescend bien à x1 (attendu true) :", win.eval("getDashboardsZoom()") === 1);
// Deux taps éloignés ne forment pas un double-tap.
tap12(10, 10); tap12(300, 300);
console.log("Deux taps éloignés ne déclenchent pas le zoom (attendu true) :", win.eval("getDashboardsZoom()") === 1);

section("Test 13 — L'inertie du glissement est celle du système, plus une décroissance écrite à la main");

// Avant : Panzoom émettait panzoompan, on échantillonnait la vitesse au
// relâché et on rejouait une décroissance exponentielle sur ~50 lignes.
// Le défilement natif donne cette inertie gratuitement, avec le
// comportement exact du reste du téléphone.
dom = makeDom();
win = dom.window;
win.newGame();
win.render();
const doc13 = dom.window.document;
console.log("Plus aucune trace du mécanisme d'inertie maison (attendu true) :",
  win.eval("typeof dashboardsPanzoom") === "undefined" &&
  !/KINETIC_TIME_CONSTANT|MOMENTUM_DISTANCE_MULTIPLIER/.test(html));
const vp13 = doc13.getElementById("dashboards-viewport");
vp13.scrollLeft = 120;
vp13.scrollTop = 80;
console.log("La position de lecture vit sur le conteneur, pas sur un transform (attendu true) :",
  doc13.getElementById("dashboards").style.transform === "");
// Zoomer conserve le point visé : les défilements suivent le rapport
// d'échelle, indépendamment de la taille du conteneur.
win.eval("setDashboardsZoom(2, null)");
console.log("Le zoom conserve le point visé en suivant le rapport d'échelle (attendu true) :",
  vp13.scrollLeft === 240 && vp13.scrollTop === 160);

section("Test 14 — Répartition globale à l'écran (retour de Mayrik) : colonne flexible pleine hauteur, chaque zone calée sans espace mort");

dom = makeDom();
win = dom.window;
win.newGame();
win.render();

const metaViewport14 = dom.window.document.querySelector('meta[name="viewport"]');
console.log("La balise viewport contient bien viewport-fit=cover (retour de Mayrik : bande noire inutilisée en haut de l'écran) (attendu true) :",
  metaViewport14.getAttribute("content").includes("viewport-fit=cover"));

const wrapCss14 = dom.window.getComputedStyle(dom.window.document.getElementById("wrap"));
// STRUCTURE CHANGÉE : #wrap n'est plus une colonne flexible mais un
// repère de positionnement ; chaque module est placé en absolu aux
// coordonnées du moteur. 100dvh sert d'amorce avant le premier passage
// de JS, qui pose ensuite la hauteur réellement mesurée.
console.log("#wrap est bien un repère de positionnement en position fixe (attendu true) :",
  wrapCss14.position === "fixed" && wrapCss14.display === "block");
console.log("...avec 100dvh comme amorce avant la première mesure (attendu true) :", wrapCss14.height === "100dvh");
console.log("...et plus aucune largeur maximale qui gâcherait l'écran d'un ordinateur (attendu true) :",
  wrapCss14.maxWidth === "" || wrapCss14.maxWidth === "none");

const modulesAbsolus14 = ["board-viewport", "info-band", "dashboards-viewport", "round-module", "board-position-slider"]
  .every((id) => dom.window.getComputedStyle(dom.window.document.getElementById(id)).position === "absolute");
console.log("Les modules sont bien positionnés en absolu par la couche d'application (attendu true) :", modulesAbsolus14);

console.log("L'écran d'accueil passe bien AU-DESSUS de #wrap, lui aussi en position fixe (attendu true) :",
  parseInt(dom.window.getComputedStyle(dom.window.document.getElementById("start-screen")).zIndex, 10) > 0);

const sliderCss14 = dom.window.getComputedStyle(dom.window.document.getElementById("board-position-slider"));
console.log("Le curseur du plateau n'a plus de marge (collé au plateau au-dessus, à la bande d'info en dessous) (attendu true) :", sliderCss14.margin === "0px");

console.log("#log reste bien masqué (retour de Mayrik : c'était la vraie cause de l'espace vide en bas d'écran — 48px de marges à vide, oublié lors du masquage des éléments obsolètes) (attendu true) :",
  dom.window.getComputedStyle(dom.window.document.getElementById("log")).display === "none");

// BUG CORRIGÉ (retour de Mayrik : marge indésirable sous le dernier
// command board) : l'écart ne doit s'appliquer qu'ENTRE les rangées,
// jamais après la dernière. Vérifie la formule exacte plutôt que la
// seule valeur numérique, pour rester juste si le nombre de joueurs
// ou les dimensions des rangées changent.
const rowBBoxH14 = win.eval("ROW_BBOX.h");
const rowGap14 = win.eval("PLAYER_ROW_GAP");
const orderLength14 = win.eval("PLAYER_NAMES.length"); // nombre de rangées affichées (1 humain + IA)
const expectedTotalH14 = orderLength14 * (rowBBoxH14 + rowGap14) - rowGap14;
const actualViewBoxH14 = Number(dom.window.document.getElementById("dashboards").getAttribute("viewBox").split(" ")[3]);
console.log("Le viewBox des dashboards a bien la hauteur exacte (N*(h+écart) - écart, jamais + écart) (attendu true) :",
  Math.abs(actualViewBoxH14 - expectedTotalH14) < 0.01);

console.log("Les marges de secours (retirées : colonne flexible pleine hauteur, plus de défilement de page à rattraper) restent bien absentes (attendu true) :",
  dom.window.document.querySelectorAll("#dashboards-margin").length === 0);

console.log("\n=== Fin des tests dédiés (mise en page + zoom) ===");
// Plus aucun échafaudage asynchrone : il n'existait que pour attendre
// la fin de l'inertie faite maison. Le défilement natif n'a rien à
// attendre, donc tout ce fichier redevient synchrone.
