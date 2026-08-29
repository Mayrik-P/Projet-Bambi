/**
 * Test jsdom dédié — pause visuelle case par case pendant le tour de
 * l'IA (demande de Mayrik, 28/08), sur le vrai bundle navigateur, avec
 * de vrais délais (setTimeout réel, AI_STEP_DELAY_MS réduit pour la
 * rapidité du test plutôt que désactivé, afin d'exercer le VRAI
 * chemin setTimeout, pas un raccourci synchrone).
 * À lancer avec : node test-ui-ai-step-animation.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "tools", "prototype.html"), "utf8");

function section(title) { console.log("\n=== " + title + " ==="); }
function makeDom() { return new JSDOM(html, { runScripts: "dangerously", resources: "usable", pretendToBeVisual: true }); }
function panelText(dom) { return dom.window.document.getElementById("panel").textContent; }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function clearHazardsAround(win, board, cells) {
  for (const { col, row } of cells) {
    const cell = win.getSpace(board, col, row);
    if (cell) cell.hazard = null;
  }
}

async function main() {
  section("Test 1 — Clic sur 'Jouer le tour de l'IA' : le bouton se désactive immédiatement pendant l'animation");

  const dom = makeDom();
  const win = dom.window;
  win.newGame();
  win.eval("AI_STEP_DELAY_MS = 30"); // réduit pour la vitesse du test, mais RÉEL (pas 0) — exerce le vrai chemin setTimeout

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

  const colsSeenDuringAnimation = [];
  const originalRender = win.render;
  win.eval(`
    (function() {
      const orig = render;
      window.render = function() {
        orig();
        window.__colsSeen = window.__colsSeen || [];
      };
    })();
  `);

  win.driveAiTurnGenerator(gen, "Test animation");

  console.log("G.aiAnimating est bien passé à true dès le lancement (attendu true) :", win.eval("G").aiAnimating === true);
  console.log("Le bouton IA est désactivé pendant l'animation (attendu true) :", panelText(dom).includes("L'IA joue..."));
  console.log("La voiture n'a pas encore atteint sa destination finale (attendu true, col 3 ou 4 ou 5, pas 6) :", aiCar.col < 6);

  // Laisse le temps aux 3 pauses (30ms chacune) de s'écouler.
  await sleep(300);

  console.log("\nAprès l'animation complète :");
  console.log("La voiture est bien arrivée en (col 6, row 3) (attendu true) :", aiCar.col === 6 && aiCar.row === 3);
  console.log("G.aiAnimating est repassé à false (attendu true) :", win.eval("G").aiAnimating === false);
  console.log("Le bouton redevient cliquable, plus de 'L'IA joue...' (attendu true) :", !panelText(dom).includes("L'IA joue..."));

  section("Test 2 — Non-régression : sans emitSteps (via executeDecisionGen direct, comme avant), aucun setTimeout, résolution immédiate");

  const dom2 = makeDom();
  const win2 = dom2.window;
  win2.newGame();
  const G2 = win2.eval("G");
  G2.allCars.length = 0;
  const b2 = win2.board();
  clearHazardsAround(win2, b2, [{ col: 4, row: 3 }]);
  const aiCar2 = win2.createCar(OPPONENT, CAR_SIZE.SMALL, 3, 3);
  G2.allCars.push(aiCar2);
  G2.roundState.dicePool[OPPONENT] = [1, 4, 4, 1];
  G2.roundState.currentPlayerIndex = G2.roundState.playerOrder.indexOf(OPPONENT);
  const decision2 = { car: aiCar2, dieValue: 1, command: null, isEntry: false, isCoast: false, destination: { path: ["front"] }, slam: null, roadBonusPath: null };
  const gen2 = win2.executeDecisionGen(G2.progressionState, G2.roundState, G2.allCars, G2.allChoppers, win2.eval("PLAYER_NAMES"), OPPONENT, decision2, {
    isHumanOwner: (owner) => owner === HUMAN
    // pas de emitSteps : comportement d'avant cette fonctionnalité
  });
  win2.driveAiTurnGenerator(gen2, "Test non-régression");
  console.log("Résolu immédiatement, sans attendre (attendu true) :", aiCar2.col === 4);
  console.log("G2.aiAnimating jamais mis à true dans ce chemin (attendu true) :", G2.aiAnimating !== true);

  console.log("\n=== Fin des tests dédiés (animation case par case, IA) ===");
}

main();
