/**
 * Test jsdom dédié — RYTHME DES ANIMATIONS (chantier 4a), sur le vrai
 * bundle navigateur.
 *
 * Ce qui est vérifié ici, et qui n'existait pas avant ce chantier :
 *   1. la table de vitesses partagée (lent/moyen/rapide) et son point
 *      d'entrée setPaceSpeed(), prêt pour le futur menu Settings ;
 *   2. LE CŒUR DU CHANTIER : le jeu n'avance plus tant qu'une animation
 *      est en vol. Le test inscrit une animation factice qu'il contrôle
 *      lui-même, et vérifie que le tour de l'IA reste bloqué tant qu'il
 *      ne l'a pas libérée ;
 *   3. le gel de l'interface pendant une scène (plus aucune case
 *      cliquable, voile anti-clic posé) ;
 *   4. la non-régression hors navigateur : sans requestAnimationFrame,
 *      aucune animation n'existe, donc plus rien n'attend et tous les
 *      chemins restent aussi synchrones qu'avant.
 *
 * À lancer avec : node test-ui-rythme.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "tools", "prototype.html"), "utf8");

function section(title) { console.log("\n=== " + title + " ==="); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// pretendToBeVisual décide de la présence de requestAnimationFrame,
// donc de l'existence même des animations (voir scenePeutAnimer).
function makeDom(visuel) {
  return new JSDOM(html, { runScripts: "dangerously", resources: "usable", pretendToBeVisual: !!visuel });
}

// jsdom n'ouvre localStorage que sur une vraie origine : sans `url`,
// la page est en "about:blank" (origine opaque) et le moindre accès
// lève une exception — c'est d'ailleurs pourquoi tous les accès au
// stockage sont gardés par un try/catch dans ui-script.js. Le test de
// mémorisation a donc besoin de sa propre fenêtre, avec une origine.
function makeDomAvecStockage() {
  return new JSDOM(html, {
    runScripts: "dangerously",
    url: "https://mayrik-p.github.io/Projet-Bambi/tools/prototype.html"
  });
}

function clearHazardsAround(win, board, cells) {
  for (const { col, row } of cells) {
    const cell = win.getSpace(board, col, row);
    if (cell) cell.hazard = null;
  }
}

async function main() {
  section("Test 1 — Table de vitesses partagée (futur menu Settings)");

  const domV = makeDom(true);
  const winV = domV.window;
  winV.newGame();

  console.log("Vitesse par défaut = 500 ms (attendu true) :", winV.eval("PACE_MS") === 500);
  console.log("Nom de la vitesse par défaut = 'medium' (attendu true) :", winV.currentPaceSpeed() === "medium");
  console.log("setPaceSpeed('slow') → 900 ms (attendu true) :",
    winV.setPaceSpeed("slow") === true && winV.eval("PACE_MS") === 900);
  console.log("setPaceSpeed('fast') → 200 ms (attendu true) :",
    winV.setPaceSpeed("fast") === true && winV.eval("PACE_MS") === 200);
  console.log("setPaceSpeed('turbo') refusé, vitesse inchangée (attendu true) :",
    winV.setPaceSpeed("turbo") === false && winV.eval("PACE_MS") === 200);
  console.log("setPaceSpeed('medium') revient à 500 ms (attendu true) :",
    winV.setPaceSpeed("medium") === true && winV.eval("PACE_MS") === 500);

  section("Test 2 — Le tour de l'IA attend la fin des animations (cœur du chantier 4a)");

  const dom = makeDom(true);
  const win = dom.window;
  win.newGame();
  win.eval("PACE_MS = 10"); // battement réduit : ce test mesure l'attente des ANIMATIONS, pas le battement

  const HUMAN = win.eval("HUMAN");
  const OPPONENT = win.eval("OPPONENT");
  const CAR_SIZE = win.eval("CAR_SIZE");
  const G = win.eval("G");
  G.allCars.length = 0;
  const b = win.board();
  clearHazardsAround(win, b, [{ col: 4, row: 3 }, { col: 5, row: 3 }, { col: 6, row: 3 }]);
  const aiCar = win.createCar(OPPONENT, CAR_SIZE.SMALL, 3, 3);
  G.allCars.push(aiCar);
  G.roundState.dicePool[OPPONENT] = [3, 4, 4, 1];
  G.roundState.currentPlayerIndex = G.roundState.playerOrder.indexOf(OPPONENT);

  const decision = { car: aiCar, dieValue: 3, command: null, isEntry: false, isCoast: false, destination: { path: ["front", "front", "front"] }, slam: null, roadBonusPath: null };
  const gen = win.executeDecisionGen(G.progressionState, G.roundState, G.allCars, G.allChoppers, win.eval("PLAYER_NAMES"), OPPONENT, decision, {
    isHumanOwner: (owner) => owner === HUMAN,
    emitSteps: true
  });

  // Animation factice inscrite au registre AVANT le lancement : elle
  // tient lieu de dé encore en vol, et c'est le test qui décide quand
  // elle se termine.
  let libererAnimation;
  const animationBloquante = new Promise((r) => { libererAnimation = r; });
  win.suivreAnimation(animationBloquante);

  win.driveAiTurnGenerator(gen, "Test rythme", decision);
  const colApresPremierPas = aiCar.col;

  await sleep(150); // largement plus que le battement (10 ms) : seule l'animation peut encore retenir le tour
  console.log("Le tour reste bloqué tant que l'animation vole (attendu true) :",
    aiCar.col === colApresPremierPas && aiCar.col < 6);
  console.log("Le tour est toujours marqué en cours (attendu true) :", win.eval("G").aiAnimating === true);

  libererAnimation();
  await sleep(400);
  console.log("Une fois l'animation terminée, le tour reprend et s'achève en (col 6, row 3) (attendu true) :",
    aiCar.col === 6 && aiCar.row === 3);
  console.log("G.aiAnimating est repassé à false (attendu true) :", win.eval("G").aiAnimating === false);

  section("Test 3 — Gel de l'interface pendant une scène");

  const dom3 = makeDom(true);
  const win3 = dom3.window;
  win3.newGame();
  win3.eval("PACE_MS = 10");
  const G3 = win3.eval("G");
  G3.allCars.length = 0;
  const b3 = win3.board();
  clearHazardsAround(win3, b3, [{ col: 4, row: 3 }, { col: 4, row: 2 }, { col: 4, row: 4 }]);
  const humanCar = win3.createCar(HUMAN, CAR_SIZE.SMALL, 3, 3);
  G3.allCars.push(humanCar);
  win3.eval("sel = { step: 'move-step', car: G.allCars[0], remaining: 3 }");

  const casesAvant = win3.highlightedCells().length;
  console.log("Des cases sont bien cliquables avant le gel (attendu true) :", casesAvant > 0);

  let libererAnimation3;
  const animationBloquante3 = new Promise((r) => { libererAnimation3 = r; });
  win3.suivreAnimation(animationBloquante3);

  const gele = win3.gelerPendantLaScene();
  console.log("gelerPendantLaScene() signale un gel réel (attendu true) :", gele === true);
  console.log("G.uiLocked est passé à true (attendu true) :", win3.eval("G").uiLocked === true);
  console.log("Plus aucune case n'est cliquable pendant le gel (attendu true) :", win3.highlightedCells().length === 0);
  console.log("Le voile anti-clic est en place (attendu true) :", !!win3.document.getElementById("input-shield"));

  libererAnimation3();
  await sleep(400);
  console.log("Le gel est levé une fois la scène terminée (attendu true) :", win3.eval("G").uiLocked === false);
  console.log("Le voile anti-clic a disparu (attendu true) :", !win3.document.getElementById("input-shield"));
  console.log("Les cases redeviennent cliquables (attendu true) :", win3.highlightedCells().length === casesAvant);

  section("Test 4 — Non-régression hors navigateur : sans animation, rien n'attend jamais");

  const dom4 = makeDom(false); // pas de requestAnimationFrame : aucune animation ne peut exister
  const win4 = dom4.window;
  win4.newGame();
  win4.suivreAnimation(new Promise(() => {})); // promesse jamais résolue : elle ne doit bloquer personne

  console.log("scenePeutAnimer() est faux sans requestAnimationFrame (attendu true) :", win4.scenePeutAnimer() === false);
  console.log("animationsEnAttente() reste faux (attendu true) :", win4.animationsEnAttente() === false);
  console.log("attendreAnimations() rend null, donc les pilotes restent synchrones (attendu true) :", win4.attendreAnimations() === null);
  console.log("gelerPendantLaScene() ne gèle rien (attendu true) :",
    win4.gelerPendantLaScene() === false && win4.eval("G").uiLocked === false);

  section("Test 5 — Choix de la vitesse par bouton sur l'écran d'accueil");

  const dom5 = makeDomAvecStockage();
  const win5 = dom5.window;
  const boutons = () => Array.from(win5.document.querySelectorAll(".pace-btn"));

  console.log("Les trois boutons de vitesse existent (attendu true) :", boutons().length === 3);
  console.log("Le bouton actif au chargement est la vitesse en cours (attendu true) :",
    boutons().filter((b) => b.classList.contains("selected")).map((b) => b.dataset.pace).join() === "medium");

  boutons().find((b) => b.dataset.pace === "fast").click();
  console.log("Un clic sur 'Rapide' applique 200 ms (attendu true) :", win5.eval("PACE_MS") === 200);
  console.log("Le bouton actif a suivi, et lui seul (attendu true) :",
    boutons().filter((b) => b.classList.contains("selected")).map((b) => b.dataset.pace).join() === "fast");
  console.log("Le choix est mémorisé pour les prochaines sessions (attendu true) :",
    win5.localStorage.getItem(win5.eval("PACE_STORAGE_KEY")) === "fast");

  // Le bouton fixe la vitesse, il ne lance pas la partie : c'est le
  // choix du nombre d'IA qui démarre, avec la vitesse retenue.
  console.log("Aucune partie lancée par ce clic, l'écran d'accueil reste visible (attendu true) :",
    win5.document.getElementById("start-screen").style.display !== "none");
  win5.document.querySelector('.opponent-btn[data-ai-count="2"]').click();
  console.log("La partie démarre bien avec la vitesse choisie (attendu true) :",
    win5.eval("PACE_MS") === 200 && win5.document.getElementById("start-screen").style.display === "none");

  win5.eval("setPaceSpeed('medium')");
  win5.initPaceFromStorage();
  console.log("Au chargement suivant, la vitesse mémorisée est restaurée (attendu true) :",
    win5.currentPaceSpeed() === "fast" && win5.eval("PACE_MS") === 200);

  console.log("\n=== Fin des tests dédiés (rythme des animations, 4a) ===");
}

main();
