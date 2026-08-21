"use strict";
const path = require("path");
const fs = require("fs");
const vm = require("vm");
const engine = require("../engine.js");
const ai = require("../ai-scoring.js");

const { CAR_SIZE, CAR_STATUS, createChopper, createCarOffBoard, createRoundState,
  buildBoardFromProgressionState, createTileProgressionState, setupTileProgressionFromRawData,
  ensureRoadDieRolled, getCurrentPlayer, advanceTurn, checkGameEndConditions,
  playOneAiTurn, TERRAIN } = engine;

function loadRealTiles() {
  const dir = path.join(__dirname, "..", "tiles", "data");
  return fs.readdirSync(dir).map((file) => {
    const code = fs.readFileSync(path.join(dir, file), "utf8");
    const varName = "TILE_VENDETTA_" + path.basename(file, ".js").replace("vendetta-", "").toUpperCase();
    const sandbox = { TERRAIN, module: { exports: null } };
    vm.createContext(sandbox);
    vm.runInContext(`${code}\nmodule.exports = typeof ${varName} !== "undefined" ? ${varName} : null;`, sandbox);
    return sandbox.module.exports;
  }).filter(Boolean);
}

function describeCar(c) {
  const pos = c.col === null ? "hors plateau" : `(${c.col},${c.row})`;
  const dmg = c.damageTokens.length;
  return `${c.size[0].toUpperCase()}${c.id} ${pos} [${c.status}${dmg ? ",dmg=" + dmg : ""}]`;
}

function collectCases(nWanted, maxAttemptsGames) {
  const rawTiles = loadRealTiles();
  const playerNames = ["Mayrik", "IA-Adverse"];
  const cases = [];

  for (let g = 0; g < maxAttemptsGames && cases.length < nWanted; g++) {
    const setup = setupTileProgressionFromRawData(rawTiles, { playerCount: 2 });
    if (!setup.ok) continue;
    const state = createTileProgressionState(setup.rearTile, setup.middleTile, setup.leadTile, setup.drawPile, { playerCount: 2 });
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

    for (let t = 0; t < 100 && cases.length < nWanted; t++) {
      const cp = getCurrentPlayer(roundState);
      if (!cp) break;
      ensureRoadDieRolled(roundState);
      if (roundState.roundNumber !== lastRoundSeen) { mayrikTurnsThisRound = 0; lastRoundSeen = roundState.roundNumber; }
      if (cp === "Mayrik" && roundState.roundNumber >= 2) {
        mayrikTurnsThisRound += 1;
        // Capture l'état AVANT la décision, sur un clone léger.
        const board = buildBoardFromProgressionState(state);
        const poolSnapshot = [...(roundState.dicePool["Mayrik"] || [])];
        const carsSnapshot = allCars.map((c) => ({ ...c, damageTokens: [...c.damageTokens] }));
        const commandUsedBefore = !!roundState.commandUsedThisRound["Mayrik"];
        const decision = ai.chooseAiAssignCommand(board, state, allCars, allChoppers, roundState.dicePool, "Mayrik", roundState);
        if (decision) {
          cases.push({
            round: roundState.roundNumber,
            turnInRound: mayrikTurnsThisRound,
            commandUsedBeforeThisTurn: commandUsedBefore,
            roadDie: roundState.roadDie,
            pool: poolSnapshot,
            cars: carsSnapshot,
            boardSnapshot: boardSnapshot(board),
            decision
          });
        }
      }
      ensureRoadDieRolled(roundState);
      playOneAiTurn(state, roundState, allCars, allChoppers, playerNames);
      const end = checkGameEndConditions(state, allCars, allChoppers, playerNames);
      if (end && end.ended) break;
    }
  }
  return cases;
}

const cases = collectCases(10, 30);
console.log(`${cases.length} cas capturés.\n`);

// Export JSON compact pour le viewer HTML (grille complète + voitures + décision).
const boardCache = new Map();
function boardSnapshot(board) {
  return {
    cols: board.cols, rows: board.rows,
    grid: board.grid.map((row) => row.map((cell) => ({
      terrain: cell.terrain,
      hazard: cell.hazard ? "hidden" : (cell.revealedHazard ? "revealed" : null)
    })))
  };
}

const exportCases = cases.map((c) => {
  const d = c.decision;
  const carClone = c.cars.find((x) => x.id === d.car.id);
  const targetClone = d.command && d.command.target ? (c.cars.find((x) => x.id === d.command.target.id) || d.command.target) : null;
  return {
    round: c.round,
    turnInRound: c.turnInRound,
    commandUsedBeforeThisTurn: c.commandUsedBeforeThisTurn,
    roadDie: c.roadDie,
    pool: c.pool,
    board: c.boardSnapshot,
    cars: c.cars.map((x) => ({ id: x.id, owner: x.owner, size: x.size, col: x.col, row: x.row, status: x.status, damageCount: x.damageTokens.length, movedThisRound: x.movedThisRound, coastCount: x.coastCount })),
    activeCarId: carClone.id,
    dieValue: d.dieValue,
    isEntry: !!d.isEntry,
    isCoast: !!d.isCoast,
    destination: d.destination || null,
    command: d.command ? { type: d.command.type, dieValue: d.command.dieValue, targetId: targetClone ? targetClone.id : null } : null
  };
});

fs.writeFileSync(path.join(__dirname, "review-cases.json"), JSON.stringify(exportCases));
console.log("review-cases.json écrit :", exportCases.length, "cas.");

