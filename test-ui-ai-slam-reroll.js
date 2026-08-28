/**
 * Test jsdom dédié — chantier "chaîne mouvement" (générateurs JS),
 * volet UI : vérifie que le prototype navigateur réel (tools/prototype.html,
 * régénéré via node tools/build-bundle.js) propose bien la relance de
 * Slam (p.9) au joueur humain quand un Slam survient PENDANT le tour
 * de l'IA et implique une voiture DU JOUEUR plus grande — via de VRAIS
 * clics simulés sur le DOM, jamais une relecture du JS.
 * À lancer avec : node test-ui-ai-slam-reroll.js
 */

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "tools", "prototype.html"), "utf8");

function section(title) {
  console.log("\n=== " + title + " ===");
}

function makeDom() {
  const dom = new JSDOM(html, { runScripts: "dangerously", resources: "usable" });
  return dom;
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

// Neutralise le hazard face cachée de (col,row) ET de ses 6 voisins
// (arc avant + arc arrière) — nécessaire pour rendre déterministe un
// scénario de Slam sur les vraies tuiles (sinon la voiture percutée,
// projetée dans une direction aléatoire, peut révéler un second
// hazard et déclencher un Slam EN CHAÎNE, hors du périmètre précis de
// ce test — ce cas est couvert séparément par
// test-slam-reroll-generators.js).
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
// TEST 1 — Slam DIRECT pendant le tour de l'IA, occupant humain plus
// grand : le clic "Jouer le tour de l'IA" doit faire apparaître le
// prompt de relance, PAS terminer le tour silencieusement.
// -----------------------------------------------------------------
section("Test 1 (UI, vrai bundle) — Slam direct pendant le tour IA, adversaire humain plus grand → prompt affiché");

let dom = makeDom();
let win = dom.window;
win.newGame();

// Construit le scénario directement sur l'état réel du jeu (mêmes
// fonctions globales que le bundle utilise partout ailleurs) : une
// petite voiture IA prête à avancer d'une case sur une grande voiture
// humaine déjà présente juste devant elle.
// NOTE jsdom : les bindings `let`/`const` de haut niveau (G, HUMAN,
// OPPONENT, CAR_SIZE, TERRAIN, PLAYER_NAMES, fullLog...) ne sont PAS
// exposés comme propriétés de `window` (contrairement aux fonctions
// déclarées par `function ...`, qui le sont) — on y accède donc via
// win.eval(), qui s'exécute dans le même scope global que les
// <script> du document.
const HUMAN = win.eval("HUMAN");
const OPPONENT = win.eval("OPPONENT");
const CAR_SIZE = win.eval("CAR_SIZE");
const PLAYER_NAMES = win.eval("PLAYER_NAMES");
const G = win.eval("G");
const b = win.board();
G.allCars.length = 0;
// Neutralise tout hazard face cachée qui pourrait, par hasard, être
// placé sur la case de destination (4,3) OU une case adjacente sur
// ces vraies tuiles — le scénario testé ici porte sur LE PREMIER
// Slam, pas sur un hazard qui interromprait le mouvement avant même
// d'atteindre l'occupant, ni sur un Slam EN CHAÎNE (déjà couvert par
// test-slam-reroll-generators.js) qui rendrait ce test non
// déterministe (la voiture percutée peut partir dans 6 directions).
clearHazardsAround(win, b, 4, 3);
const aiCar = win.createCar(OPPONENT, CAR_SIZE.SMALL, 3, 3);
const humanCar = win.createCar(HUMAN, CAR_SIZE.LARGE, 4, 3);
aiCar.movedThisRound = false;
humanCar.movedThisRound = false;
G.allCars.push(aiCar, humanCar);
// S'assurer que la case de destination existe et n'est pas impassable.
console.log("Case (4,3) existe et n'est pas impassable (pré-requis du scénario) :", !!win.getSpace(b, 4, 3) && win.getSpace(b, 4, 3).terrain !== win.eval("TERRAIN").IMPASSABLE);

// Force artificiellement le tour de l'IA à jouer EXACTEMENT ce
// mouvement (plutôt que de dépendre de l'heuristique ai-decision.js,
// qui ne choisirait pas forcément ce coup précis) : on appelle
// directement le même mécanisme que playAiTurn(), avec une décision
// construite à la main.
G.roundState.dicePool[OPPONENT] = [1, 2, 3, 4];
G.roundState.currentPlayerIndex = G.roundState.playerOrder.indexOf(OPPONENT);
const decision = {
  car: aiCar,
  dieValue: 1,
  command: null,
  isEntry: false,
  isCoast: false,
  destination: { path: ["front"] },
  slam: null,
  roadBonusPath: null
};
const gen = win.executeDecisionGen(G.progressionState, G.roundState, G.allCars, G.allChoppers, PLAYER_NAMES, OPPONENT, decision, {
  isHumanOwner: (owner) => owner === HUMAN
});
win.driveAiTurnGenerator(gen, "Test — tour IA");

console.log("G.aiPending bien renseigné après la pause (attendu true) :", !!G.aiPending);
console.log("Le panneau affiche bien le mot SLAM (attendu true) :", panelText(dom).includes("SLAM"));
console.log("Le panneau affiche bien les deux boutons de choix (attendu true) :",
  panelText(dom).includes("relancer") && panelText(dom).includes("garder ce résultat"));

// Clique VRAIMENT sur "Non, garder ce résultat".
clickButtonContaining(dom, "Non, garder ce résultat");

console.log("G.aiPending nettoyé après la réponse (attendu true) :", G.aiPending === null);
console.log("Le tour de l'IA a bien été journalisé (attendu true) :",
  win.eval("fullLog").some((entry) => entry.line && entry.line.includes("END OF TURN")));
console.log("Panneau revenu à l'état normal, plus de prompt de relance (attendu true) :",
  !panelText(dom).includes("relancer"));

// -----------------------------------------------------------------
// TEST 2 — Même scénario, réponse "Oui, relancer" : le log doit bien
// mentionner la relance ET refléter le nouveau lancer.
// -----------------------------------------------------------------
section("Test 2 (UI, vrai bundle) — Slam direct pendant le tour IA, réponse 'Oui, relancer'");

dom = makeDom();
win = dom.window;
win.newGame();
const G2 = win.eval("G");
G2.allCars.length = 0;
clearHazardsAround(win, win.board(), 4, 3);
const aiCar2 = win.createCar(OPPONENT, CAR_SIZE.SMALL, 3, 3);
const humanCar2 = win.createCar(HUMAN, CAR_SIZE.LARGE, 4, 3);
G2.allCars.push(aiCar2, humanCar2);
G2.roundState.dicePool[OPPONENT] = [1, 2, 3, 4];
G2.roundState.currentPlayerIndex = G2.roundState.playerOrder.indexOf(OPPONENT);
const decision2 = { car: aiCar2, dieValue: 1, command: null, isEntry: false, isCoast: false, destination: { path: ["front"] }, slam: null, roadBonusPath: null };
const gen2 = win.executeDecisionGen(G2.progressionState, G2.roundState, G2.allCars, G2.allChoppers, PLAYER_NAMES, OPPONENT, decision2, {
  isHumanOwner: (owner) => owner === HUMAN
});
win.driveAiTurnGenerator(gen2, "Test — tour IA 2");
console.log("Pause obtenue (attendu true) :", !!G2.aiPending);

clickButtonContaining(dom, "Oui, relancer");

console.log("G2.aiPending nettoyé après la réponse (attendu true) :", G2.aiPending === null);
console.log("Le log mentionne bien la demande de relance (attendu true) :",
  win.eval("fullLog").some((entry) => entry.line && entry.line.includes("demande la relance")));

// -----------------------------------------------------------------
// TEST 3 — NON-RÉGRESSION : Slam pendant le tour IA où c'est l'IA qui
// est plus grande → aucune pause, le tour se termine directement sur
// un seul clic (comportement inchangé, comme avant ce chantier).
// -----------------------------------------------------------------
section("Test 3 (UI, vrai bundle) — Slam direct pendant le tour IA, IA plus grande → PAS de pause (non-régression)");

dom = makeDom();
win = dom.window;
win.newGame();
const G3 = win.eval("G");
G3.allCars.length = 0;
clearHazardsAround(win, win.board(), 4, 3);
const aiCar3 = win.createCar(OPPONENT, CAR_SIZE.LARGE, 3, 3);
const humanCar3 = win.createCar(HUMAN, CAR_SIZE.SMALL, 4, 3);
G3.allCars.push(aiCar3, humanCar3);
G3.roundState.dicePool[OPPONENT] = [1, 2, 3, 4];
G3.roundState.currentPlayerIndex = G3.roundState.playerOrder.indexOf(OPPONENT);
const decision3 = { car: aiCar3, dieValue: 1, command: null, isEntry: false, isCoast: false, destination: { path: ["front"] }, slam: null, roadBonusPath: null };
const gen3 = win.executeDecisionGen(G3.progressionState, G3.roundState, G3.allCars, G3.allChoppers, PLAYER_NAMES, OPPONENT, decision3, {
  isHumanOwner: (owner) => owner === HUMAN
});
win.driveAiTurnGenerator(gen3, "Test — tour IA 3");

console.log("Aucune pause (attendu true) :", G3.aiPending === null);
console.log("Tour terminé directement, journalisé (attendu true) :",
  win.eval("fullLog").some((entry) => entry.line && entry.line.includes("END OF TURN")));

console.log("\n=== Fin des tests UI dédiés (chantier générateurs) ===");

// -----------------------------------------------------------------
// TEST 5 — Étape 2 (chaîne tir/dégâts) : pause déclenchée par un tir
// → dégât Dazed → cascade → Slam contre une voiture humaine plus
// grande, pilotée via le MÊME driveAiTurnGenerator/G.aiPending que
// pour un Slam direct — preuve que le mécanisme générique (agnostique
// de la CAUSE du Slam) fonctionne aussi côté UI réelle, sans aucun
// câblage supplémentaire dans tools/ui-script.js.
// -----------------------------------------------------------------
section("Test 5 (UI, vrai bundle) — Tir → dégât Dazed → cascade → Slam contre voiture humaine plus grande → prompt affiché");

dom = makeDom();
win = dom.window;
win.newGame();
const G5 = win.eval("G");
G5.allCars.length = 0;
const TOKEN_TYPES = win.eval("TOKEN_TYPES");
const shooter5 = win.createCar(OPPONENT, CAR_SIZE.MEDIUM, 2, 3);
const dazedTarget5 = win.createCar(OPPONENT, CAR_SIZE.SMALL, 3, 3);
const humanBigCar5 = win.createCar(HUMAN, CAR_SIZE.LARGE, 4, 3);
G5.allCars.push(shooter5, dazedTarget5, humanBigCar5);
const b5 = win.board();
clearHazardsAround(win, b5, 3, 3);
clearHazardsAround(win, b5, 4, 3);
G5.roundState.currentPlayerIndex = G5.roundState.playerOrder.indexOf(OPPONENT);

const gen5 = win.resolveShootGen(b5, G5.allCars, shooter5, dazedTarget5, {
  forcedDice: { shootingDie: "small-medium", dazedStunt: 1, dazedDirections: ["front"] },
  tokenType: TOKEN_TYPES.DAZED,
  isHumanOwner: (owner) => owner === HUMAN
});
win.driveAiTurnGenerator(gen5, "Test — tir + Dazed");

console.log("Pause obtenue (attendu true) :", !!G5.aiPending);
console.log("Panneau affiche SLAM (attendu true) :", panelText(dom).includes("SLAM"));
clickButtonContaining(dom, "Non, garder ce résultat");
console.log("G5.aiPending nettoyé après la réponse (attendu true) :", G5.aiPending === null);
console.log("Le tir/dégât a bien été journalisé (attendu true) :",
  win.eval("fullLog").some((entry) => entry.line && entry.line.includes("Touché")));

console.log("\n=== Fin des tests UI dédiés (étape 2 incluse) ===");
