/**
 * tools/generate-review-cases.js — capture des cas pour la revue
 * qualitative dans le viewer visuel (assign-command-viewer-template.html).
 * ---------------------------------------------------------------
 * NOUVEAU SYSTÈME UNIQUEMENT (ai-decision.js) — plus aucune trace de
 * l'ancien ai-scoring.js, abandonné. Les parties sont jouées en
 * self-play RÉEL (les deux camps utilisent decideAssignAndCommand),
 * en réutilisant playOneShadowTurn de run-shadow-legality.js pour
 * l'exécution effective de chaque tour — jamais de logique
 * d'exécution dupliquée entre les deux outils.
 *
 * Pour chaque tour de Mayrik (round >= 2, pour éviter les tours
 * d'entrée du round 1 qui n'ont pas grand-chose à juger), on capture
 * un instantané COMPLET de l'état AVANT la décision, puis on appelle
 * decideAssignAndCommand nous-même pour avoir la décision à
 * enregistrer — avant de laisser playOneShadowTurn rejouer
 * EXACTEMENT le même tour pour de vrai (état non muté entre les deux
 * appels, donc décision strictement identique, aucune divergence
 * possible).
 */

"use strict";
const path = require("path");
const fs = require("fs");
const vm = require("vm");
const engine = require("../engine.js");
const ai = require("../ai-decision.js");
const { playOneShadowTurn, loadRealTiles } = require("./run-shadow-legality.js");

const { CAR_SIZE, createChopper, createCarOffBoard, createRoundState,
  buildBoardFromProgressionState, createTileProgressionState, setupTileProgressionFromRawData,
  ensureRoadDieRolled, getCurrentPlayer, checkGameEndConditions } = engine;

function collectCases(nWanted, maxAttemptsGames, maxTurnsPerGame) {
  const playerNames = ["Mayrik", "IA-Adverse"];
  const cases = [];
  const rawTiles = loadRealTiles();

  for (let g = 0; g < maxAttemptsGames && cases.length < nWanted; g++) {
    const setup = setupTileProgressionFromRawData(rawTiles, { playerCount: 2 });
    if (!setup.ok) continue;
    const progressionState = createTileProgressionState(setup.rearTile, setup.middleTile, setup.leadTile, setup.drawPile, { playerCount: 2 });
    const allCars = [];
    const allChoppers = [];
    for (const name of playerNames) {
      allChoppers.push(createChopper(name));
      allCars.push(createCarOffBoard(name, CAR_SIZE.SMALL));
      allCars.push(createCarOffBoard(name, CAR_SIZE.MEDIUM));
      allCars.push(createCarOffBoard(name, CAR_SIZE.LARGE));
    }
    const roundState = createRoundState(playerNames);
    let mayrikTurnsThisRound = 0;
    let lastRoundSeen = 0;
    const legalityLogIgnored = []; // playOneShadowTurn exige ce paramètre, non exploité ici

    for (let t = 0; t < maxTurnsPerGame && cases.length < nWanted; t++) {
      const cp = getCurrentPlayer(roundState);
      if (!cp) break;
      ensureRoadDieRolled(roundState);
      if (roundState.roundNumber !== lastRoundSeen) { mayrikTurnsThisRound = 0; lastRoundSeen = roundState.roundNumber; }

      if (cp === "Mayrik" && roundState.roundNumber >= 2) {
        mayrikTurnsThisRound += 1;
        const board = buildBoardFromProgressionState(progressionState);
        const poolSnapshot = [...(roundState.dicePool["Mayrik"] || [])];
        const carsSnapshot = allCars.map((c) => ({ ...c, damageTokens: [...c.damageTokens] }));
        const commandUsedBefore = !!roundState.commandUsedThisRound["Mayrik"];
        const finishLineActive = !!progressionState.finishLineTile;
        const decision = ai.decideAssignAndCommand(progressionState, board, allCars, allChoppers, roundState.dicePool, "Mayrik", roundState);
        if (decision) {
          cases.push({
            round: roundState.roundNumber,
            turnInRound: mayrikTurnsThisRound,
            commandUsedBeforeThisTurn: commandUsedBefore,
            finishLineActive,
            roadDie: roundState.roadDie,
            pool: poolSnapshot,
            cars: carsSnapshot,
            boardSnapshot: boardSnapshot(board),
            decision
          });
        }
      }

      // Exécution RÉELLE et identique à run-shadow-legality.js : le
      // nouveau système joue les DEUX camps, jamais l'ancien AI
      // interne simplifié de engine.js (chooseAiAssign/chooseAiCommand).
      playOneShadowTurn(progressionState, roundState, allCars, allChoppers, playerNames, legalityLogIgnored);

      const end = checkGameEndConditions(progressionState, allCars, allChoppers, playerNames);
      if (end && end.gameOver) break;
    }
  }
  return cases;
}

function boardSnapshot(board) {
  return {
    cols: board.cols, rows: board.rows,
    grid: board.grid.map((row) => row.map((cell) => ({
      terrain: cell.terrain,
      hazard: cell.hazard ? "hidden" : (cell.revealedHazard ? "revealed" : null)
    })))
  };
}

function classify(c) {
  const d = c.decision;
  if (d.isCoast) return "coast";
  if (d.isEntry) return "entry";
  if (d.command) return `command:${d.command.type}`;
  return c.finishLineActive ? "finish-line-rush:sans-command" : "mouvement-simple";
}

const RAW_POOL_TARGET = 900;
const rawCases = collectCases(RAW_POOL_TARGET, 250, 300);
console.log(`${rawCases.length} cas bruts collectés.\n`);

const rawTally = {};
rawCases.forEach((c) => { const k = classify(c); rawTally[k] = (rawTally[k] || 0) + 1; });
console.log("Répartition brute :", JSON.stringify(rawTally, null, 2));

// Sélection diversifiée : jusqu'à MAX_PER_TYPE cas de chaque type
// rencontré, pour que la revue qualitative couvre vraiment toutes
// les branches de l'arbre plutôt que sur-représenter les cas les
// plus fréquents en self-play (mouvement simple, Coast, Nitro).
const MAX_PER_TYPE = 6;
const perType = {};
const cases = [];
for (const c of rawCases) {
  const k = classify(c);
  perType[k] = perType[k] || 0;
  if (perType[k] >= MAX_PER_TYPE) continue;
  perType[k] += 1;
  cases.push(c);
}
console.log(`${cases.length} cas retenus après sélection diversifiée.\n`);

const exportCases = cases.map((c) => {
  const d = c.decision;
  const carClone = c.cars.find((x) => x.id === d.car.id);
  const targetClone = d.command && d.command.target ? (c.cars.find((x) => x.id === d.command.target.id) || d.command.target) : null;
  const shotTargetClone = d.shotTarget ? (c.cars.find((x) => x.id === d.shotTarget.id) || d.shotTarget) : null;
  return {
    round: c.round,
    turnInRound: c.turnInRound,
    commandUsedBeforeThisTurn: c.commandUsedBeforeThisTurn,
    finishLineActive: c.finishLineActive,
    roadDie: c.roadDie,
    pool: c.pool,
    board: c.boardSnapshot,
    cars: c.cars.map((x) => ({ id: x.id, owner: x.owner, size: x.size, col: x.col, row: x.row, status: x.status, damageCount: x.damageTokens.length, movedThisRound: x.movedThisRound, coastCount: x.coastCount })),
    activeCarId: carClone.id,
    dieValue: d.dieValue,
    isEntry: !!d.isEntry,
    isCoast: !!d.isCoast,
    slam: !!d.slam,
    destination: d.destination ? {
      col: d.destination.col,
      row: d.destination.row,
      terminalReason: d.destination.terminalReason,
      dangerousCellsCrossed: d.destination.dangerousCellsCrossed
    } : null,
    shotTargetId: shotTargetClone ? shotTargetClone.id : null,
    command: d.command ? { type: d.command.type, dieValue: d.command.dieValue, targetId: targetClone ? targetClone.id : null } : null
  };
});

fs.writeFileSync(path.join(__dirname, "review-cases.json"), JSON.stringify(exportCases));
console.log("review-cases.json écrit :", exportCases.length, "cas.");

// Assemble aussi directement le fichier HTML autonome (template +
// JSON embarqué), prêt à être ouvert sans étape supplémentaire.
const template = fs.readFileSync(path.join(__dirname, "assign-command-viewer-template.html"), "utf8");
const finalHtml = template.replace("__CASES_JSON__", JSON.stringify(exportCases));
fs.writeFileSync(path.join(__dirname, "review-cases.html"), finalHtml);
console.log("review-cases.html écrit (autonome, prêt à ouvrir).");
