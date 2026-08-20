/**
 * tools/run-shadow-legality.js
 * ---------------------------------------------------------------
 * Harnais de validation "shadow mode" pour la nouvelle IA
 * (ai-scoring.js), conforme à la méthode retenue avec Mayrik
 * (pattern strangler fig / shadow mode).
 *
 * IMPORTANT (précision de Mayrik) : ce harnais ne compare PAS la
 * nouvelle IA à l'ancienne (chooseAiAssign) sur la qualité du jeu —
 * l'ancienne IA est reconnue inférieure/obsolète, elle n'est pas une
 * référence. Il vérifie uniquement :
 *   1. Absence de crash sur un grand nombre de parties complètes.
 *   2. Légalité de CHAQUE décision produite (dé effectivement dans le
 *      pool du joueur, pas de réutilisation du même dé physique pour
 *      le mouvement et la Command, contrainte de valeur du dé de
 *      Command respectée : Nitro 1-3 / Drift 3-5 / Repair 6).
 *   3. Absence d'états incohérents en sortie (position hors grille,
 *      etc.) — réutilise checkGameEndConditions et un contrôle de
 *      position simple.
 *
 * Ce fichier REJOUE l'orchestration de playOneAiTurn (engine.js) en
 * substituant chooseAiAssignCommand à chooseAiAssign/chooseAiCommand.
 * Il ne modifie PAS engine.js — engine.js reste la seule source de
 * vérité des règles, ce harnais ne fait qu'appeler ses primitives
 * publiques dans le même ordre que l'orchestrateur réel.
 */

"use strict";

const path = require("path");
const fs = require("fs");
const vm = require("vm");
const engine = require("../engine.js");
const ai = require("../ai-scoring.js");

const {
  TERRAIN, CAR_SIZE, CAR_STATUS,
  createChopper, createCarOffBoard, createRoundState,
  buildBoardFromProgressionState, createTileProgressionState,
  setupTileProgressionFromRawData, ensureRoadDieRolled, getCurrentPlayer,
  drawSpecificDieFromPool, advanceTurn, checkGameEndConditions,
  chooseAiMoveTrajectory, chooseAiEntryRow, getSpace, getFrontArc,
  isAiPathAllRoad, resolveNitroCommand, resolveRepairCommand,
  resolveDriftCommand, resolveAirstrikeCommand,
  playTurnAssignMoveWithProgression, playTurnAssignEnterWithProgression,
  playTurnCoastWithProgression, MOVE_COST
} = engine;

// -----------------------------------------------------------------
// Chargement des vraies tuiles (fichiers pensés pour <script>, donc
// TERRAIN global attendu — on les évalue dans un contexte dédié,
// uniquement pour ce harnais de test).
// -----------------------------------------------------------------
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

// -----------------------------------------------------------------
// Rejoue UN tour, en utilisant ai.chooseAiAssignCommand() au lieu de
// engine.chooseAiAssign()/chooseAiCommand(). Structure calquée sur
// playOneAiTurn (engine.js) — voir ce fichier pour la version de
// référence commentée en détail.
// -----------------------------------------------------------------
function playOneShadowTurn(state, roundState, allCars, allChoppers, playerNames, legalityLog) {
  const log = [];
  ensureRoadDieRolled(roundState);
  const currentPlayer = getCurrentPlayer(roundState);
  if (!currentPlayer) return { ok: false, reason: "Plus aucun joueur en jeu.", log };

  const board = buildBoardFromProgressionState(state);
  const poolBefore = [...(roundState.dicePool[currentPlayer] || [])];
  const decision = ai.chooseAiAssignCommand(board, state, allCars, allChoppers, roundState.dicePool, currentPlayer, roundState);

  if (!decision) {
    log.push(`${currentPlayer} : rien à jouer → passe forcée.`);
    log.push(...advanceTurn(roundState, allCars).log);
    return { ok: true, log, passed: true };
  }

  // --- CONTRÔLES DE LÉGALITÉ (le cœur de ce harnais) ---
  const carIsMine = decision.car.owner === currentPlayer;
  const dieInPool = poolBefore.includes(decision.dieValue);
  let commandDieOk = true;
  let commandDieDistinct = true;
  let commandRangeOk = true;
  if (decision.command) {
    commandDieOk = poolBefore.includes(decision.command.dieValue);
    commandDieDistinct = decision.command.dieValue !== decision.dieValue || poolBefore.filter((v) => v === decision.dieValue).length >= 2;
    const cv = decision.command.dieValue;
    if (decision.command.type === "nitro") commandRangeOk = cv >= 1 && cv <= 3;
    if (decision.command.type === "drift") commandRangeOk = cv >= 3 && cv <= 5;
    if (decision.command.type === "repair") commandRangeOk = cv === 6;
  }
  if (!carIsMine || !dieInPool || !commandDieOk || !commandDieDistinct || !commandRangeOk) {
    legalityLog.push({
      player: currentPlayer, pool: poolBefore, decision,
      carIsMine, dieInPool, commandDieOk, commandDieDistinct, commandRangeOk
    });
  }
  // --- FIN CONTRÔLES ---

  const { car } = decision;
  const isCoastTurn = car.movedThisRound;
  const command = decision.command;

  drawSpecificDieFromPool(roundState.dicePool, currentPlayer, decision.dieValue);
  log.push(`ASSIGN : dé ${decision.dieValue} → ${car.id}${isCoastTurn ? " (Coast)" : ""}`);

  let effectiveDieValue = decision.dieValue;
  const slamOptions = {};

  if (command && !isCoastTurn) {
    drawSpecificDieFromPool(roundState.dicePool, currentPlayer, command.dieValue);
    roundState.commandUsedThisRound[currentPlayer] = true;
    log.push(`COMMAND : ${command.type} (dé ${command.dieValue})`);

    if (command.type === "nitro") {
      const r = resolveNitroCommand(command.dieValue);
      if (r.ok) effectiveDieValue += r.bonus;
    } else if (command.type === "repair") {
      resolveRepairCommand(command.dieValue, command.target);
    } else if (command.type === "drift") {
      const r = resolveDriftCommand(command.dieValue);
      if (r.ok) slamOptions.driftAvailable = true;
    } else if (command.type === "airstrike") {
      let chopper = allChoppers.find((ch) => ch.owner === currentPlayer);
      if (!chopper) { chopper = createChopper(currentPlayer); allChoppers.push(chopper); }
      if (command.placement) {
        resolveAirstrikeCommand(
          board, allCars, allChoppers, chopper, command.placement.col, command.placement.row,
          { roundNumber: roundState.roundNumber, shootTarget: command.target, progressionState: state, allChoppers }
        );
      }
    }
  }

  if (decision.isEntry) {
    const entryRow = chooseAiEntryRow(board, car, allCars, allChoppers);
    const entrySpace = getSpace(board, 0, entryRow);
    let entryChosenPath = [];
    if (entrySpace && entrySpace.terrain !== TERRAIN.IMPASSABLE) {
      const entryCost = entrySpace.terrain === TERRAIN.MUD && effectiveDieValue === 1 ? 1 : MOVE_COST[entrySpace.terrain];
      const remainingAfterEntry = effectiveDieValue - entryCost;
      if (remainingAfterEntry > 0) {
        const hypCar = { ...car, col: 0, row: entryRow };
        entryChosenPath = chooseAiMoveTrajectory(board, hypCar, remainingAfterEntry, allCars, allChoppers);
      }
    }
    let roadBonusPath = null;
    if (roundState.roadDie && entrySpace && entrySpace.terrain === TERRAIN.ROAD) {
      const hypCar = { ...car, col: 0, row: entryRow };
      roadBonusPath = chooseAiMoveTrajectory(board, hypCar, roundState.roadDie, allCars, allChoppers);
    }
    const result = playTurnAssignEnterWithProgression(
      state, car, effectiveDieValue, entryRow, entryChosenPath, allCars, allChoppers, playerNames,
      { roundNumber: roundState.roundNumber, roadDieValue: roundState.roadDie, roadBonusPath, ...slamOptions }
    );
    log.push(...(result.log || []));
    if (result.ok) log.push(...advanceTurn(roundState, allCars).log);
    return { ...result, log };
  }

  if (isCoastTurn) {
    const coastPath = chooseAiMoveTrajectory(board, car, 1, allCars, allChoppers);
    const result = playTurnCoastWithProgression(state, car, coastPath, allCars, allChoppers, playerNames, { roundNumber: roundState.roundNumber });
    log.push(...(result.log || []));
    if (result.ok) log.push(...advanceTurn(roundState, allCars).log);
    return { ...result, log };
  }

  if (car.status !== CAR_STATUS.OPERABLE) {
    log.push(`${car.id} devenue inopérable pendant la Command → fin du tour.`);
    log.push(...advanceTurn(roundState, allCars).log);
    return { ok: true, log, car };
  }

  const movePath = chooseAiMoveTrajectory(board, car, effectiveDieValue, allCars, allChoppers);
  let projectedCol = car.col, projectedRow = car.row;
  for (const dir of movePath) {
    const arc = getFrontArc({ col: projectedCol, row: projectedRow });
    const step = arc.find((a) => a.name === dir);
    if (!step) break;
    projectedCol = step.col; projectedRow = step.row;
  }
  const projectedCar = { ...car, col: projectedCol, row: projectedRow };
  const shootTarget = engine.chooseAiShootTarget(projectedCar, allCars);

  let roadBonusPath = null;
  if (roundState.roadDie && isAiPathAllRoad(board, car, movePath)) {
    roadBonusPath = chooseAiMoveTrajectory(board, projectedCar, roundState.roadDie, allCars, allChoppers);
  }

  const result = playTurnAssignMoveWithProgression(
    state, car, effectiveDieValue, movePath, allCars, allChoppers, playerNames,
    { roundNumber: roundState.roundNumber, shootTarget, roadDieValue: roundState.roadDie, roadBonusPath, ...slamOptions }
  );
  log.push(...(result.log || []));
  if (result.ok) log.push(...advanceTurn(roundState, allCars).log);
  return { ...result, log };
}

// -----------------------------------------------------------------
// Contrôle d'intégrité d'état : toute voiture non éliminée doit
// avoir une position dans les bornes de la tuile assemblée (même
// contrôle que celui qui avait révélé les bugs Blast Off/Slam sur
// engine.js pendant la session précédente).
// -----------------------------------------------------------------
function checkStateIntegrity(board, allCars) {
  const problems = [];
  for (const car of allCars) {
    if (car.status === CAR_STATUS.ELIMINATED) continue;
    if (car.col === null) continue; // pas encore entrée, état valide
    if (car.row < 0 || car.row >= board.rows || car.col < 0) {
      problems.push(`${car.id} hors bornes : col=${car.col} row=${car.row}`);
    }
  }
  return problems;
}

function runGames(nGames, maxTurnsPerGame) {
  const rawTiles = loadRealTiles();
  const playerNames = ["Rouge", "Bleu"];
  const legalityLog = [];
  const integrityLog = [];
  let crashCount = 0, completedCount = 0, totalDecisions = 0;

  for (let g = 0; g < nGames; g++) {
    try {
      const setup = setupTileProgressionFromRawData(rawTiles, { playerCount: 2 });
      if (!setup.ok) { console.log("Setup échoué :", setup.reason); continue; }
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

      for (let t = 0; t < maxTurnsPerGame; t++) {
        const cp = getCurrentPlayer(roundState);
        if (!cp) break;
        playOneShadowTurn(state, roundState, allCars, allChoppers, playerNames, legalityLog);
        totalDecisions++;

        const board = buildBoardFromProgressionState(state);
        const problems = checkStateIntegrity(board, allCars);
        if (problems.length > 0) integrityLog.push({ game: g, turn: t, problems });

        const endCheck = checkGameEndConditions(state, allCars, allChoppers, playerNames);
        if (endCheck && endCheck.ended) break;
      }
      completedCount++;
    } catch (e) {
      crashCount++;
      console.log(`CRASH partie ${g} :`, e.message);
      console.log(e.stack.split("\n").slice(0, 6).join("\n"));
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
