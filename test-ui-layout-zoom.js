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

section("Test 2bis — BUG CORRIGÉ (retour de Mayrik, écran large/peu haut — ordinateur ou téléphone en mode paysage) : le plateau ne se retrouve plus tronqué, bascule vers un calage par la hauteur");

dom = makeDom();
win = dom.window;
win.newGame();
win.render();
const boardViewport2b = dom.window.document.getElementById("board-viewport");
const boardSvg2b = dom.window.document.getElementById("board");
stubBox(boardViewport2b, { clientWidth: 900 });
const boardRatio2b = win.eval("boardWidthRatio");
const boardVbW2b = win.eval("BOARD_VIEW.w"), boardVbH2b = win.eval("BOARD_VIEW.h");
const widthDrivenH2b = 900 * boardRatio2b * (boardVbH2b / boardVbW2b);
// Écran volontairement peu haut : le calage par la largeur dépasse
// largement 40% de innerHeight (vérifié par construction du calcul
// ci-dessus, avant même d'appeler applyBoardSizing).
Object.defineProperty(win, "innerHeight", { value: 400, configurable: true });
win.eval("applyBoardSizing()");
const expectedMaxH2b = 400 * 0.4;
console.log("Cette configuration dépasse bien le plafond, condition du test respectée (attendu true) :", widthDrivenH2b > expectedMaxH2b);
console.log("Le conteneur ne dépasse jamais le plafond (40% de la hauteur d'écran) (attendu true) :",
  Math.abs(parseFloat(boardViewport2b.style.height) - expectedMaxH2b) < 1);
console.log("...et la largeur du SVG passe bien en 'auto' avec une hauteur explicite (plateau plus étroit, centré) (attendu true) :",
  boardSvg2b.style.width === "auto" && Math.abs(parseFloat(boardSvg2b.style.height) - expectedMaxH2b) < 1);
console.log("...centré horizontalement (marges automatiques) (attendu true) :",
  boardSvg2b.style.marginLeft === "auto" && boardSvg2b.style.marginRight === "auto");

// Redevenu un écran normal (assez haut) : doit repasser en calage par
// la largeur (pas de blocage permanent dans le mode "hauteur").
Object.defineProperty(win, "innerHeight", { value: 2000, configurable: true });
win.eval("applyBoardSizing()");
console.log("Redevenu un écran assez haut, le calage revient bien à 100% piloté par la largeur (attendu true) :",
  boardSvg2b.style.width === (boardRatio2b * 100).toFixed(2) + "%" && boardSvg2b.style.marginLeft === "");

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
// innerHeight volontairement large (retour de Mayrik : bascule
// largeur/hauteur ajoutée depuis, voir Test 5bis) — ce test-ci vérifie
// le cas normal (écran assez haut, calage par la largeur), pas le cas
// de secours.
Object.defineProperty(win, "innerHeight", { value: 2000, configurable: true });
win.updateDashboardsViewportHeight();
const dashSvg5 = dom.window.document.getElementById("dashboards");
const vbHeight5 = dashSvg5.viewBox.baseVal.height, vbWidth5 = dashSvg5.viewBox.baseVal.width;
const expectedHeight5 = 800 * (vbHeight5 / vbWidth5);
console.log("Hauteur du conteneur = largeur * (ratio du viewBox) (attendu true) :",
  Math.abs(parseFloat(dashViewport5.style.height) - expectedHeight5) < 1);

section("Test 5bis — BUG CORRIGÉ (retour de Mayrik, écran large/peu haut) : bascule vers un calage par la hauteur quand le calage par la largeur dépasserait l'espace disponible");

dom = makeDom();
win = dom.window;
win.newGame();
win.render();
const dashViewport5b = dom.window.document.getElementById("dashboards-viewport");
const dashSvg5b = dom.window.document.getElementById("dashboards");
stubBox(dashViewport5b, { clientWidth: 800 });
// Écran volontairement peu haut : le calage par la largeur (voir Test
// 5, ~423px ici) dépasserait largement 40% de innerHeight.
Object.defineProperty(win, "innerHeight", { value: 500, configurable: true });
win.updateDashboardsViewportHeight();
const vbHeight5b = dashSvg5b.viewBox.baseVal.height, vbWidth5b = dashSvg5b.viewBox.baseVal.width;
const expectedMaxH5b = 500 * 0.4;
console.log("Le conteneur ne dépasse jamais le plafond (40% de la hauteur d'écran) (attendu true) :",
  Math.abs(parseFloat(dashViewport5b.style.height) - expectedMaxH5b) < 1);
const expectedWidth5b = expectedMaxH5b * (vbWidth5b / vbHeight5b);
console.log("...et la largeur du SVG est recalculée en conséquence (plateau dashboards plus étroit, centré) (attendu true) :",
  Math.abs(parseFloat(dashSvg5b.style.width) - expectedWidth5b) < 1);
console.log("...centré horizontalement (marges automatiques) (attendu true) :",
  dashSvg5b.style.marginLeft === "auto" && dashSvg5b.style.marginRight === "auto");

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
console.log("#dashboards-viewport garde bien son touch-action:none propre (Panzoom garde le contrôle total localement pour son pincement/glissé natifs) (attendu true) :", dashViewportCss9.touchAction === "none");

console.log("\n=== Fin des tests dédiés (mise en page 3 zones + zoom) ===");

section("Test 10 — Bouton plein écran : présent, masqué proprement si l'API Fullscreen n'est pas disponible (ex. iOS Safari/Chrome)");

dom = makeDom();
win = dom.window;
const fsBtn10 = dom.window.document.getElementById("fullscreen-btn");
console.log("Le bouton existe dans le DOM (attendu true) :", !!fsBtn10);
console.log("Masqué proprement quand document.fullscreenEnabled est absent (comme sur iOS) (attendu true) :", fsBtn10.style.display === "none");

section("Test 11 — Retour de Mayrik : gestion avancée du calage/inertie mise de côté, retour à l'API native de Panzoom, simple et éprouvée — 3 préréglages de zoom (x1/x2/x4)");

dom = makeDom();
win = dom.window;
win.newGame();
win.render();
const presetBtns11 = [...dom.window.document.querySelectorAll("#dashboards-zoom-presets button")];
console.log("Les 3 boutons x1/x2/x4 sont bien présents, dans cet ordre (attendu true) :",
  presetBtns11.map((b) => b.dataset.zoomPreset).join(",") === "1,2,4");

// Retour de Mayrik, après plusieurs tentatives infructueuses en usage
// réel (origin personnalisé + containment maison + inertie — marges
// visibles, glissement qui déborde puis se recentre brutalement) :
// mis de côté pour l'instant, pas bloquant pour le développement,
// seulement un confort d'usage. Retour à l'API native de Panzoom,
// telle quelle — chaque bouton appelle juste .zoom(), sans tentative
// de calage particulière ; l'ancrage (centré pour cet élément) est
// accepté tel quel ("si le zoom s'effectue au milieu, tant pis").
console.log("Panzoom est construit avec le containment natif 'outside' (pas de containment personnalisé) (attendu true) :",
  win.eval("dashboardsPanzoom.getOptions().contain") === "outside");
console.log("...et sans origin personnalisé (comportement natif de Panzoom, centré pour cet élément — accepté tel quel) (attendu true) :",
  win.eval("dashboardsPanzoom.getOptions().origin") === undefined);

const btnX2_11 = presetBtns11.find((b) => b.dataset.zoomPreset === "2");
btnX2_11.dispatchEvent(new win.Event("click", { bubbles: true }));
console.log("Cliquer sur x2 règle bien l'échelle à 2 (attendu true) :", win.eval("dashboardsPanzoom.getScale()") === 2);

const btnX4_11 = presetBtns11.find((b) => b.dataset.zoomPreset === "4");
btnX4_11.dispatchEvent(new win.Event("click", { bubbles: true }));
console.log("Cliquer sur x4 règle bien l'échelle à 4 (attendu true) :", win.eval("dashboardsPanzoom.getScale()") === 4);

const btnX1_11 = presetBtns11.find((b) => b.dataset.zoomPreset === "1");
btnX1_11.dispatchEvent(new win.Event("click", { bubbles: true }));
console.log("Cliquer sur x1 règle bien l'échelle à 1 (sert aussi de retour à l'affichage complet) (attendu true) :", win.eval("dashboardsPanzoom.getScale()") === 1);

section("Test 12 — Double-tap / double-clic bascule x1 ↔ x4 (retour de Mayrik : gardé, fonctionne bien et naturel sur téléphone — contrairement au calage précis/inertie mis de côté)");

dom = makeDom();
win = dom.window;
win.newGame();
win.render();
const viewport12 = dom.window.document.getElementById("dashboards-viewport");

console.log("Échelle de départ = 1 (attendu true) :", win.eval("dashboardsPanzoom.getScale()") === 1);
viewport12.dispatchEvent(new win.Event("dblclick", { bubbles: true }));
console.log("dblclick (souris, ordinateur) bascule bien vers x4 (attendu true) :", win.eval("dashboardsPanzoom.getScale()") === 4);
viewport12.dispatchEvent(new win.Event("dblclick", { bubbles: true }));
console.log("...et un 2e dblclick redescend bien à l'échelle 1 (attendu true) :", win.eval("dashboardsPanzoom.getScale()") === 1);

win.eval("dashboardsPanzoom.zoom(2, { animate: false })");
console.log("Zoom bien actif avant le test (attendu true) :", win.eval("dashboardsPanzoom.getScale()") === 2);

tapAt(win, viewport12, 100, 100);
console.log("Un seul tap ne bascule PAS le zoom (attendu true) :", win.eval("dashboardsPanzoom.getScale()") === 2);

tapAt(win, viewport12, 105, 102); // 2e tap, proche et rapide
console.log("Un 2e tap rapproché dans le temps ET l'espace bascule bien vers x1 (attendu true) :", win.eval("dashboardsPanzoom.getScale()") === 1);

win.eval("dashboardsPanzoom.zoom(2, { animate: false })");
tapAt(win, viewport12, 100, 100);
tapAt(win, viewport12, 400, 400); // 2e tap trop loin du premier
console.log("Deux taps trop ÉLOIGNÉS l'un de l'autre ne basculent PAS (attendu true) :", win.eval("dashboardsPanzoom.getScale()") === 2);

dragFromTo(win, viewport12, 100, 100, 250, 100); // glissé, pas un tap
dragFromTo(win, viewport12, 260, 100, 105, 102); // 2e glissé revenant près du point de départ initial
console.log("Un glissé (panoramique) n'est jamais compté comme un tap, même répété (attendu true) :", win.eval("dashboardsPanzoom.getScale()") === 2);

// Depuis l'échelle 1, un double-tap doit ZOOMER (x4), pas re-basculer sur place.
dom = makeDom();
win = dom.window;
win.newGame();
win.render();
const viewport12b = dom.window.document.getElementById("dashboards-viewport");
tapAt(win, viewport12b, 200, 150);
tapAt(win, viewport12b, 205, 152);
console.log("Depuis l'échelle 1, un double-tap zoome bien à x4 (attendu true) :", win.eval("dashboardsPanzoom.getScale()") === 4);
tapAt(win, viewport12b, 200, 150);
tapAt(win, viewport12b, 205, 152);
console.log("Un 2e double-tap (maintenant zoomé) redescend bien à l'échelle 1 (attendu true) :", win.eval("dashboardsPanzoom.getScale()") === 1);

section("Test 12bis — BUG CORRIGÉ (gardé) : un double-tap tactile ne déclenche pas AUSSI le dblclick synthétique du navigateur (double bascule qui s'annule)");

dom = makeDom();
win = dom.window;
win.newGame();
win.render();
const viewport12c = dom.window.document.getElementById("dashboards-viewport");
win.eval("dashboardsPanzoom.zoom(2, { animate: false })");
tapAt(win, viewport12c, 100, 100);
tapAt(win, viewport12c, 105, 102); // double-tap tactile -> devrait basculer à x1 UNE fois
console.log("Le double-tap tactile bascule bien vers l'échelle 1 (attendu true) :", win.eval("dashboardsPanzoom.getScale()") === 1);
// Le navigateur synthétise ENSUITE un dblclick pour la même paire de
// taps (comportement standard documenté) — ne doit PAS re-basculer.
viewport12c.dispatchEvent(new win.Event("dblclick", { bubbles: true }));
console.log("...et le dblclick synthétique qui suit ne re-bascule PAS (reste à l'échelle 1) (attendu true) :", win.eval("dashboardsPanzoom.getScale()") === 1);

section("Test 13 — Plus de distance parcourue par le glissement, via inertie (retour de Mayrik : reprise de l'approche qui fonctionnait déjà, avec le containment NATIF de Panzoom cette fois — plus de calcul de limite fait maison)");

dom = makeDom();
win = dom.window;
win.newGame();
win.render();
const svg13 = dom.window.document.getElementById("dashboards");
// jsdom n'a pas de vraie mise en page : getBoundingClientRect renvoie
// 0 partout par défaut, ce qui ferait clamper tout panoramique à
// (0,0) par le containment NATIF de Panzoom (contain:"outside"), même
// un appel direct. On simule un contenu bien plus grand que le
// conteneur (cas réel une fois zoomé), condition nécessaire pour
// qu'un panoramique ait une vraie marge de manœuvre à tester.
svg13.getBoundingClientRect = () => ({ x: -600, y: -300, left: -600, top: -300, right: 1000, bottom: 700, width: 1600, height: 1000 });
dom.window.document.getElementById("dashboards-viewport").getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400 });
win.eval("dashboardsPanzoom.zoom(4, { animate: false })");
win.eval("dashboardsPanzoom.pan(0, 0, { animate: false })");

function firePanzoomPan13(win, el, x, y) {
  el.dispatchEvent(new win.CustomEvent("panzoompan", { detail: { x, y, scale: 4, isSVG: true }, bubbles: true }));
}
svg13.dispatchEvent(new win.CustomEvent("panzoomstart", { detail: {}, bubbles: true }));
firePanzoomPan13(win, svg13, 0, 0);
firePanzoomPan13(win, svg13, -40, 0);
firePanzoomPan13(win, svg13, -90, 0);
firePanzoomPan13(win, svg13, -150, 0); // vitesse nette suffisante pour un coast net

const panBeforeEnd13 = win.eval("dashboardsPanzoom.getPan().x");
svg13.dispatchEvent(new win.CustomEvent("panzoomend", { detail: {}, bubbles: true }));
setTimeout(() => {
  const panAfterCoast13 = win.eval("dashboardsPanzoom.getPan().x");
  console.log("Le panoramique continue bien tout seul après le relâché (inertie) (attendu true) :", panAfterCoast13 < panBeforeEnd13);

  // Un panoramique lent (quasi immobile) ne doit déclencher AUCUNE
  // inertie. Un vrai délai (setTimeout), pas juste 2 dispatches
  // synchrones consécutifs : sans lui, l'écart de temps entre les 2
  // échantillons est quasi nul et imprévisible (sous la milliseconde),
  // ce qui peut faire ressortir une vitesse calculée ÉNORME (delta
  // minuscule divisé par un temps quasi nul) au lieu de petite —
  // instable d'une exécution à l'autre, pas un vrai bug produit.
  win.eval("dashboardsPanzoom.pan(0, 0, { animate: false })");
  svg13.dispatchEvent(new win.CustomEvent("panzoomstart", { detail: {}, bubbles: true }));
  firePanzoomPan13(win, svg13, 0, 0);
  setTimeout(() => {
  firePanzoomPan13(win, svg13, -1, 0);
  const panBeforeEnd132 = win.eval("dashboardsPanzoom.getPan().x");
  svg13.dispatchEvent(new win.CustomEvent("panzoomend", { detail: {}, bubbles: true }));
  setTimeout(() => {
    const panAfterEnd132 = win.eval("dashboardsPanzoom.getPan().x");
    console.log("Un relâché quasi immobile ne déclenche PAS d'inertie (attendu true) :", panAfterEnd132 === panBeforeEnd132);

    // Démarrer un NOUVEAU panoramique doit couper une inertie en cours.
    win.eval("dashboardsPanzoom.pan(0, 0, { animate: false })");
    svg13.dispatchEvent(new win.CustomEvent("panzoomstart", { detail: {}, bubbles: true }));
    firePanzoomPan13(win, svg13, 0, 0);
    firePanzoomPan13(win, svg13, -150, 0);
    svg13.dispatchEvent(new win.CustomEvent("panzoomend", { detail: {}, bubbles: true }));
    setTimeout(() => {
      svg13.dispatchEvent(new win.CustomEvent("panzoomstart", { detail: {}, bubbles: true })); // coupe le coast en cours
      const panAtInterrupt13 = win.eval("dashboardsPanzoom.getPan().x");
      setTimeout(() => {
        const panAfterInterrupt13 = win.eval("dashboardsPanzoom.getPan().x");
        console.log("Démarrer un nouveau panoramique coupe bien l'inertie en cours (attendu true) :", panAfterInterrupt13 === panAtInterrupt13);
        // Le double-tap doit aussi couper une inertie en cours (retour
        // de stopMomentum() dans toggleZoomAt, réajouté avec l'inertie).
        runTest14(); // séquencement explicite (retour d'expérience : jamais de code synchrone en parallèle d'une chaîne async réelle — voir le commentaire de runTests12And13 plus haut, même souci de timing)
      }, 50);
    }, 30);
  }, 50);
  }, 50);
}, 50);

function runTest14() {
section("Test 14 — Répartition globale à l'écran (retour de Mayrik) : colonne flexible pleine hauteur, chaque zone calée sans espace mort");

dom = makeDom();
win = dom.window;
win.newGame();
win.render();

const metaViewport14 = dom.window.document.querySelector('meta[name="viewport"]');
console.log("La balise viewport contient bien viewport-fit=cover (retour de Mayrik : bande noire inutilisée en haut de l'écran) (attendu true) :",
  metaViewport14.getAttribute("content").includes("viewport-fit=cover"));

const wrapCss14 = dom.window.getComputedStyle(dom.window.document.getElementById("wrap"));
console.log("#wrap est bien une colonne flexible (attendu true) :", wrapCss14.display === "flex" && wrapCss14.flexDirection === "column");
console.log("...remplissant 100dvh (dynamic viewport height, plus fiable que 100vh sur mobile) (attendu true) :", wrapCss14.height === "100dvh");

const infoBandCss14 = dom.window.getComputedStyle(dom.window.document.getElementById("info-band"));
console.log("#info-band est bien flex:1 (absorbe tout l'espace restant entre le curseur et les dashboards) (attendu true) :", infoBandCss14.flexGrow === "1");

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

console.log("\n=== Fin des tests dédiés (mise en page 3 zones + zoom) ===");
} // fin de runTest14()
