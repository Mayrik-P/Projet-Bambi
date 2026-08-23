/**
 * tools/generate-full-game.js — génère une partie complète jouée en
 * self-play par 3 IA (decideAssignAndCommand pour les trois camps),
 * en capturant un instantané COMPLET de l'état après CHAQUE tour
 * individuel joué. Contrairement à generate-review-cases.js (qui
 * échantillonne des cas isolés pour juger une décision précise), cet
 * outil sert à revoir le DÉROULÉ ENTIER d'une partie, tour par tour,
 * pour juger la sensation de jeu dans son ensemble (rythme, tension,
 * lisibilité) plutôt qu'une décision isolée.
 *
 * Réutilise playOneShadowTurn de run-shadow-legality.js pour
 * l'exécution réelle de chaque tour — jamais de logique d'exécution
 * dupliquée entre les outils.
 */

"use strict";
const path = require("path");
const fs = require("fs");
const engine = require("../engine.js");
const ai = require("../ai-decision.js");
const { playOneShadowTurn, loadRealTiles } = require("./run-shadow-legality.js");

const {
  CAR_SIZE, createChopper, createCarOffBoard, createRoundState,
  buildBoardFromProgressionState, createTileProgressionState,
  setupTileProgressionFromRawData, ensureRoadDieRolled, getCurrentPlayer,
  checkGameEndConditions
} = engine;

const PLAYER_NAMES = ["IA-Bleue", "IA-Rouge", "IA-Verte"];
const MAX_TURNS = 400; // garde-fou, une partie normale se termine bien avant

function boardSnapshot(board) {
  return {
    cols: board.cols, rows: board.rows,
    grid: board.grid.map((row) => row.map((cell) => ({
      terrain: cell.terrain,
      hazard: cell.hazard ? "hidden" : (cell.revealedHazard ? "revealed" : null)
    })))
  };
}

function carsSnapshot(allCars) {
  return allCars.map((c) => ({
    id: c.id, owner: c.owner, size: c.size, col: c.col, row: c.row,
    status: c.status, damageCount: c.damageTokens.length
  }));
}

function choppersSnapshot(allChoppers) {
  return allChoppers
    .filter((ch) => ch.placed)
    .map((ch) => ({ id: ch.id, owner: ch.owner, col: ch.col, row: ch.row }));
}

function playFullGame() {
  const rawTiles = loadRealTiles();
  let setup, attempts = 0;
  do { setup = setupTileProgressionFromRawData(rawTiles); attempts++; } while (!setup.ok && attempts < 20);
  if (!setup.ok) throw new Error("Impossible d'initialiser la progression de tuiles : " + setup.reason);

  const progressionState = createTileProgressionState(setup.rearTile, setup.middleTile, setup.leadTile, setup.drawPile);
  const allCars = [];
  const allChoppers = [];
  for (const name of PLAYER_NAMES) {
    allChoppers.push(createChopper(name));
    allCars.push(createCarOffBoard(name, CAR_SIZE.SMALL));
    allCars.push(createCarOffBoard(name, CAR_SIZE.MEDIUM));
    allCars.push(createCarOffBoard(name, CAR_SIZE.LARGE));
  }
  const roundState = createRoundState(PLAYER_NAMES);
  const legalityLogIgnored = [];

  const turns = [];
  let winner = null, endReason = null;

  for (let t = 0; t < MAX_TURNS; t++) {
    const cp = getCurrentPlayer(roundState);
    if (!cp) break;
    ensureRoadDieRolled(roundState);

    const roundBefore = roundState.roundNumber;
    const poolBefore = [...(roundState.dicePool[cp] || [])];
    const commandUsedBefore = !!roundState.commandUsedThisRound[cp];
    const roadDie = roundState.roadDie;
    const finishLineActiveBefore = !!progressionState.finishLineTile;

    // La décision doit venir de l'EXÉCUTION RÉELLE (result.decision),
    // jamais d'un second appel séparé à decideAssignAndCommand : la
    // décision n'est pas garantie déterministe d'un appel à l'autre
    // (jets de dé internes à la résolution de trajectoire — Blast
    // Off, glissade Oil Slick, etc.), donc un recalcul "avant" peut
    // diverger de ce qui a réellement été joué. Bug constaté et
    // corrigé cette session : ~24% des tours affichaient la mauvaise
    // voiture/destination en surbrillance dans le viewer à cause de
    // cette double évaluation.
    const result = playOneShadowTurn(progressionState, roundState, allCars, allChoppers, PLAYER_NAMES, legalityLogIgnored);
    const decision = result.decision;

    const board = buildBoardFromProgressionState(progressionState);
    turns.push({
      turnIndex: turns.length,
      round: roundBefore,
      player: cp,
      roadDie,
      poolBefore,
      commandUsedBefore,
      finishLineActive: finishLineActiveBefore,
      log: result.log || [],
      board: boardSnapshot(board),
      cars: carsSnapshot(allCars),
      choppers: choppersSnapshot(allChoppers),
      decision: decision ? {
        activeCarId: decision.car.id,
        dieValue: decision.dieValue,
        isEntry: !!decision.isEntry,
        isCoast: !!decision.isCoast,
        command: decision.command ? { type: decision.command.type, dieValue: decision.command.dieValue, targetId: decision.command.target ? decision.command.target.id : null } : null,
        shotTargetId: decision.shotTarget ? decision.shotTarget.id : null,
        destination: decision.destination ? { col: decision.destination.col, row: decision.destination.row } : null
      } : null
    });

    const end = checkGameEndConditions(progressionState, allCars, allChoppers, PLAYER_NAMES);
    if (end && end.gameOver) { winner = end.winner; endReason = end.reason; break; }
  }

  return { turns, winner, endReason, playerNames: PLAYER_NAMES };
}

let game, tries = 0;
do { game = playFullGame(); tries++; } while (game.turns.length < 15 && tries < 10);

console.log(`Partie générée : ${game.turns.length} tours, vainqueur : ${game.winner || "aucun (limite atteinte)"} (${game.endReason || "n/a"}).`);

fs.writeFileSync(path.join(__dirname, "full-game.json"), JSON.stringify(game));
console.log("full-game.json écrit.");

const template = fs.readFileSync(path.join(__dirname, "full-game-viewer-template.html"), "utf8");
const finalHtml = template.replace("__GAME_JSON__", JSON.stringify(game));
fs.writeFileSync(path.join(__dirname, "full-game-viewer.html"), finalHtml);
console.log("full-game-viewer.html écrit (autonome, prêt à ouvrir).");
