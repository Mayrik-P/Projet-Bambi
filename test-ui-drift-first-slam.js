/**
 * Test jsdom dédié — correctif Drift (retour de Mayrik, 28/08) : côté
 * tour HUMAIN réel (clics), Drift doit protéger le PREMIER véhicule
 * croisé quand le mouvement continue ensuite, jamais quand le tour se
 * termine dans cette case-là. Sur le vrai bundle navigateur.
 * À lancer avec : node test-ui-drift-first-slam.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "tools", "prototype.html"), "utf8");

function section(title) { console.log("\n=== " + title + " ==="); }
function makeDom() { return new JSDOM(html, { runScripts: "dangerously", resources: "usable" }); }

function clearHazardsAround(win, board, col, row) {
  win.getSpace(board, col, row).hazard = null;
  const front = win.getFrontArc({ col, row });
  const rear = win.getRearArc({ col, row });
  for (const { col: c, row: r } of [...front, ...rear]) {
    const cell = win.getSpace(board, c, r);
    if (cell) cell.hazard = null;
  }
}

section("Test 1 (UI, vrai bundle) — Drift, tour humain réel : traverse le 1er véhicule, slamme le 2e (case finale)");

let dom = makeDom();
let win = dom.window;
win.newGame();
const HUMAN = win.eval("HUMAN");
const OPPONENT = win.eval("OPPONENT");
const CAR_SIZE = win.eval("CAR_SIZE");
let G = win.eval("G");
G.allCars.length = 0;
const b = win.board();
clearHazardsAround(win, b, 3, 3);
clearHazardsAround(win, b, 4, 3);

const myCar = win.createCar(HUMAN, CAR_SIZE.SMALL, 2, 3);
const firstBlocker = win.createCar(OPPONENT, CAR_SIZE.SMALL, 3, 3);
const secondBlocker = win.createCar(OPPONENT, CAR_SIZE.LARGE, 4, 3);
G.allCars.push(myCar, firstBlocker, secondBlocker);

let sel = win.eval("sel");
sel.mode = "assign";
sel.commandAvailable = false;
sel.car = myCar;
sel.dieValue = 2;
sel.slamOptions = { decideReroll: win.decideSlamRerollDefault, driftAvailable: true };
sel.remaining = 2;
sel.roadEligible = true;
sel.hadSlam = false;
sel.hadDamage = false;
sel.roadBonusOffered = false;
sel.inRoadBonus = false;
sel.step = "move-step";

// Pas 1/2 : entre dans la case du 1er bloqueur — doit traverser SANS
// slammer (Drift), le mouvement doit continuer normalement.
win.pickMoveStep({ direction: "front", col: 3, row: 3, outcome: "normal", cost: 1 });
sel = win.eval("sel");
console.log("Après le 1er pas : pas de pause de relance (attendu true, Drift a traversé sans Slam) :", sel.step !== "slam-reroll-choice");
console.log("La voiture a bien avancé jusqu'à la case du 1er bloqueur (attendu 3) :", myCar.col);
console.log("Il reste bien 1 point de mouvement (attendu 1) :", sel.remaining);

// Pas 2/2 : entre dans la case du 2e bloqueur (case finale, remaining
// tombera à 0 ensuite) — DOIT slammer malgré Drift toujours actif.
// (secondBlocker appartient à l'IA, donc pas de pause attendue ici —
// le tour se termine directement ; on vérifie via le log qu'un VRAI
// Slam a bien eu lieu sur cette case, pas une traversée Drift.)
win.pickMoveStep({ direction: "front", col: 4, row: 3, outcome: "slam", cost: 1 });
const fullLog = win.eval("fullLog");
const recentLines = fullLog.slice(-15).filter((e) => e.line).map((e) => e.line).join(" | ");
console.log("Un vrai SLAM a bien eu lieu sur la case finale malgré Drift (attendu true) :", recentLines.includes("SLAM") || recentLines.includes("Dé de slam"));
console.log("Aucune 2e traversée Drift n'a eu lieu sur cette case (attendu true) :", !recentLines.includes(`${myCar.id} traverse la case de ${secondBlocker.id} sans la slammer`));

console.log("\n=== Fin du test UI dédié (correctif Drift) ===");
