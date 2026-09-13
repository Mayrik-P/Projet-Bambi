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

section("Test 2 — Zone 1 : la largeur du SVG plateau correspond bien à ~3 tuiles (BOARD_VIEW / largeur d'une tuile)");

win.newGame();
win.render();
const boardSvg2 = doc.getElementById("board");
const oneTileWidth2 = win.eval("TILE_NATIVE_COLS * IMG_CELL_W");
const expectedRatio2 = win.eval("BOARD_VIEW.w") / oneTileWidth2;
const actualWidthPercent2 = parseFloat(boardSvg2.style.width);
console.log("Largeur du SVG posée en % (attendu ~" + (expectedRatio2 * 100).toFixed(1) + "%) :", boardSvg2.style.width);
console.log("Le ratio correspond bien à BOARD_VIEW.w / (1 tuile) (attendu true) :", Math.abs(actualWidthPercent2 - expectedRatio2 * 100) < 0.5);
console.log("setupBoardScroll() est bien idempotent (rappel sans danger) (attendu true) :", (win.setupBoardScroll(), true));

section("Test 3 — Zone 1 : le curseur de position se synchronise dans les deux sens avec le défilement");

const viewport3 = doc.getElementById("board-viewport");
const slider3 = doc.getElementById("board-position-slider");
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
console.log("La bande d'info mentionne bien le round (attendu true) :", infoBand4.textContent.includes("ROUND " + G.roundState.roundNumber));
console.log("La bande d'info mentionne bien le joueur actif, en toutes lettres (attendu true) :", infoBand4.textContent.includes(win.eval(`playerLabel("${cp4}")`).toUpperCase()));

win.eval("gameOver = true;");
win.render();
console.log("Une fois la partie terminée, affiche 'PARTIE TERMINÉE' (attendu true) :", dom.window.document.getElementById("info-band").textContent.includes("PARTIE TERMINÉE"));

section("Test 5 — Zone 3 : la hauteur du conteneur dashboards correspond au ratio du viewBox (cadre tout à l'échelle 1)");

dom = makeDom();
win = dom.window;
win.newGame();
win.render();
const dashViewport5 = dom.window.document.getElementById("dashboards-viewport");
stubBox(dashViewport5, { clientWidth: 800 });
win.updateDashboardsViewportHeight();
const dashSvg5 = dom.window.document.getElementById("dashboards");
const vbHeight5 = dashSvg5.viewBox.baseVal.height, vbWidth5 = dashSvg5.viewBox.baseVal.width;
const expectedHeight5 = 800 * (vbHeight5 / vbWidth5);
console.log("Hauteur du conteneur = largeur * (ratio du viewBox) (attendu true) :",
  Math.abs(parseFloat(dashViewport5.style.height) - expectedHeight5) < 1);

section("Test 6 — Zone 3 : Panzoom s'initialise correctement (avec le polyfill requestAnimationFrame)");

console.log("dashboardsPanzoom n'est PAS null (init réussie) (attendu true) :", win.eval("dashboardsPanzoom") !== null);
console.log("Les méthodes zoom/pan/zoomWithWheel existent (attendu true) :",
  win.eval("typeof dashboardsPanzoom.zoom") === "function" &&
  win.eval("typeof dashboardsPanzoom.pan") === "function" &&
  win.eval("typeof dashboardsPanzoom.zoomWithWheel") === "function");
console.log("#dashboards-viewport a bien touch-action:none (laisse Panzoom gérer le tactile) (attendu true) :",
  dom.window.getComputedStyle(dom.window.document.getElementById("dashboards-viewport")).touchAction === "none");

section("Test 7 — Robustesse : si Panzoom échoue à s'initialiser, le jeu continue de fonctionner normalement");

const domNoRaf = new JSDOM(html, { runScripts: "dangerously", resources: "usable" }); // pas de polyfill RAF ici
const winNoRaf = domNoRaf.window;
console.log("dashboardsPanzoom reste bien null, sans exception non gérée (attendu true) :", winNoRaf.eval("dashboardsPanzoom") === null);
winNoRaf.newGame();
winNoRaf.render();
console.log("Le jeu démarre et se rend normalement malgré l'échec de Panzoom (attendu true) :", winNoRaf.eval("G") !== null && winNoRaf.eval("G.allCars").length > 0);

section("Test 8 — Retours de Mayrik (usage réel) : scrollbar native masquée, marges de secours tactile, bouton de réinitialisation");

dom = makeDom();
win = dom.window;
const boardViewportCss8 = dom.window.getComputedStyle(dom.window.document.getElementById("board-viewport"));
console.log("La scrollbar native du plateau est bien masquée (scrollbar-width:none) (attendu true) :", boardViewportCss8.scrollbarWidth === "none");

const margins8 = dom.window.document.querySelectorAll("#dashboards-margin");
console.log("Les 2 marges de secours (au-dessus/dessous des dashboards) sont présentes (attendu true) :", margins8.length === 2);
const marginCss8 = dom.window.getComputedStyle(margins8[0]);
console.log("...et restent en touch-action normal (jamais capturées par Panzoom) (attendu true) :", marginCss8.touchAction !== "none");

const resetBtn8 = dom.window.document.getElementById("dashboards-reset-btn");
console.log("Le bouton de réinitialisation du zoom est présent (attendu true) :", !!resetBtn8);

win.newGame();
win.render();
if (win.eval("dashboardsPanzoom") !== null) {
  win.eval("dashboardsPanzoom.zoom(2, { animate: false })"); // simule un zoom actif
  resetBtn8.dispatchEvent(new win.Event("click", { bubbles: true }));
  console.log("Cliquer le bouton ramène bien le zoom à 1 (attendu true) :", win.eval("dashboardsPanzoom.getScale()") === 1);
}

section("Test 9 — Double-tap / double-clic réinitialise le zoom (retour de Mayrik)");

function tapAt(win, el, x, y) {
  const touch = { identifier: 1, clientX: x, clientY: y };
  el.dispatchEvent(new win.TouchEvent("touchstart", { touches: [touch], changedTouches: [touch], bubbles: true }));
  el.dispatchEvent(new win.TouchEvent("touchend", { touches: [], changedTouches: [touch], bubbles: true }));
}
function dragFromTo(win, el, x1, y1, x2, y2) {
  el.dispatchEvent(new win.TouchEvent("touchstart", { touches: [{ identifier: 1, clientX: x1, clientY: y1 }], changedTouches: [{ identifier: 1, clientX: x1, clientY: y1 }], bubbles: true }));
  el.dispatchEvent(new win.TouchEvent("touchend", { touches: [], changedTouches: [{ identifier: 1, clientX: x2, clientY: y2 }], bubbles: true }));
}

dom = makeDom();
win = dom.window;
win.newGame();
win.render();
const viewport9 = dom.window.document.getElementById("dashboards-viewport");
win.eval("dashboardsPanzoom.zoom(2, { animate: false })");
console.log("Zoom bien actif avant le test (attendu true) :", win.eval("dashboardsPanzoom.getScale()") === 2);

tapAt(win, viewport9, 100, 100);
console.log("Un seul tap ne réinitialise PAS le zoom (attendu true) :", win.eval("dashboardsPanzoom.getScale()") === 2);

tapAt(win, viewport9, 105, 102); // 2e tap, proche et rapide
console.log("Un 2e tap rapproché dans le temps ET l'espace réinitialise bien le zoom (attendu true) :", win.eval("dashboardsPanzoom.getScale()") === 1);

win.eval("dashboardsPanzoom.zoom(2, { animate: false })");
tapAt(win, viewport9, 100, 100);
tapAt(win, viewport9, 400, 400); // 2e tap trop loin du premier
console.log("Deux taps trop ÉLOIGNÉS l'un de l'autre ne réinitialisent PAS (attendu true) :", win.eval("dashboardsPanzoom.getScale()") === 2);

win.eval("dashboardsPanzoom.zoom(2, { animate: false })");
dragFromTo(win, viewport9, 100, 100, 250, 100); // glissé, pas un tap
dragFromTo(win, viewport9, 260, 100, 105, 102); // 2e glissé revenant près du point de départ initial
console.log("Un glissé (panoramique) n'est jamais compté comme un tap, même répété (attendu true) :", win.eval("dashboardsPanzoom.getScale()") === 2);

viewport9.dispatchEvent(new win.Event("dblclick", { bubbles: true }));
console.log("dblclick (souris, ordinateur) réinitialise aussi le zoom (attendu true) :", win.eval("dashboardsPanzoom.getScale()") === 1);

// Bascule (retour de Mayrik) : à l'échelle 1 (plein écran), un
// double-tap doit ZOOMER (x4), pas re-réinitialiser sur place.
tapAt(win, viewport9, 200, 150);
tapAt(win, viewport9, 205, 152);
console.log("Depuis l'échelle 1, un double-tap zoome bien à x4 (bascule, pas un simple reset) (attendu true) :", win.eval("dashboardsPanzoom.getScale()") === 4);
tapAt(win, viewport9, 200, 150);
tapAt(win, viewport9, 205, 152);
console.log("Un 2e double-tap (maintenant zoomé) redescend bien à l'échelle 1 (attendu true) :", win.eval("dashboardsPanzoom.getScale()") === 1);

section("Test 10 — Retour de Mayrik (usage réel, conflit double-tap navigateur) : touch-action:manipulation plutôt que user-scalable=no (inefficace sur iOS)");

dom = makeDom();
win = dom.window;
const bodyCss10 = dom.window.getComputedStyle(dom.window.document.body);
console.log("body a bien touch-action:manipulation (désactive le double-tap-zoom du navigateur, iOS ET Android) (attendu true) :", bodyCss10.touchAction === "manipulation");

const viewportMeta10 = dom.window.document.querySelector('meta[name="viewport"]');
console.log("La balise viewport ne contient plus user-scalable=no (méthode abandonnée, ignorée par Safari iOS depuis iOS 10) (attendu true) :",
  !!viewportMeta10 && !viewportMeta10.getAttribute("content").includes("user-scalable"));

const dashViewportCss10 = dom.window.getComputedStyle(dom.window.document.getElementById("dashboards-viewport"));
console.log("#dashboards-viewport garde bien son touch-action:none propre (Panzoom garde le contrôle total localement) (attendu true) :", dashViewportCss10.touchAction === "none");

console.log("\n=== Fin des tests dédiés (mise en page 3 zones + zoom) ===");

section("Test 11 — Inertie après un panoramique relâché (retour de Mayrik, formule Ariya Hidayat / kinetic scrolling)");

dom = makeDom();
win = dom.window;
win.newGame();
win.render();
const svg11 = dom.window.document.getElementById("dashboards");
const dashViewport11 = dom.window.document.getElementById("dashboards-viewport");
// jsdom n'a pas de vrai moteur de mise en page : getBoundingClientRect
// renvoie 0 partout par défaut, ce qui fait que le containment de
// Panzoom clampe tout panoramique à (0,0), même un appel direct. On
// simule un contenu bien plus grand que le conteneur (cas réel une
// fois zoomé), condition nécessaire pour que .pan() ait une vraie
// marge de manœuvre à tester.
svg11.getBoundingClientRect = () => ({ x: -100, y: -50, left: -100, top: -50, right: 900, bottom: 350, width: 1000, height: 400 });
dashViewport11.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 300, width: 800, height: 300 });
win.eval("dashboardsPanzoom.zoom(2, { animate: false })"); // rien à panoramiquer à l'échelle 1 (minScale)
win.eval("dashboardsPanzoom.pan(0, 0, { animate: false })");

// Simule un panoramique rapide : 4 échantillons rapprochés dans le
// temps, se déplaçant tous dans la même direction (vitesse nette
// élevée au relâché).
function firePanzoomPan(win, el, x, y) {
  el.dispatchEvent(new win.CustomEvent("panzoompan", { detail: { x, y, scale: 2, isSVG: true }, bubbles: true }));
}
svg11.dispatchEvent(new win.CustomEvent("panzoomstart", { detail: {}, bubbles: true }));
firePanzoomPan(win, svg11, 0, 0);
firePanzoomPan(win, svg11, 40, 0);
firePanzoomPan(win, svg11, 90, 0);
firePanzoomPan(win, svg11, 150, 0); // ~1.5px/ms de vitesse nette en x

const panBeforeEnd = win.eval("dashboardsPanzoom.getPan().x");
svg11.dispatchEvent(new win.CustomEvent("panzoomend", { detail: {}, bubbles: true }));
setTimeout(() => {
  const panAfterCoast = win.eval("dashboardsPanzoom.getPan().x");
  console.log("Le panoramique continue bien tout seul après le relâché (inertie) (attendu true) :", panAfterCoast > panBeforeEnd);

  // Un panoramique lent (quasi immobile) ne doit déclencher AUCUNE inertie.
  win.eval("dashboardsPanzoom.pan(0, 0, { animate: false })");
  svg11.dispatchEvent(new win.CustomEvent("panzoomstart", { detail: {}, bubbles: true }));
  firePanzoomPan(win, svg11, 0, 0);
  firePanzoomPan(win, svg11, 1, 0);
  const panBeforeEnd2 = win.eval("dashboardsPanzoom.getPan().x");
  svg11.dispatchEvent(new win.CustomEvent("panzoomend", { detail: {}, bubbles: true }));
  setTimeout(() => {
    const panAfterEnd2 = win.eval("dashboardsPanzoom.getPan().x");
    console.log("Un relâché quasi immobile ne déclenche PAS d'inertie (attendu true) :", panAfterEnd2 === panBeforeEnd2);

    // Démarrer un NOUVEAU panoramique doit couper une inertie en cours.
    win.eval("dashboardsPanzoom.pan(0, 0, { animate: false })");
    svg11.dispatchEvent(new win.CustomEvent("panzoomstart", { detail: {}, bubbles: true }));
    firePanzoomPan(win, svg11, 0, 0);
    firePanzoomPan(win, svg11, 150, 0);
    svg11.dispatchEvent(new win.CustomEvent("panzoomend", { detail: {}, bubbles: true }));
    setTimeout(() => {
      svg11.dispatchEvent(new win.CustomEvent("panzoomstart", { detail: {}, bubbles: true })); // coupe le coast en cours
      const panAtInterrupt = win.eval("dashboardsPanzoom.getPan().x");
      setTimeout(() => {
        const panAfterInterrupt = win.eval("dashboardsPanzoom.getPan().x");
        console.log("Démarrer un nouveau panoramique coupe bien l'inertie en cours (attendu true) :", panAfterInterrupt === panAtInterrupt);
        console.log("\n=== Fin du Test 11 ===");
      }, 50);
    }, 30);
  }, 50);
}, 50);
