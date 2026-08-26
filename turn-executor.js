/**
 * turn-executor.js — exécution d'une décision de tour, indépendamment
 * de QUI l'a prise (l'IA via ai-decision.js, ou un joueur humain via
 * human-decision.js).
 * ---------------------------------------------------------------
 * Extrait de tools/run-shadow-legality.js (qui inlinait cette logique
 * spécifiquement pour son harnais de self-play IA vs IA). La forme
 * d'une "décision" est la même quelle que soit son origine :
 *   { car, dieValue, command, destination, isEntry, isCoast, slam, roadBonusPath }
 * où command est null ou { type, dieValue, target?, placement? }.
 *
 * Deux fonctions exportées :
 *   - checkDecisionLegality(decision, poolBefore) : vérifie la
 *     décision par rapport aux RÈGLES MÉCANIQUES DU JEU UNIQUEMENT
 *     (dé bien dans le pool, pas réutilisation du même dé physique,
 *     plage de valeur de Command) — jamais une préférence stratégique.
 *     Utilisée par tools/run-shadow-legality.js (pour DÉTECTER une
 *     décision IA illégale, sans bloquer son exécution — l'outil veut
 *     justement voir ces cas s'ils existent) ET par human-decision.js
 *     (pour REJETER une décision avant de l'exécuter — un humain ne
 *     doit jamais pouvoir soumettre un choix mécaniquement invalide).
 *   - executeDecision(...) : exécute réellement une décision déjà
 *     prise (dés tirés du pool, Command résolue, mouvement/Coast/
 *     entrée joué, tour avancé) — ne prend AUCUNE décision elle-même,
 *     ne fait AUCUNE hypothèse sur qui a choisi quoi.
 */

"use strict";

const engine = require("./engine.js");
const ai = require("./ai-decision.js");

const {
  CAR_STATUS,
  drawSpecificDieFromPool, advanceTurn,
  resolveNitroCommand, resolveRepairCommand, resolveDriftCommand,
  resolveAirstrikeCommand, playTurnAssignMoveWithProgression,
  playTurnAssignEnterWithProgression, playTurnCoastWithProgression,
  createChopper
} = engine;

/**
 * Vérifie une décision par rapport aux règles mécaniques du jeu
 * UNIQUEMENT (jamais une heuristique stratégique — celles-ci
 * n'existent que côté ai-decision.js, et ne s'imposent à personne
 * d'autre) :
 *   - la voiture assignée appartient bien au joueur ;
 *   - le dé de mouvement est réellement dans son pool ;
 *   - si une Command est jouée : son dé est dans le pool, DISTINCT du
 *     dé de mouvement (sauf si le pool contient au moins deux dés de
 *     cette valeur), et respecte la plage de valeur du livret (Nitro
 *     1-3, Drift 3-5, Repair 6 — Airstrike accepte n'importe quelle
 *     valeur, p.8).
 * Ne exécute rien, ne mute rien — pure fonction de contrôle.
 */
function checkDecisionLegality(decision, poolBefore, playerName) {
  const carIsMine = decision.car.owner === playerName;
  const dieInPool = poolBefore.includes(decision.dieValue);
  let commandDieOk = true, commandDieDistinct = true, commandRangeOk = true;
  if (decision.command) {
    commandDieOk = poolBefore.includes(decision.command.dieValue);
    commandDieDistinct = decision.command.dieValue !== decision.dieValue || poolBefore.filter((v) => v === decision.dieValue).length >= 2;
    const cv = decision.command.dieValue;
    if (decision.command.type === "nitro") commandRangeOk = cv >= 1 && cv <= 3;
    if (decision.command.type === "drift") commandRangeOk = cv >= 3 && cv <= 5;
    if (decision.command.type === "repair") commandRangeOk = cv === 6;
    // Airstrike : aucune contrainte de valeur (p.8, "ANY DIE").
  }
  const allOk = carIsMine && dieInPool && commandDieOk && commandDieDistinct && commandRangeOk;
  return { carIsMine, dieInPool, commandDieOk, commandDieDistinct, commandRangeOk, allOk };
}

/**
 * Exécute une décision déjà prise, quelle que soit son origine.
 * Ne vérifie PAS la légalité (voir checkDecisionLegality ci-dessus,
 * à appeler séparément par l'appelant selon ses besoins — un harnais
 * de test peut vouloir exécuter puis constater l'illégalité, un
 * client humain doit vérifier AVANT et ne jamais appeler ceci sur une
 * décision invalide).
 * Retourne { ok, log, decision, ...résultat de playTurn*WithProgression }.
 */
function executeDecision(progressionState, roundState, allCars, allChoppers, playerNames, currentPlayer, decision) {
  const log = [];
  const { car } = decision;
  const isCoastTurn = decision.isCoast;
  const command = decision.command;

  drawSpecificDieFromPool(roundState.dicePool, currentPlayer, decision.dieValue);
  log.push(`ASSIGN : dé ${decision.dieValue} → ${car.id}${isCoastTurn ? " (Coast)" : ""}`);

  // Étape 2 (rewrite-plan.md) : le tir est calculé ICI, une seule
  // fois, génériquement, après que la décision (donc la destination
  // finale) est connue — quelle que soit la branche qui a produit
  // cette décision (mouvement normal, Coast, Finish Line Rush,
  // décision humaine...).
  decision.shotTarget = ai.computeShotTargetForDecision(decision, allCars);

  // La cible RÉELLEMENT utilisée pour le tir est recalculée par le
  // moteur APRÈS résolution complète du mouvement (un Slam peut faire
  // atterrir la voiture ailleurs qu'où prévu, via des dés tirés
  // PENDANT la résolution) — voir engine.js, resolveShootStep.
  const shootTargetFn = (currentCar, cars) => ai.chooseShootTarget(currentCar.col, currentCar.row, currentCar.owner, cars);

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
          engine.buildBoardFromProgressionState(progressionState), allCars, allChoppers, chopper, command.placement.col, command.placement.row,
          { roundNumber: roundState.roundNumber, shootTarget: command.target, progressionState, allChoppers }
        );
      }
    }
  }

  if (decision.isEntry) {
    const result = playTurnAssignEnterWithProgression(
      progressionState, car, effectiveDieValue, decision.destination.entryRow, decision.destination.path || [], allCars, allChoppers, playerNames,
      { roundNumber: roundState.roundNumber, roadDieValue: roundState.roadDie, roadBonusPath: decision.roadBonusPath || null, ...slamOptions }
    );
    log.push(...(result.log || []));
    if (result.ok) log.push(...advanceTurn(roundState, allCars).log);
    return { ...result, log, decision };
  }

  if (isCoastTurn) {
    const result = playTurnCoastWithProgression(progressionState, car, decision.destination.path || [], allCars, allChoppers, playerNames, { roundNumber: roundState.roundNumber, shootTarget: decision.shotTarget, shootTargetFn });
    log.push(...(result.log || []));
    if (result.ok) log.push(...advanceTurn(roundState, allCars).log);
    return { ...result, log, decision };
  }

  if (car.status !== CAR_STATUS.OPERABLE) {
    log.push(`${car.id} devenue inopérable pendant la Command → fin du tour.`);
    log.push(...advanceTurn(roundState, allCars).log);
    return { ok: true, log, car, decision };
  }

  const result = playTurnAssignMoveWithProgression(
    progressionState, car, effectiveDieValue, decision.destination.path || [], allCars, allChoppers, playerNames,
    { roundNumber: roundState.roundNumber, shootTarget: decision.shotTarget, shootTargetFn, roadDieValue: roundState.roadDie, roadBonusPath: decision.roadBonusPath || null, ...slamOptions }
  );
  log.push(...(result.log || []));
  if (result.ok) log.push(...advanceTurn(roundState, allCars).log);
  return { ...result, log, decision };
}

module.exports = { checkDecisionLegality, executeDecision };
