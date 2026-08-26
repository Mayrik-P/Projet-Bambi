/**
 * tools/run-shadow-legality.js — nouveau système (ai-decision.js)
 * ---------------------------------------------------------------
 * Rejoue des parties complètes en utilisant decideAssignAndCommand()
 * pour LES DEUX joueurs (self-play — plus aucune dépendance à
 * l'ancien système abandonné), en exécutant réellement chaque
 * décision via les primitives du moteur (jamais une simple
 * vérification hors-sol). Vérifie :
 *   1. Absence de crash sur un grand nombre de parties complètes.
 *   2. Légalité de CHAQUE décision (dé effectivement dans le pool,
 *      pas de réutilisation du même dé physique, contrainte de
 *      valeur de Command respectée).
 *   3. Intégrité d'état (positions dans les bornes du plateau).
 */

"use strict";

const path = require("path");
const fs = require("fs");
const vm = require("vm");
const engine = require("../engine.js");
const ai = require("../ai-decision.js");
const { checkDecisionLegality, executeDecision } = require("../turn-executor.js");

const {
  TERRAIN, CAR_SIZE, CAR_STATUS,
  createChopper, createCarOffBoard, createRoundState,
  buildBoardFromProgressionState, createTileProgressionState,
  setupTileProgressionFromRawData, ensureRoadDieRolled, getCurrentPlayer,
  advanceTurn, checkGameEndConditions
} = engine;

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

function playOneShadowTurn(progressionState, roundState, allCars, allChoppers, playerNames, legalityLog) {
  const log = [];
  ensureRoadDieRolled(roundState);
  const currentPlayer = getCurrentPlayer(roundState);
  if (!currentPlayer) return { ok: false, reason: "Plus aucun joueur en jeu.", log };

  const board = buildBoardFromProgressionState(progressionState);
  const poolBefore = [...(roundState.dicePool[currentPlayer] || [])];
  const decision = ai.decideAssignAndCommand(progressionState, board, allCars, allChoppers, roundState.dicePool, currentPlayer, roundState);

  if (!decision) {
    log.push(`${currentPlayer} : rien à jouer → passe forcée.`);
    log.push(...advanceTurn(roundState, allCars).log);
    return { ok: true, log, passed: true, decision: null };
  }

  // --- CONTRÔLES DE LÉGALITÉ (règles mécaniques uniquement — voir
  // turn-executor.js, partagé avec la couche joueur humain) ---
  const legality = checkDecisionLegality(decision, poolBefore, currentPlayer);
  if (!legality.allOk) {
    legalityLog.push({ player: currentPlayer, pool: poolBefore, decision, ...legality });
  }
  // --- FIN CONTRÔLES ---

  return executeDecision(progressionState, roundState, allCars, allChoppers, playerNames, currentPlayer, decision);
}

function checkStateIntegrity(board, allCars) {
  const problems = [];
  for (const car of allCars) {
    if (car.status === CAR_STATUS.ELIMINATED) continue;
    if (car.col === null) continue;
    if (car.row < 0 || car.row >= board.rows || car.col < 0) {
      problems.push(`${car.id} hors bornes : col=${car.col} row=${car.row}`);
    }
  }
  return problems;
}

function runGames(nGames, maxTurnsPerGame) {
  const rawTiles = loadRealTiles();
  const playerNames = ["Mayrik", "IA-Adverse"];
  const legalityLog = [];
  const integrityLog = [];
  let crashCount = 0, completedCount = 0, totalDecisions = 0;

  for (let g = 0; g < nGames; g++) {
    try {
      const setup = setupTileProgressionFromRawData(rawTiles, { playerCount: 2 });
      if (!setup.ok) { console.log("Setup échoué :", setup.reason); continue; }
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

      for (let t = 0; t < maxTurnsPerGame; t++) {
        const cp = getCurrentPlayer(roundState);
        if (!cp) break;
        const decisionSnapshot = playOneShadowTurn(progressionState, roundState, allCars, allChoppers, playerNames, legalityLog);
        totalDecisions++;

        const board = buildBoardFromProgressionState(progressionState);
        const problems = checkStateIntegrity(board, allCars);
        if (problems.length > 0) {
          integrityLog.push({ game: g, turn: t, problems, lastLog: decisionSnapshot.log });
        }

        const endCheck = checkGameEndConditions(progressionState, allCars, allChoppers, playerNames);
        if (endCheck && endCheck.gameOver) break;
      }
      completedCount++;
    } catch (e) {
      crashCount++;
      console.log(`CRASH partie ${g} :`, e.message);
      console.log(e.stack.split("\n").slice(0, 8).join("\n"));
    }
  }

  console.log("---");
  console.log(`Parties jouées jusqu'au bout (ou maxTurns) : ${completedCount}/${nGames}`);
  console.log(`Crashs : ${crashCount}`);
  console.log(`Décisions totales rejouées : ${totalDecisions}`);
  console.log(`Décisions illégales détectées : ${legalityLog.length}`);
  console.log(`États incohérents détectés : ${integrityLog.length}`);
  if (legalityLog.length > 0) console.log(JSON.stringify(legalityLog.slice(0, 5), null, 2));
  if (integrityLog.length > 0) console.log(JSON.stringify(integrityLog.slice(0, 5), null, 2));

  return { completedCount, crashCount, totalDecisions, illegalCount: legalityLog.length, integrityIssues: integrityLog.length };
}

if (require.main === module) {
  const n = parseInt(process.argv[2], 10) || 50;
  const maxTurns = parseInt(process.argv[3], 10) || 100;
  runGames(n, maxTurns);
}

module.exports = { runGames, playOneShadowTurn, loadRealTiles };
