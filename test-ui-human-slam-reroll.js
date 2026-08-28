/**
 * Test jsdom dédié — nettoyage du hack de prévisualisation Wreck
 * (buildPredictedSlamOpponent/matchesPreviewedSlam, tools/ui-script.js,
 * retiré) : le PROPRE tour du joueur humain utilise désormais le même
 * mécanisme générique de pause/reprise par générateurs que le tour de
 * l'IA (executeMoveStepGen/executeEntryStepGen/executeShootGen +
 * driveHumanStepGenerator), sur le vrai bundle navigateur régénéré,
 * avec de VRAIS clics simulés — jamais une relecture du JS.
 * À lancer avec : node test-ui-human-slam-reroll.js
 */

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "tools", "prototype.html"), "utf8");

function section(title) {
  console.log("\n=== " + title + " ===");
}

function makeDom() {
  return new JSDOM(html, { runScripts: "dangerously", resources: "usable" });
}

function clickButtonContaining(dom, text) {
  const buttons = [...dom.window.document.querySelectorAll("button")];
  const btn = buttons.find((b) => b.textContent.includes(text));
  if (!btn) throw new Error(`Bouton introuvable contenant : "${text}"`);
  btn.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
}

function panelText(dom) {
  return dom.window.document.getElementById("panel").textContent;
}

function clearHazardsAround(win, board, col, row) {
  win.getSpace(board, col, row).hazard = null;
  const front = win.getFrontArc({ col, row });
  const rear = win.getRearArc({ col, row });
  for (const { col: c, row: r } of [...front, ...rear]) {
    const cell = win.getSpace(board, c, r);
    if (cell) cell.hazard = null;
  }
}

// -----------------------------------------------------------------
// TEST 1 — Pendant le PROPRE tour du joueur, un pas de mouvement qui
// slamme une voiture DE L'IA (donc SA voiture à LUI est la plus
// grande) doit mettre la résolution en pause — exactement le même
// panneau que côté IA, sans aucune prévisualisation préalable.
// -----------------------------------------------------------------
section("Test 1 (UI, vrai bundle) — Pas de mouvement humain, Slam contre une voiture IA → voiture du joueur plus grande → prompt affiché");

let dom = makeDom();
let win = dom.window;
win.newGame();

const HUMAN = win.eval("HUMAN");
const OPPONENT = win.eval("OPPONENT");
const CAR_SIZE = win.eval("CAR_SIZE");
const G = win.eval("G");
G.allCars.length = 0;
const b = win.board();
clearHazardsAround(win, b, 4, 3);
const humanCar = win.createCar(HUMAN, CAR_SIZE.LARGE, 3, 3);
const aiCar = win.createCar(OPPONENT, CAR_SIZE.SMALL, 4, 3);
G.allCars.push(humanCar, aiCar);

// Reproduit l'état atteint normalement en cliquant Dé → Voiture →
// Valider (commitAssignAndCommand) — on le construit directement pour
// isoler précisément le pas de mouvement testé ici, comme le fait déjà
// test-ui-ai-slam-reroll.js pour le tour de l'IA.
let sel = win.eval("sel");
sel.mode = "assign";
sel.commandAvailable = false;
sel.car = humanCar;
sel.dieValue = 1;
sel.turnLabel = "Test — tour humain";
sel.slamOptions = { decideReroll: win.decideSlamRerollDefault };
sel.remaining = 1;
sel.roadEligible = true;
sel.hadSlam = false;
sel.hadDamage = false;
sel.roadBonusOffered = false;
sel.inRoadBonus = false;
sel.step = "move-step";

const option = { direction: "front", col: 4, row: 3, outcome: "slam", cost: 1 };
win.pickMoveStep(option);
win.render();

console.log("Une pause a bien été obtenue, sel.step est passé à slam-reroll-choice (attendu true) :", sel.step === "slam-reroll-choice");
console.log("Le panneau affiche bien le mot SLAM (attendu true) :", panelText(dom).includes("SLAM"));
console.log("Le panneau affiche bien les deux boutons de choix (attendu true) :",
  panelText(dom).includes("relancer") && panelText(dom).includes("garder ce résultat"));

clickButtonContaining(dom, "Non, garder ce résultat");
sel = win.eval("sel"); // resetSelection() RÉASSIGNE `sel` — il faut le relire, pas garder l'ancienne référence

console.log("sel.pendingHumanSlam nettoyé après la réponse (attendu true) :", sel.pendingHumanSlam === null || sel.pendingHumanSlam === undefined);
console.log("Le tour a bien avancé au-delà du prompt (attendu true — sel.step n'est plus slam-reroll-choice) :", sel.step !== "slam-reroll-choice");

// -----------------------------------------------------------------
// TEST 2 — Non-régression : Slam contre une voiture IA plus grande
// (donc PAS la voiture du joueur) pendant le PROPRE tour du joueur →
// aucune pause, politique IA appliquée directement.
// -----------------------------------------------------------------
section("Test 2 (UI, vrai bundle) — Pas de mouvement humain, Slam contre une voiture IA plus grande → PAS de pause (non-régression)");

dom = makeDom();
win = dom.window;
win.newGame();
const HUMAN2 = win.eval("HUMAN");
const OPPONENT2 = win.eval("OPPONENT");
const CAR_SIZE2 = win.eval("CAR_SIZE");
const G2 = win.eval("G");
G2.allCars.length = 0;
const b2 = win.board();
clearHazardsAround(win, b2, 4, 3);
const humanCar2 = win.createCar(HUMAN2, CAR_SIZE2.SMALL, 3, 3);
const aiCar2 = win.createCar(OPPONENT2, CAR_SIZE2.LARGE, 4, 3);
G2.allCars.push(humanCar2, aiCar2);

let sel2 = win.eval("sel");
sel2.mode = "assign";
sel2.commandAvailable = false;
sel2.car = humanCar2;
sel2.dieValue = 1;
sel2.turnLabel = "Test — tour humain 2";
sel2.slamOptions = { decideReroll: win.decideSlamRerollDefault };
sel2.remaining = 1;
sel2.roadEligible = true;
sel2.hadSlam = false;
sel2.hadDamage = false;
sel2.roadBonusOffered = false;
sel2.inRoadBonus = false;
sel2.step = "move-step";

const option2 = { direction: "front", col: 4, row: 3, outcome: "slam", cost: 1 };
win.pickMoveStep(option2);
sel2 = win.eval("sel"); // idem test 1 : re-fetch après coup (resetSelection() peut avoir réassigné `sel`)
win.render();

console.log("Aucune pause : sel.step n'est PAS slam-reroll-choice (attendu true) :", sel2.step !== "slam-reroll-choice");
console.log("Le panneau n'affiche PAS de prompt de relance (attendu true) :", !panelText(dom).includes("relancer"));

// -----------------------------------------------------------------
// TEST 3 — Slam révélé par un Wreck pendant le PROPRE mouvement du
// joueur, voiture du joueur plus grande que l'épave → doit aussi
// mettre en pause, sans AUCUN code de prévisualisation dédié au Wreck
// (contrairement à l'ancien hack, entièrement retiré).
// -----------------------------------------------------------------
section("Test 3 (UI, vrai bundle) — Pas de mouvement humain sur un Wreck, voiture du joueur plus grande → prompt affiché");

dom = makeDom();
win = dom.window;
win.newGame();
const HUMAN3 = win.eval("HUMAN");
const CAR_SIZE3 = win.eval("CAR_SIZE");
const HAZARD_TYPES3 = win.eval("HAZARD_TYPES");
const G3 = win.eval("G");
G3.allCars.length = 0;
const b3 = win.board();
clearHazardsAround(win, b3, 4, 3);
win.getSpace(b3, 4, 3).hazard = HAZARD_TYPES3.WRECK;
const humanCar3 = win.createCar(HUMAN3, CAR_SIZE3.MEDIUM, 3, 3);
G3.allCars.push(humanCar3);

let sel3 = win.eval("sel");
sel3.mode = "assign";
sel3.commandAvailable = false;
sel3.car = humanCar3;
sel3.dieValue = 1;
sel3.turnLabel = "Test — tour humain 3 (Wreck)";
sel3.slamOptions = { decideReroll: win.decideSlamRerollDefault };
sel3.remaining = 1;
sel3.roadEligible = true;
sel3.hadSlam = false;
sel3.hadDamage = false;
sel3.roadBonusOffered = false;
sel3.inRoadBonus = false;
sel3.step = "move-step";

// Un Wreck encore face cachée n'est jamais marqué outcome:"slam" par
// getMovementStepOptions (ce n'est pas un occupant visible) — outcome
// "normal" est donc la forme réelle que ce pas aurait dans le jeu.
const option3 = { direction: "front", col: 4, row: 3, outcome: "normal", cost: 1 };
win.pickMoveStep(option3);
win.render();

console.log("Une pause a bien été obtenue pour le Wreck (attendu true) :", sel3.step === "slam-reroll-choice");
console.log("Le panneau affiche bien le mot SLAM (attendu true) :", panelText(dom).includes("SLAM"));
clickButtonContaining(dom, "Non, garder ce résultat");
console.log("Épave bien ajoutée à allCars après résolution (attendu true) :", G3.allCars.some((c) => c.isWreck));

console.log("\n=== Fin des tests UI dédiés (nettoyage du hack Wreck, tour humain) ===");
