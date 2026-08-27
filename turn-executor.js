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
  createChopper, buildBoardFromProgressionState, moveCarEnteringBoard,
  moveCarWithProgression, resolveShoot, eliminateCarsOnChoppers,
  checkGameEndConditions
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
  const slamOptions = { decideReroll: ai.decideSlamRerollDefault };

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

// ===================================================================
// EXÉCUTION PAS À PAS (Point 3, retour d'usage de Mayrik) — pour un
// tour JOUÉ PAR UN HUMAIN uniquement. L'IA continue d'utiliser
// executeDecision ci-dessus (décision atomique, aucun changement).
// Ces fonctions décomposent exactement les mêmes étapes qu'executeDecision
// (ASSIGN → COMMAND → MOVE case par case → BONUS ROAD case par case →
// SHOOT (cible libre) → END OF TURN), chacune appelée séparément par
// l'interface au fil des clics du joueur, sans jamais dupliquer les
// règles déjà validées par engine.js.
// ===================================================================

/**
 * ASSIGN + COMMAND — identique à la première moitié d'executeDecision,
 * mais sans rien exécuter du mouvement (qui devient interactif,
 * case par case, voir executeMoveStep/executeEntryStep plus bas).
 * `intent` = { car, dieValue, command, isCoast }. Retourne
 * { log, effectiveDieValue, slamOptions } — effectiveDieValue inclut
 * déjà le bonus Nitro éventuel ; slamOptions.driftAvailable est prêt à
 * être transmis à chaque appel d'executeMoveStep/executeEntryStep.
 */
function executeAssignAndCommand(roundState, allCars, allChoppers, progressionState, currentPlayer, intent) {
  const log = [];
  const { car, dieValue, command, isCoast } = intent;

  drawSpecificDieFromPool(roundState.dicePool, currentPlayer, dieValue);
  log.push(`ASSIGN : dé ${dieValue} → ${car.id}${isCoast ? " (Coast)" : ""}`);

  let effectiveDieValue = dieValue;
  const slamOptions = { decideReroll: ai.decideSlamRerollDefault };

  if (command && !isCoast) {
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
          buildBoardFromProgressionState(progressionState), allCars, allChoppers, chopper, command.placement.col, command.placement.row,
          { roundNumber: roundState.roundNumber, shootTarget: command.target, progressionState, allChoppers }
        );
      }
    }
  }

  return { log, effectiveDieValue, slamOptions };
}

/**
 * Tout premier pas d'une voiture pas encore sur le plateau : choix de
 * la rangée d'entrée (voir human.getEntryRowOptions). Consomme le coût
 * de terrain de cette case, applique ses effets (hazard, slam éventuel
 * dès l'entrée), et rend le mouvement restant à l'appelant — la suite
 * du trajet (s'il en reste) redevient un pas normal via executeMoveStep.
 * Jamais de progression de tuile ni de tir possibles dès l'entrée
 * (impossible par construction / interdit au round 1, voir engine.js).
 */
function executeEntryStep(progressionState, allCars, car, dieValue, entryRow, slamOptions = {}) {
  const log = [];
  log.push(`ASSIGN (entrée en jeu) : dé ${dieValue} assigné à ${car.id}`);
  const board = buildBoardFromProgressionState(progressionState);
  const result = moveCarEnteringBoard(board, car, dieValue, entryRow, [], allCars, slamOptions);
  log.push(...result.log);
  return { ...result, log };
}

/**
 * Un seul pas de mouvement normal (voiture déjà sur le plateau) :
 * `direction` doit venir de human.getMovementStepOptions (donc déjà
 * filtrée légale). Réutilise moveCarWithProgression avec un chemin
 * d'UNE seule direction — la fonction elle-même gère intégralement les
 * effets de cette case (hazard, slam, sortie de tuile avec décalage
 * automatique, victoire éventuelle) avant de rendre la main : rien de
 * cela n'est réimplémenté ici.
 * IMPORTANT : devenir inopérable (dégâts) n'arrête PAS forcément le
 * mouvement (aucune règle en ce sens, contrairement au Slam/Mine qui
 * mettent `remaining` à 0 explicitement) — ne JAMAIS déduire un arrêt
 * forcé du seul `car.status` ici. Voir human.computePointsLost, qui
 * détecte un arrêt forcé en comparant le `remaining` réellement obtenu
 * à ce que le coût de terrain normal aurait dû laisser.
 */
function executeMoveStep(progressionState, allCars, allChoppers, playerNames, car, remaining, direction, slamOptions = {}) {
  const result = moveCarWithProgression(progressionState, car, remaining, [direction], allCars, allChoppers, playerNames, slamOptions);
  return result;
}

/**
 * Tir de fin de mouvement, avec cible LIBREMENT choisie par le joueur
 * (voir human.getShootTargetOptions) — `target` peut être null si le
 * joueur choisit de ne pas tirer, auquel cas rien n'est résolu.
 */
function executeShoot(progressionState, allCars, allChoppers, car, target, roundNumber, options = {}) {
  const log = [];
  if (!target) {
    log.push(`${car.id} choisit de ne pas tirer.`);
    return { log, shootResult: null };
  }
  if (roundNumber === 1) {
    log.push(`Tir impossible : les armes ne sont pas encore actives au 1er round (p.10)`);
    return { log, shootResult: null };
  }
  if (car.status !== CAR_STATUS.OPERABLE) {
    log.push(`${car.id} n'est plus opérable → tir impossible`);
    return { log, shootResult: null };
  }
  const board = buildBoardFromProgressionState(progressionState);
  const shootResult = resolveShoot(board, allCars, car, target, { roundNumber, progressionState, allChoppers, ...options });
  log.push(...shootResult.log);
  return { log, shootResult };
}

/**
 * Fin de tour — identique à la fin d'executeDecision (car.movedThisRound,
 * élimination par chopper, avancée du tour, vérification de victoire).
 */
function executeEndOfTurn(progressionState, roundState, allCars, allChoppers, playerNames, car) {
  const log = [];
  car.movedThisRound = true;
  log.push(`END OF TURN : ${car.id} ne pourra plus être assignée ce round`);

  const chopperElim = eliminateCarsOnChoppers(allCars, allChoppers || []);
  log.push(...chopperElim.log);

  const endCheck = checkGameEndConditions(progressionState, allCars, allChoppers, playerNames);
  log.push(...endCheck.log);

  if (!endCheck.gameOver) {
    log.push(...advanceTurn(roundState, allCars).log);
  }

  return { log, gameOver: endCheck.gameOver, winner: endCheck.winner, reason: endCheck.reason };
}

module.exports = {
  checkDecisionLegality,
  executeDecision,
  executeAssignAndCommand,
  executeEntryStep,
  executeMoveStep,
  executeShoot,
  executeEndOfTurn
};
