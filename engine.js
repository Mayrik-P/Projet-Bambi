/**
 * ThunderRoad In The Pocket — Moteur de règles (sans graphisme)
 * ---------------------------------------------------------------
 * Ce fichier ne dessine RIEN. Il modélise juste l'état du jeu et les
 * règles qui le font évoluer. On le teste en lisant les résultats
 * dans la console (voir test-engine.js).
 *
 * ÉTAPE 1 (ce fichier) : une seule tuile, une seule voiture, le
 * mouvement de base (arc avant, coût des terrains). Pas encore de
 * slams, hazards, tir, dégâts, IA, ni plusieurs tuiles qui défilent.
 * On ajoutera ces briques une par une, chacune testée avant la
 * suivante.
 */

// -----------------------------------------------------------------
// 1. CONSTANTES DE RÈGLES (tirées du rulebook)
// -----------------------------------------------------------------

const TERRAIN = {
  ROAD: "road",           // coûte 1 déplacement
  OFF_ROAD: "off_road",   // coûte 1 déplacement
  MUD: "mud",             // coûte 2 déplacements
  IMPASSABLE: "impassable" // élimine la voiture qui y entre
};

const MOVE_COST = {
  [TERRAIN.ROAD]: 1,
  [TERRAIN.OFF_ROAD]: 1,
  [TERRAIN.MUD]: 2
  // IMPASSABLE n'a pas de coût : on n'y "avance" pas, on est éliminé.
};

const CAR_SIZE = {
  SMALL: "small",
  MEDIUM: "medium",
  LARGE: "large"
};

const CAR_STATUS = {
  OPERABLE: "operable",
  INOPERABLE: "inoperable",
  ELIMINATED: "eliminated"
};

// -----------------------------------------------------------------
// 1bis. RÉPARTITION EXACTE DES DÉS (confirmée par Mayrik, p.10 rulebook)
// -----------------------------------------------------------------
// Centralisé ici même si tous ne sont pas encore utilisés par le
// moteur — évite de re-vérifier les chiffres à chaque nouvelle
// mécanique (dégâts, tir, bonus route...).

const DICE_FACES = {
  MOVEMENT: [1, 2, 3, 4, 5, 6],
  ROAD: [1, 1, 1, 2, 2, 3],
  STUNT: [1, 2, 2, 3, 3, 4],
  SHOOTING: ["large", "large", "large", "medium", "small-medium", "any"],
  SLAM: ["top", "top", "bottom", "bottom", "bottom", "bottom"] // déjà utilisé par rollSlamDie
};

// -----------------------------------------------------------------
// 2. MODÈLE DE LA TUILE
// -----------------------------------------------------------------
// Une tuile est une grille [row][col]. col augmente vers l'avant
// (direction dans laquelle les voitures avancent). row est la
// position latérale sur la tuile.
//
// NOTE : la géométrie exacte (grille isométrique à cases décalées,
// comme dans l'éditeur de plateau) sera reconciliée avec le rendu
// plus tard. Pour l'instant on teste la LOGIQUE sur une grille
// simple rectangulaire — les règles de coût/arc sont identiques,
// seul l'affichage final changera.

function createTestTile(cols, rows) {
  const grid = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      row.push({ terrain: TERRAIN.ROAD, hazard: null });
    }
    grid.push(row);
  }
  return { cols, rows, grid };
}

function getSpace(tile, col, row) {
  if (row < 0 || row >= tile.rows) return null; // hors tuile (bord gauche/droit)
  if (col < 0 || col >= tile.cols) return undefined; // hors tuile (bord avant/arrière) — cas à traiter plus tard
  return tile.grid[row][col];
}

// -----------------------------------------------------------------
// 3. MODÈLE DE LA VOITURE
// -----------------------------------------------------------------

let nextCarId = 1;

function createCar(owner, size, col, row) {
  return {
    id: nextCarId++,
    owner,
    size,
    col,
    row,
    status: CAR_STATUS.OPERABLE,
    damageTokens: [],
    facingReversed: false, // true une fois inopérable (p.6)
    movedThisRound: false // p.8 : une voiture ne peut être assignée qu'une fois par ROUND (pas par tour)
  };
}

// -----------------------------------------------------------------
// 3bis. CHOPPER (p.6, p.8, p.11)
// -----------------------------------------------------------------
// Un chopper N'EST PAS un véhicule routier : il ne peut pas être
// tiré dessus, ne prend pas de dégâts, ne slamme pas et n'est pas
// slammé. Il PEUT tirer, et élimine tout véhicule qui finit un tour
// sur sa case (même le sien). Il est placé via la commande Airstrike
// (voir placeChopperAirstrike ci-dessous) — avant sa première
// utilisation, il n'est nulle part sur le plateau (placed: false).
let nextChopperId = 1;

function createChopper(owner) {
  return {
    id: `chopper-${nextChopperId++}`,
    owner,
    col: null,
    row: null,
    placed: false,
    isChopper: true // permet à resolveShoot() de refuser de le cibler
  };
}

// p.8 : "Place your chopper on any empty space on the board (a space
// with no obstacles)." Un obstacle = un véhicule routier, un AUTRE
// chopper, un hazard (face cachée ou visible), ou une case impassable
// (p.7, "Obstacles"). Retourne {ok:false, reason} si la case n'est
// pas valide, sinon place le chopper et retourne {ok:true}.
function placeChopperAirstrike(tile, allCars, allChoppers, chopper, col, row) {
  const space = getSpace(tile, col, row);

  if (space === null || space === undefined) {
    return { ok: false, reason: "Case hors du plateau." };
  }
  if (space.terrain === TERRAIN.IMPASSABLE) {
    return { ok: false, reason: "Case impassable : pas une case vide." };
  }
  if (space.hazard) {
    return { ok: false, reason: "Case avec un hazard : pas une case vide." };
  }
  if (getCarAt(allCars, col, row)) {
    return { ok: false, reason: "Case occupée par un véhicule : pas une case vide." };
  }
  if (allChoppers.some((c) => c !== chopper && c.placed && c.col === col && c.row === row)) {
    return { ok: false, reason: "Case occupée par un autre chopper : pas une case vide." };
  }

  chopper.col = col;
  chopper.row = row;
  chopper.placed = true;
  return { ok: true };
}

// p.11, END OF TURN : "Any cars in a space with a chopper are
// eliminated." — à appeler par le futur moteur de tour, à la fin de
// CHAQUE tour (pas seulement celui qui vient de placer un chopper).
function eliminateCarsOnChoppers(allCars, allChoppers) {
  const log = [];
  for (const car of allCars) {
    if (car.status === CAR_STATUS.ELIMINATED) continue;
    const onChopper = allChoppers.some((ch) => ch.placed && ch.col === car.col && ch.row === car.row);
    if (onChopper) {
      car.status = CAR_STATUS.ELIMINATED;
      log.push(`${car.id} finit sur la case d'un chopper → ÉLIMINÉE`);
    }
  }
  return { log };
}

// -----------------------------------------------------------------
// 4. ARC AVANT
// -----------------------------------------------------------------
// Règle (p.9) : une voiture ne peut avancer que dans l'une des 3
// cases de son arc avant : front-left, front, front-right.

function getFrontArc(car) {
  return [
    { name: "front-left", col: car.col + 1, row: car.row - 1 },
    { name: "front", col: car.col + 1, row: car.row },
    { name: "front-right", col: car.col + 1, row: car.row + 1 }
  ];
}

// -----------------------------------------------------------------
// 5. DÉPLACEMENT
// -----------------------------------------------------------------
// Règle (p.9) : une voiture gagne un nombre de déplacements égal au
// dé assigné. Chaque case coûte 1 ou 2 déplacements selon le terrain.
// Une voiture doit utiliser TOUT son déplacement, sauf si un effet
// lui fait perdre ses déplacements restants (dégâts, slam...).
// Étape 1 : pas encore de slam/hazard, juste le coût de terrain et
// l'élimination sur case impassable.

// Fait entrer une voiture dans UNE case adjacente en respectant le
// coût de terrain (contrairement à forceMoveOneSpace, utilisé par le
// slam, qui ignore ce coût). Partagé entre moveCar (mouvement normal,
// arc avant) et le futur effet Dazed (6 directions, coût respecté).
//
// Retourne { log, remaining, stopped, eliminated?, offTileEdge?,
// insufficientMove?, slam? }. stopped=true signifie que la séquence
// de déplacement en cours doit s'arrêter là (élimination, slam, ou
// pas assez de déplacement pour cette case).
function enterAdjacentSpace(tile, car, allCars, targetCol, targetRow, remaining, slamOptions = {}, suppressOccupantSlam = false) {
  const log = [];
  const space = getSpace(tile, targetCol, targetRow);

  if (space === null) {
    car.status = CAR_STATUS.ELIMINATED;
    log.push(`${car.id} sort par le bord latéral → ÉLIMINÉE`);
    return { log, remaining: 0, stopped: true, eliminated: true };
  }

  if (space === undefined) {
    log.push(`${car.id} atteint le bord avant/arrière de la tuile (non géré à cette étape)`);
    return { log, remaining, stopped: true, offTileEdge: true };
  }

  if (space.terrain === TERRAIN.IMPASSABLE) {
    car.status = CAR_STATUS.ELIMINATED;
    log.push(`${car.id} entre sur une case impassable → ÉLIMINÉE`);
    return { log, remaining: 0, stopped: true, eliminated: true };
  }

  const cost = MOVE_COST[space.terrain];
  const mudExceptionApplies = space.terrain === TERRAIN.MUD && remaining === 1; // p.7

  if (cost > remaining && !mudExceptionApplies) {
    return { log, remaining, stopped: true, insufficientMove: true };
  }

  car.col = targetCol;
  car.row = targetRow;
  let newRemaining = mudExceptionApplies ? 0 : remaining - cost;
  log.push(`${car.id} avance vers (col ${targetCol}, row ${targetRow}) — terrain ${space.terrain}`);

  // Résolution d'un hazard éventuel (p.7) AVANT la vérification
  // d'occupation : un Wreck fraîchement posé devient lui-même
  // l'occupant à considérer, et résout déjà son propre slam.
  const hazardResult = resolveHazard(tile, allCars, car, newRemaining, slamOptions);
  log.push(...hazardResult.log);
  newRemaining = hazardResult.remaining;
  if (hazardResult.stopped) {
    return {
      log,
      remaining: newRemaining,
      stopped: true,
      eliminated: car.status === CAR_STATUS.ELIMINATED,
      slam: hazardResult.slam
    };
  }

  // NOTE : car.col/car.row peuvent avoir changé si le hazard était un
  // Oil Slick (glissade) — on vérifie donc l'occupation à la position
  // ACTUELLE de la voiture, pas à targetCol/targetRow d'origine.
  const occupant = getCarAt(allCars, car.col, car.row, car);

  if (occupant && suppressOccupantSlam) {
    // p.8 : Drift — la voiture traverse SANS slammer. NOTE : cette
    // exemption ne couvre que l'occupation "classique" (véhicule déjà
    // présent) — pas un slam déclenché par un hazard (ex. Wreck), qui
    // est déjà résolu plus haut avant ce point, indépendamment de Drift.
    log.push(`${car.id} traverse la case de ${occupant.id} sans la slammer (Drift)`);
    return { log, remaining: newRemaining, stopped: false, driftPassThrough: true };
  }

  if (occupant) {
    log.push(`${car.id} entre dans la case de ${occupant.id} → SLAM`);
    const slamResult = resolveSlam(tile, allCars, car, occupant, slamOptions);
    log.push(...slamResult.log);
    return { log, remaining: 0, stopped: true, slam: slamResult };
  }

  return { log, remaining: newRemaining, stopped: false };
}

function moveCar(tile, car, dieValue, chosenPath, allCars = [], slamOptions = {}) {
  // chosenPath : liste de directions ("front-left" | "front" | "front-right"),
  // une par case franchie. Pour l'étape 1, c'est le joueur (ou plus
  // tard l'IA) qui choisit ce chemin à l'avance ; le moteur se
  // contente de vérifier et d'appliquer.
  // allCars : toutes les voitures en jeu, pour détecter les cases occupées.
  //
  // slamOptions.driftAvailable (p.8, commande Drift) : autorise à
  // traverser SANS slammer le PREMIER véhicule rencontré — mais
  // seulement si ce n'est PAS la case où le mouvement va se terminer
  // ("If you end your turn in a space with a road vehicle, you still
  // slam it, even if it is your first slam").

  if (car.status !== CAR_STATUS.OPERABLE) {
    return { ok: false, reason: "La voiture n'est pas opérationnelle." };
  }

  let remaining = dieValue;
  const log = [];
  let driftUsed = false;
  const driftAvailable = !!slamOptions.driftAvailable;

  for (let i = 0; i < chosenPath.length; i++) {
    const direction = chosenPath[i];
    if (remaining <= 0) break;

    const arc = getFrontArc(car);
    const target = arc.find((a) => a.name === direction);
    if (!target) {
      return { ok: false, reason: `Direction invalide : ${direction}` };
    }

    // Anticipation : cette case sera-t-elle celle où le mouvement se
    // termine (dernière du chemin choisi, OU plus de déplacement
    // ensuite) ? Nécessaire pour savoir si Drift peut s'appliquer ICI.
    let isFinalStep = true;
    const lookSpace = getSpace(tile, target.col, target.row);
    if (lookSpace && lookSpace.terrain !== TERRAIN.IMPASSABLE) {
      const lookCost = MOVE_COST[lookSpace.terrain];
      const lookMudException = lookSpace.terrain === TERRAIN.MUD && remaining === 1;
      const predictedRemaining = lookMudException ? 0 : remaining - lookCost;
      const hasMoreSteps = i < chosenPath.length - 1;
      isFinalStep = !(predictedRemaining > 0 && hasMoreSteps);
    }

    const driftEligible = driftAvailable && !driftUsed && !isFinalStep;

    const step = enterAdjacentSpace(tile, car, allCars, target.col, target.row, remaining, slamOptions, driftEligible);
    log.push(...step.log);

    if (step.insufficientMove) {
      return { ok: false, reason: "Pas assez de déplacements restants pour cette case." };
    }

    remaining = step.remaining;

    if (step.driftPassThrough) {
      driftUsed = true; // Drift ne s'applique qu'au PREMIER véhicule traversé (p.8)
    }

    if (step.eliminated) return { ok: true, log, eliminated: true };
    if (step.offTileEdge) return { ok: true, log, offTileEdge: true };
    if (step.slam) return { ok: true, log, remaining: 0, slam: step.slam };
  }

  return { ok: true, log, remaining };
}

// -----------------------------------------------------------------
// 6. UTILITAIRES : voiture présente à une position
// -----------------------------------------------------------------

function getCarAt(allCars, col, row, excludeCar = null) {
  return allCars.find(
    (c) =>
      c !== excludeCar &&
      c.col === col &&
      c.row === row &&
      c.status !== CAR_STATUS.ELIMINATED
  );
}

// -----------------------------------------------------------------
// 7. SLAM (p.9-10)
// -----------------------------------------------------------------
// Quand deux voitures se retrouvent dans la même case, elles se
// slamment. Le dé de Slam désigne laquelle des deux bouge (voiture
// du dessus ou du dessous), le dé de Direction indique où. La
// voiture désignée est déplacée d'UNE case dans cette direction,
// quel que soit le coût d'entrée normal de cette case (règle
// confirmée par Mayrik) — mais les effets de la case d'arrivée
// s'appliquent normalement une fois dessus.
//
// Toutes les 6 directions possibles (pas seulement l'arc avant,
// contrairement au mouvement normal).

const DIRECTIONS = {
  front: { dCol: 1, dRow: 0 },
  "front-left": { dCol: 1, dRow: -1 },
  "front-right": { dCol: 1, dRow: 1 },
  rear: { dCol: -1, dRow: 0 },
  "rear-left": { dCol: -1, dRow: -1 },
  "rear-right": { dCol: -1, dRow: 1 }
};

const SIZE_RANK = {
  [CAR_SIZE.SMALL]: 1,
  [CAR_SIZE.MEDIUM]: 2,
  [CAR_SIZE.LARGE]: 3
};

// Dé de slam à 6 faces : 2 faces "top", 4 faces "bottom" (p.10).
// injectedValue permet de forcer un résultat précis pour les tests.
function rollSlamDie(injectedValue = null) {
  if (injectedValue) return injectedValue; // "top" | "bottom"
  return DICE_FACES.SLAM[Math.floor(Math.random() * DICE_FACES.SLAM.length)];
}

// Dé de direction à 6 faces, une par direction (p.10).
// injectedValue permet de forcer une direction précise pour les tests.
function rollDirectionDie(injectedValue = null) {
  if (injectedValue) return injectedValue;
  const faces = Object.keys(DIRECTIONS);
  return faces[Math.floor(Math.random() * faces.length)];
}

// Dé de cascade (Stunt) à 6 faces : 1-2-2-3-3-4 (confirmé par Mayrik).
// Utilisé par les jetons Dazed et Blast Off.
function rollStuntDie(injectedValue = null) {
  if (injectedValue) return injectedValue;
  return DICE_FACES.STUNT[Math.floor(Math.random() * DICE_FACES.STUNT.length)];
}

// Dé de tir à 6 faces : large×3, medium×1, small-medium×1, any×1
// (confirmé par Mayrik, correspond à DICE_FACES.SHOOTING).
function rollShootingDie(injectedValue = null) {
  if (injectedValue) return injectedValue;
  return DICE_FACES.SHOOTING[Math.floor(Math.random() * DICE_FACES.SHOOTING.length)];
}

// Déplace une voiture d'UNE case dans une direction donnée, sans
// tenir compte du coût de terrain (utilisé par le slam, et plus
// tard par les effets d'extension type rampe/desert glass).
// Retourne un log, et déclenche récursivement un nouveau slam si la
// case d'arrivée est déjà occupée (chaîne de slams, p.9).
//
// options est transmis tel quel aux slams en chaîne éventuels
// (mêmes forcedDice / decideReroll que le slam d'origine).
function forceMoveOneSpace(tile, car, allCars, directionName, options = {}) {
  const log = [];
  const delta = DIRECTIONS[directionName];
  const targetCol = car.col + delta.dCol;
  const targetRow = car.row + delta.dRow;

  const space = getSpace(tile, targetCol, targetRow);

  if (space === null) {
    car.status = CAR_STATUS.ELIMINATED;
    log.push(`${car.id} est projetée hors du bord latéral → ÉLIMINÉE`);
    return { log };
  }

  if (space === undefined) {
    log.push(`${car.id} est projetée hors du bord avant/arrière de la tuile (non géré à cette étape)`);
    return { log };
  }

  if (space.terrain === TERRAIN.IMPASSABLE) {
    car.status = CAR_STATUS.ELIMINATED;
    log.push(`${car.id} est projetée sur une case impassable → ÉLIMINÉE`);
    return { log };
  }

  car.col = targetCol;
  car.row = targetRow;
  log.push(`${car.id} est projetée en ${directionName} vers (col ${targetCol}, row ${targetRow}) — terrain ${space.terrain}`);

  // Résolution d'un hazard éventuel (p.7) avant la vérification
  // d'occupation, même logique que dans enterAdjacentSpace.
  const hazardResult = resolveHazard(tile, allCars, car, 0, options);
  log.push(...hazardResult.log);
  if (hazardResult.stopped) {
    // On fait remonter le slam éventuel (ex. Wreck) à l'appelant —
    // utile notamment pour Oil Slick, qui doit savoir si sa glissade
    // a déclenché un slam.
    return { log, slam: hazardResult.slam, eliminated: car.status === CAR_STATUS.ELIMINATED };
  }

  const occupant = getCarAt(allCars, car.col, car.row, car);
  if (occupant) {
    log.push(`${car.id} atterrit sur ${occupant.id} → nouveau slam en chaîne`);
    const chained = resolveSlam(tile, allCars, car, occupant, options);
    log.push(...chained.log);
    return { log, slam: chained };
  }

  return { log };
}

// Résout un slam entre deux voitures empilées dans la même case (p.9-10).
//
// options.forcedDice = { slam, direction, rerolledSlam, rerolledDirection }
//   → force les résultats de dés (tests uniquement ; sinon aléatoire).
//
// options.decideReroll = (context) => boolean
//   → appelée UNIQUEMENT quand les deux voitures ont une taille
//   différente (seul cas où la règle p.9 autorise une relance).
//   context = { largerCar, smallerCar, slamRoll, directionRoll }.
//   Cette fonction est le point d'entrée pour brancher plus tard soit
//   une vraie interaction joueur (popup "Relancer ?"), soit une IA
//   simplifiée (ex. relance si le résultat lui est défavorable).
//   Par défaut, ne relance jamais (comportement neutre tant qu'aucun
//   joueur/IA n'est branché).
function resolveSlam(tile, allCars, topCar, bottomCar, options = {}) {
  const { forcedDice = {}, decideReroll = () => false } = options;
  const log = [];

  let slamRoll = rollSlamDie(forcedDice.slam);
  let directionRoll = rollDirectionDie(forcedDice.direction);
  log.push(`Dé de slam : ${slamRoll} | Dé de direction : ${directionRoll}`);

  const topRank = SIZE_RANK[topCar.size];
  const bottomRank = SIZE_RANK[bottomCar.size];

  if (topRank !== bottomRank) {
    const largerCar = topRank > bottomRank ? topCar : bottomCar;
    const smallerCar = topRank > bottomRank ? bottomCar : topCar;

    const wantsReroll = decideReroll({ largerCar, smallerCar, slamRoll, directionRoll });
    if (wantsReroll) {
      log.push(`${largerCar.id} (voiture plus grande) demande la relance des deux dés`);
      slamRoll = rollSlamDie(forcedDice.rerolledSlam);
      directionRoll = rollDirectionDie(forcedDice.rerolledDirection);
      log.push(`Relance → Dé de slam : ${slamRoll} | Dé de direction : ${directionRoll}`);
    }
  }

  const movingCar = slamRoll === "top" ? topCar : bottomCar;
  log.push(`→ ${movingCar.id} bouge en ${directionRoll}`);

  const moveResult = forceMoveOneSpace(tile, movingCar, allCars, directionRoll, options);
  log.push(...moveResult.log);

  return { log, movingCar, direction: directionRoll };
}

// -----------------------------------------------------------------
// 7bis. HAZARDS (p.7)
// -----------------------------------------------------------------
// Noms de variables alignés sur le matériel officiel (fiche BGG) :
// Blank, Oil Slick, Dirt, Mine, Wreck — 26 jetons au total.
//
// Simplification valable dans les deux cas du rulebook ("discard
// after resolving" pour Mine/Wreck, "remain on board" pour
// Blank/Dirt/Oil Slick qui transforment la case en terrain permanent) :
// CHAQUE jeton ne se déclenche qu'UNE SEULE fois. Pas besoin de suivre
// un état face cachée/face visible séparé — resolveHazard() efface
// toujours le hazard de la case après l'avoir résolu.

const HAZARD_TYPES = {
  BLANK: "blank",       // p.7 "Road" — la case devient une case de route
  OIL_SLICK: "oil_slick",
  DIRT: "dirt",          // p.7 "Mud" — la case devient une case de boue
  MINE: "mine",
  WRECK: "wreck"
};

const HAZARD_TOKEN_COMPOSITION = [
  { type: HAZARD_TYPES.BLANK, count: 6 },
  { type: HAZARD_TYPES.OIL_SLICK, count: 6 },
  { type: HAZARD_TYPES.DIRT, count: 6 },
  { type: HAZARD_TYPES.MINE, count: 4 },
  { type: HAZARD_TYPES.WRECK, count: 4 }
]; // total : 26

function drawHazardToken(injectedValue = null) {
  if (injectedValue) return injectedValue;
  const pool = [];
  for (const entry of HAZARD_TOKEN_COMPOSITION) {
    for (let i = 0; i < entry.count; i++) pool.push(entry.type);
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

// Résout le hazard présent sur la case ACTUELLE de la voiture (déjà
// entrée dessus). remaining = déplacement qu'il lui restait avant
// résolution — utile pour Mine (qui le met à 0) et Oil Slick (qui ne
// consomme rien, donc `remaining` ressort inchangé).
//
// Retourne { log, remaining, stopped, slam? }. stopped=true signifie
// que la séquence de mouvement en cours doit s'arrêter (Mine, Wreck,
// ou élimination survenue pendant la résolution).
function resolveHazard(tile, allCars, car, remaining, options = {}) {
  const log = [];
  const cell = getSpace(tile, car.col, car.row);

  if (!cell || !cell.hazard) {
    return { log, remaining, stopped: false };
  }

  const hazardType = cell.hazard;
  log.push(`${car.id} déclenche un hazard : ${hazardType}`);

  switch (hazardType) {
    case HAZARD_TYPES.BLANK: {
      cell.terrain = TERRAIN.ROAD;
      cell.hazard = null;
      log.push("Case transformée en ROUTE (jeton Blank défaussé)");
      return { log, remaining, stopped: false };
    }

    case HAZARD_TYPES.DIRT: {
      cell.terrain = TERRAIN.MUD;
      cell.hazard = null;
      log.push("Case transformée en BOUE (jeton Dirt défaussé)");
      return { log, remaining, stopped: false };
    }

    case HAZARD_TYPES.OIL_SLICK: {
      cell.terrain = TERRAIN.ROAD;
      cell.hazard = null;
      const direction = rollDirectionDie(options.forcedDice?.oilSlickDirection);
      log.push(`Case transformée en ROUTE (jeton Oil Slick défaussé), glissade en ${direction} (ne coûte aucun déplacement)`);
      const slideResult = forceMoveOneSpace(tile, car, allCars, direction, options);
      log.push(...slideResult.log);

      if (car.status === CAR_STATUS.ELIMINATED) {
        return { log, remaining: 0, stopped: true, eliminated: true };
      }

      if (slideResult.slam) {
        // Confirmé par Mayrik : un slam déclenché par la glissade suit
        // EXACTEMENT les règles normales du slam — perte de tout le
        // déplacement restant, empilement, relance possible pour le
        // véhicule strictement plus grand, etc. Tout ça est déjà géré
        // par resolveSlam à l'intérieur de forceMoveOneSpace ci-dessus ;
        // ici on se contente d'aligner remaining/stopped sur ce fait.
        log.push(`${car.id} — slam déclenché par la glissade : traité comme un slam normal (perte du déplacement restant)`);
        return { log, remaining: 0, stopped: true, slam: slideResult.slam };
      }

      // p.7 : "does not cost a move, and the vehicle continues moving
      // if it has moves remaining" → pas de slam, le mouvement en
      // cours continue normalement avec le même `remaining`.
      return { log, remaining, stopped: false };
    }

    case HAZARD_TYPES.MINE: {
      cell.hazard = null;
      log.push("Jeton Mine défaussé");
      const dmgResult = applyDamage(car, { ...options, tile, allCars });
      log.push(...dmgResult.log);
      log.push(`${car.id} perd tout son déplacement restant (Mine)`);
      return { log, remaining: 0, stopped: true };
    }

    case HAZARD_TYPES.WRECK: {
      cell.hazard = null;
      log.push("Jeton Wreck défaussé, une épave apparaît sur la case");
      // p.7 : les épaves sont traitées comme des petites voitures
      // inopérables, slammées comme n'importe quel véhicule.
      const wreckCar = createCar(null, CAR_SIZE.SMALL, car.col, car.row);
      wreckCar.status = CAR_STATUS.INOPERABLE;
      wreckCar.isWreck = true;
      allCars.push(wreckCar);
      log.push(`Épave créée : ${wreckCar.id}`);
      const slamResult = resolveSlam(tile, allCars, car, wreckCar, options);
      log.push(...slamResult.log);
      return { log, remaining: 0, stopped: true, slam: slamResult };
    }

    default:
      return { log, remaining, stopped: false };
  }
}


// Le compteur/statut (opérable → inopérable au 2e dégât) ET le
// contenu réel des 5 types de jetons sont gérés ici.
//
// NOTE : la répartition exacte des 20 jetons entre les 5 types n'est
// pas encore confirmée par Mayrik (le rulebook dit juste "Skid : 6
// jetons différents", sans préciser les quantités des 4 autres) —
// drawDamageToken() ci-dessous reste donc un TIRAGE PLACEHOLDER à
// ajuster une fois la vraie répartition connue. En attendant, le
// type de jeton est toujours forçable pour les tests et pour la
// résolution manuelle (mine, tir...).

const TOKEN_TYPES = {
  DENT: "dent",
  SHRAPNEL: "shrapnel",
  SKID: "skid",
  DAZED: "dazed",
  BLAST_OFF: "blast_off"
};

// Composition exacte des 20 jetons de dégâts (source : fiche officielle
// BoardGameGeek du jeu, transmise par Mayrik). Chaque jeton Skid a une
// direction FIXE imprimée dessus (6 jetons, un par direction) — c'est
// donc la composition qui porte cette info, pas un tirage séparé.
const DAMAGE_TOKEN_COMPOSITION = [
  { type: TOKEN_TYPES.DENT, count: 3 },
  { type: TOKEN_TYPES.SKID, count: 1, skidDirection: "front" },
  { type: TOKEN_TYPES.SKID, count: 1, skidDirection: "front-left" },
  { type: TOKEN_TYPES.SKID, count: 1, skidDirection: "front-right" },
  { type: TOKEN_TYPES.SKID, count: 1, skidDirection: "rear" },
  { type: TOKEN_TYPES.SKID, count: 1, skidDirection: "rear-left" },
  { type: TOKEN_TYPES.SKID, count: 1, skidDirection: "rear-right" },
  { type: TOKEN_TYPES.SHRAPNEL, count: 3 },
  { type: TOKEN_TYPES.DAZED, count: 3 },
  { type: TOKEN_TYPES.BLAST_OFF, count: 5 }
]; // total : 20

// Tire un jeton au hasard dans la composition ci-dessus (tirage AVEC
// remise pour l'instant — pas encore de pile partagée qui s'épuise
// au fil de la partie ; à revoir si on veut modéliser la vraie pile
// physique qui se vide/se remélange).
// injectedValue permet de forcer un jeton précis pour les tests :
// { type, skidDirection? }.
function drawDamageToken(injectedValue = null) {
  if (injectedValue) return injectedValue;
  const pool = [];
  for (const entry of DAMAGE_TOKEN_COMPOSITION) {
    for (let i = 0; i < entry.count; i++) {
      pool.push({ type: entry.type, skidDirection: entry.skidDirection || null });
    }
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

// Résout l'effet d'un jeton de dégâts déjà tiré (p.12).
// tokenType : une valeur de TOKEN_TYPES.
// options : { forcedDice, skidDirection, decideReroll } — forcedDice
// peut contenir shrapnelDirection / dazedStunt / dazedDirections
// (tableau, une direction par case) / blastOffDirection / blastOffStunt.
function resolveDamageToken(tile, allCars, car, tokenType, options = {}) {
  const forcedDice = options.forcedDice || {};
  const log = [];

  switch (tokenType) {
    case TOKEN_TYPES.DENT: {
      log.push(`${car.id} — jeton DENT : aucun effet`);
      break;
    }

    case TOKEN_TYPES.SHRAPNEL: {
      // p.12 : dé de direction, ligne droite en ignorant tout terrain
      // (même impassable), jusqu'au premier véhicule rencontré ou au
      // bord du plateau (auquel cas rien ne se passe).
      const direction = rollDirectionDie(forcedDice.shrapnelDirection);
      log.push(`${car.id} — jeton SHRAPNEL : direction ${direction}`);
      const delta = DIRECTIONS[direction];
      let scanCol = car.col + delta.dCol;
      let scanRow = car.row + delta.dRow;
      let hit = null;

      while (true) {
        const space = getSpace(tile, scanCol, scanRow);
        if (space === null || space === undefined) break; // bord du plateau atteint
        const occupant = getCarAt(allCars, scanCol, scanRow);
        if (occupant) {
          hit = occupant;
          break;
        }
        scanCol += delta.dCol;
        scanRow += delta.dRow;
      }

      if (hit) {
        log.push(`Shrapnel touche ${hit.id} (même si c'est une des vôtres)`);
        const hitResult = applyDamage(hit, {
          tokenType: TOKEN_TYPES.DENT, // simplification : pas de pioche en cascade pour la voiture touchée
          tile,
          allCars,
          forcedDice,
          decideReroll: options.decideReroll
        });
        log.push(...hitResult.log);
      } else {
        log.push("Shrapnel ne touche rien (bord du plateau atteint)");
      }
      break;
    }

    case TOKEN_TYPES.SKID: {
      // p.12 : 6 jetons différents, chacun avec une direction FIXE
      // imprimée dessus (pas un dé) — direction obligatoire à fournir.
      const direction = options.skidDirection;
      if (!direction) {
        log.push(`${car.id} — jeton SKID : direction manquante (bug d'appel, à corriger)`);
        break;
      }
      log.push(`${car.id} — jeton SKID : direction fixe ${direction}`);
      // Même comportement que le slam : coût de terrain ignoré,
      // élimination si bord/impassable, slam en chaîne si occupé.
      const moveResult = forceMoveOneSpace(tile, car, allCars, direction, options);
      log.push(...moveResult.log);
      break;
    }

    case TOKEN_TYPES.DAZED: {
      // p.12 : dé de cascade = nombre de cases, direction RELANCÉE à
      // chaque case, coût de terrain RESPECTÉ (contrairement à Skid),
      // s'arrête plus tôt si une case fait perdre les déplacements
      // restants (ex. slam).
      let remaining = rollStuntDie(forcedDice.dazedStunt);
      log.push(`${car.id} — jeton DAZED : dé de cascade = ${remaining}`);
      let step = 0;
      while (remaining > 0) {
        const forcedStepDirection = forcedDice.dazedDirections ? forcedDice.dazedDirections[step] : null;
        const direction = rollDirectionDie(forcedStepDirection);
        const delta = DIRECTIONS[direction];
        const targetCol = car.col + delta.dCol;
        const targetRow = car.row + delta.dRow;
        log.push(`  Étape ${step + 1} — direction ${direction}`);

        const stepResult = enterAdjacentSpace(tile, car, allCars, targetCol, targetRow, remaining, options);
        log.push(...stepResult.log);
        remaining = stepResult.remaining;
        step++;

        if (stepResult.stopped) {
          log.push("Dazed s'arrête (élimination, slam, ou plus assez de déplacement)");
          break;
        }
      }
      break;
    }

    case TOKEN_TYPES.BLAST_OFF: {
      // p.12 : dé de direction + dé de cascade = distance en une seule
      // fois, cases intermédiaires totalement ignorées (pas de coût,
      // pas de résolution de hazard sur le trajet). Seule la case
      // d'arrivée compte.
      const direction = rollDirectionDie(forcedDice.blastOffDirection);
      const distance = rollStuntDie(forcedDice.blastOffStunt);
      log.push(`${car.id} — jeton BLAST OFF : direction ${direction}, distance ${distance} (cases intermédiaires ignorées)`);
      const delta = DIRECTIONS[direction];
      const targetCol = car.col + delta.dCol * distance;
      const targetRow = car.row + delta.dRow * distance;

      const space = getSpace(tile, targetCol, targetRow);
      if (space === null) {
        car.status = CAR_STATUS.ELIMINATED;
        log.push(`${car.id} atterrit hors du bord latéral → ÉLIMINÉE`);
        break;
      }
      if (space === undefined) {
        log.push(`${car.id} atterrit hors du bord avant/arrière de la tuile (non géré à cette étape)`);
        break;
      }
      if (space.terrain === TERRAIN.IMPASSABLE) {
        car.status = CAR_STATUS.ELIMINATED;
        log.push(`${car.id} atterrit sur une case impassable → ÉLIMINÉE`);
        break;
      }

      car.col = targetCol;
      car.row = targetRow;
      log.push(`${car.id} atterrit en (col ${targetCol}, row ${targetRow}) — terrain ${space.terrain}`);

      // p.12 : "You are still affected by the space you move into" —
      // un hazard sur la case d'ARRIVÉE s'applique normalement (mais
      // pas sur les cases ignorées entre les deux).
      const hazardResult = resolveHazard(tile, allCars, car, 0, options);
      log.push(...hazardResult.log);
      if (hazardResult.stopped) break;

      const occupant = getCarAt(allCars, car.col, car.row, car);
      if (occupant) {
        log.push(`${car.id} atterrit sur ${occupant.id} → SLAM`);
        const slamResult = resolveSlam(tile, allCars, car, occupant, options);
        log.push(...slamResult.log);
      }
      break;
    }
  }

  return { log };
}

// Applique un dégât à une voiture. Retourne applied:false si le
// dégât est ignoré (voiture déjà inopérable, p.6 : "cannot take
// additional damage ; if it would, ignore it").
//
// options.tokenType : force le type de jeton (sinon tiré via
// drawDamageToken — placeholder tant que la répartition exacte n'est
// pas connue, voir plus haut).
// options.tile / options.allCars : nécessaires pour résoudre les
// effets qui déplacent la voiture (Skid/Dazed/Blast Off) ou qui
// touchent une autre voiture (Shrapnel). Sans eux, seul le
// compteur/statut est mis à jour (utile pour les tests qui ne
// testent que ça).
//
// NOTE : la règle précise aussi que si la voiture était EN TRAIN de
// bouger quand elle prend le dégât (ex. hazard Mine pendant un
// mouvement), elle perd tout déplacement restant. Ce n'est pas géré
// ici — ce sera à la charge de l'appelant (futur code des hazards)
// de mettre `remaining = 0` lui-même après avoir appelé applyDamage.
function applyDamage(car, options = {}) {
  const log = [];

  if (car.status === CAR_STATUS.ELIMINATED) {
    return { log, applied: false };
  }

  // p.7 : "Wrecks are eliminated ... [if they] take any damage." —
  // règle spéciale, à vérifier AVANT la règle générale d'inopérabilité
  // ci-dessous, car une épave est TOUJOURS inopérable par construction
  // (sinon cette règle spéciale ne se déclencherait jamais : elle
  // serait immédiatement absorbée par le cas "déjà inopérable = dégât
  // ignoré" qui s'applique aux voitures normales).
  if (car.isWreck) {
    car.status = CAR_STATUS.ELIMINATED;
    log.push(`${car.id} (épave) prend un dégât → ÉLIMINÉE (règle spéciale des épaves, p.7)`);
    return { log, applied: true, eliminated: true };
  }

  if (car.status === CAR_STATUS.INOPERABLE) {
    log.push(`${car.id} est déjà inopérable → dégât ignoré (aucun jeton pioché)`);
    return { log, applied: false };
  }

  let tokenType = options.tokenType;
  let skidDirection = options.skidDirection;

  if (!tokenType) {
    const drawn = drawDamageToken(options.forcedDice?.drawnToken);
    tokenType = drawn.type;
    if (tokenType === TOKEN_TYPES.SKID && !skidDirection) {
      skidDirection = drawn.skidDirection;
    }
  }

  car.damageTokens.push({ type: tokenType });
  log.push(`${car.id} reçoit un dégât — jeton ${tokenType} (total : ${car.damageTokens.length}/2)`);

  if (car.damageTokens.length >= 2) {
    car.status = CAR_STATUS.INOPERABLE;
    car.facingReversed = true; // "Turn the car to face backward on the road tile" (p.6)
    log.push(`${car.id} devient INOPÉRABLE (2e dégât) → tourne face arrière`);
  }

  if (options.tile && options.allCars) {
    const effectResult = resolveDamageToken(options.tile, options.allCars, car, tokenType, { ...options, skidDirection });
    log.push(...effectResult.log);
  }

  return { log, applied: true };
}

// -----------------------------------------------------------------
// 9. TIR (p.10)
// -----------------------------------------------------------------
// NOTE : les choppers ne sont pas encore modélisés comme entités
// distinctes dans le moteur — cette fonction ne gère donc que le tir
// DEPUIS une voiture. La règle "ne peut pas tirer sur un chopper" et
// le tir DEPUIS un chopper (Airstrike) viendront avec la brique
// choppers, plus tard. Idem pour "premier round : pas de tir" — c'est
// une règle de structure de tour (compteur de round), pas du tir
// lui-même ; elle sera appliquée au niveau du moteur de tour complet.

// Résout un tir d'une voiture vers une autre (ou une épave — p.10 :
// "You may shoot wrecks. Wrecks are treated as inoperable small cars.
// If a wreck takes any damage, it is eliminated" — déjà géré par la
// règle spéciale des épaves dans applyDamage).
//
// options.forcedDice.shootingDie force le résultat du dé pour les tests.
function resolveShoot(tile, allCars, shooter, target, options = {}) {
  const log = [];
  const forcedDice = options.forcedDice || {};

  // p.10 : "You may not shoot choppers."
  if (target.isChopper) {
    log.push(`${target.id} est un chopper → impossible de lui tirer dessus`);
    return { log, hit: false };
  }

  // p.10 : on ne peut tirer que sur une cible dans son arc avant —
  // même règle géométrique que le mouvement (p.9, "Front Arc").
  const arc = getFrontArc(shooter);
  const inArc = arc.some((a) => a.col === target.col && a.row === target.row);
  if (!inArc) {
    log.push(`${target.id} n'est pas dans l'arc avant de ${shooter.id} → tir impossible`);
    return { log, hit: false };
  }

  const roll = rollShootingDie(forcedDice.shootingDie);
  log.push(`${shooter.id} tire sur ${target.id} (taille ${target.size}) — dé de tir : ${roll}`);

  // p.10 : le dé touche si sa valeur correspond exactement à la
  // taille de la cible, "small-medium" touchant Small OU Medium, et
  // "any" touchant n'importe quelle taille.
  const isHit =
    roll === "any" ||
    (roll === "small-medium" && (target.size === CAR_SIZE.SMALL || target.size === CAR_SIZE.MEDIUM)) ||
    roll === target.size;

  if (!isHit) {
    log.push(`Raté — le dé ne correspond pas à la taille de ${target.id}`);
    return { log, hit: false };
  }

  log.push(`Touché !`);
  const dmgResult = applyDamage(target, { ...options, tile, allCars });
  log.push(...dmgResult.log);

  return { log, hit: true, damageResult: dmgResult };
}

// Commande Repair (p.8, dé = 6) : retire un dégât et rend
// l'opérabilité si la voiture était inopérable.
function repairCar(car) {
  const log = [];

  if (car.status === CAR_STATUS.ELIMINATED) {
    log.push(`${car.id} est éliminée, impossible à réparer`);
    return { log, repaired: false };
  }

  if (car.damageTokens.length === 0) {
    log.push(`${car.id} n'a aucun dégât à réparer`);
    return { log, repaired: false };
  }

  car.damageTokens.pop(); // remis dans la pile de jetons — pas modélisé ici (pas encore de pile globale)
  log.push(`${car.id} répare un dégât (reste : ${car.damageTokens.length}/2)`);

  if (car.status === CAR_STATUS.INOPERABLE && car.damageTokens.length < 2) {
    car.status = CAR_STATUS.OPERABLE;
    car.facingReversed = false;
    log.push(`${car.id} redevient OPÉRABLE (et pourra bouger plus tard ce round si un tour lui reste)`);
  }

  return { log, repaired: true };
}

// -----------------------------------------------------------------
// 11. COMMAND BOARD (p.8) — ÉTAPE 2 DU MOTEUR DE TOUR
// -----------------------------------------------------------------
// Chaque commande valide son propre dé (certaines exigent une valeur
// précise) et applique son effet. La règle "une seule commande par
// ROUND" et "commande activée AVANT le mouvement de la voiture
// assignée" seront appliquées par le futur assemblage du tour complet
// (playTurnAssignMove sera étendu pour orchestrer tout ça) — ces 4
// fonctions restent volontairement indépendantes et testables seules.

// AIRSTRIKE (n'importe quel dé, p.8) : place le chopper sur une case
// vide, puis tire avec s'il en a l'occasion ("if able" — si
// options.shootTarget est fourni ET valide, sinon aucun tir n'a lieu,
// ce n'est pas une erreur). La règle "pas de tir au 1er round"
// s'appliquera au niveau du futur moteur de round complet.
function resolveAirstrikeCommand(tile, allCars, allChoppers, chopper, col, row, options = {}) {
  const log = [];

  const placeResult = placeChopperAirstrike(tile, allCars, allChoppers, chopper, col, row);
  if (!placeResult.ok) {
    return { ok: false, reason: placeResult.reason };
  }
  log.push(`AIRSTRIKE : chopper de ${chopper.owner} placé en (col ${col}, row ${row})`);

  let shootResult = null;
  if (options.shootTarget) {
    shootResult = resolveShoot(tile, allCars, chopper, options.shootTarget, options);
    log.push(...shootResult.log);
  }

  return { ok: true, log, shootResult };
}

// NITRO (dé 1-3, p.8) : augmente le mouvement de la voiture assignée
// de la valeur de CE dé, en plus du dé de mouvement normal. Fonction
// pure : elle ne fait que calculer/valider le bonus, à additionner au
// dé de mouvement avant d'appeler moveCar (composition faite par le
// futur assemblage du tour).
function resolveNitroCommand(dieValue) {
  if (dieValue < 1 || dieValue > 3) {
    return { ok: false, reason: "Nitro nécessite un dé de valeur 1 à 3." };
  }
  return { ok: true, bonus: dieValue };
}

// DRIFT (dé 3-5, p.8) : valide le dé et renvoie le flag à transmettre
// à moveCar (slamOptions.driftAvailable) — la mécanique elle-même est
// déjà intégrée dans moveCar/enterAdjacentSpace (voir plus haut).
function resolveDriftCommand(dieValue) {
  if (dieValue < 3 || dieValue > 5) {
    return { ok: false, reason: "Drift nécessite un dé de valeur 3 à 5." };
  }
  return { ok: true, driftAvailable: true };
}

// REPAIR (dé 6, p.8) : valide le dé, puis délègue à repairCar() déjà
// existant et testé.
function resolveRepairCommand(dieValue, car) {
  if (dieValue !== 6) {
    return { ok: false, reason: "Repair nécessite un dé de valeur 6." };
  }
  return { ok: true, ...repairCar(car) };
}

// -----------------------------------------------------------------
// 12. MOTEUR DE TOUR — ÉTAPE 1 : ASSIGN + MOVE + END OF TURN (p.8, p.11)
// -----------------------------------------------------------------
// Volontairement limité pour l'instant à ces 3 sous-étapes du tour.
// PAS ENCORE inclus (viendront dans une prochaine étape, testée à
// part) :
//   - COMMAND (Airstrike/Nitro/Drift/Repair)
//   - SHOOT (dont la règle "pas de tir au 1er round")
//   - COAST (assigner un dé à une voiture déjà déplacée ce round,
//     max 2 fois) — variante de ASSIGN non couverte ici
//   - la rotation entre joueurs / le compteur de rounds complet
//
// playTurnAssignMove() couvre donc, pour UNE voiture d'UN joueur :
//   1. ASSIGN : vérifie que la voiture est opérable et n'a pas déjà
//      été assignée ce round (p.8).
//   2. MOVE : délègue à moveCar(), déjà entièrement testé.
//   3. END OF TURN (p.11) : marque la voiture comme "déjà jouée ce
//      round", puis vérifie l'élimination par chopper — cette
//      dernière vérification porte sur TOUTES les voitures en jeu,
//      pas seulement celle qui vient de bouger (conforme à la règle,
//      qui ne limite pas cette vérification à la voiture du tour).

function playTurnAssignMove(tile, car, dieValue, chosenPath, allCars, allChoppers, options = {}) {
  const log = [];

  // --- ASSIGN ---
  if (car.status !== CAR_STATUS.OPERABLE) {
    return { ok: false, reason: `${car.id} n'est pas opérable, ne peut pas être assignée.` };
  }
  if (car.movedThisRound) {
    return { ok: false, reason: `${car.id} a déjà été assignée ce round.` };
  }
  log.push(`ASSIGN : dé ${dieValue} assigné à ${car.id}`);

  // --- MOVE ---
  const moveResult = moveCar(tile, car, dieValue, chosenPath, allCars, options);
  log.push(...moveResult.log);

  // --- SHOOT (p.10) ---
  // "The car you moved ... may shoot" — MÊME après un slam (p.10 :
  // "You may shoot after resolving a slam"), donc on ne bloque PAS le
  // tir juste parce que moveResult contient un slam ou s'est arrêté
  // prématurément. On bloque seulement si :
  //   - aucune cible n'a été fournie (pas de tir tenté, "if able")
  //   - le 1er round (armes pas encore actives, p.10) — vérifié via
  //     options.roundNumber, fourni par le futur moteur de round
  //   - la voiture n'est plus opérable (éliminée ou inopérable) après
  //     son mouvement (une voiture inopérable ne peut ni bouger ni
  //     tirer, p.6)
  let shootResult = null;
  const isFirstRound = options.roundNumber === 1;

  if (options.shootTarget) {
    if (isFirstRound) {
      log.push(`Tir impossible : les armes ne sont pas encore actives au 1er round (p.10)`);
    } else if (car.status !== CAR_STATUS.OPERABLE) {
      log.push(`${car.id} n'est plus opérable → tir impossible`);
    } else {
      shootResult = resolveShoot(tile, allCars, car, options.shootTarget, options);
      log.push(...shootResult.log);
    }
  }

  // --- END OF TURN (p.11) ---
  // Après le tir, pas juste après le mouvement (ordre exact du tour,
  // p.8 : Assign → Command → Move → Shoot, puis fin de tour).
  car.movedThisRound = true;
  log.push(`END OF TURN : ${car.id} ne pourra plus être assignée ce round`);

  const chopperElim = eliminateCarsOnChoppers(allCars, allChoppers || []);
  log.push(...chopperElim.log);

  return { ok: true, log, moveResult, shootResult };
}



module.exports = {
  TERRAIN,
  MOVE_COST,
  CAR_SIZE,
  CAR_STATUS,
  DIRECTIONS,
  DICE_FACES,
  TOKEN_TYPES,
  DAMAGE_TOKEN_COMPOSITION,
  HAZARD_TYPES,
  HAZARD_TOKEN_COMPOSITION,
  drawHazardToken,
  resolveHazard,
  createTestTile,
  getSpace,
  createCar,
  createChopper,
  placeChopperAirstrike,
  eliminateCarsOnChoppers,
  getFrontArc,
  getCarAt,
  enterAdjacentSpace,
  moveCar,
  rollSlamDie,
  rollDirectionDie,
  rollStuntDie,
  rollShootingDie,
  resolveShoot,
  forceMoveOneSpace,
  resolveSlam,
  drawDamageToken,
  resolveDamageToken,
  applyDamage,
  repairCar,
  resolveAirstrikeCommand,
  resolveNitroCommand,
  resolveDriftCommand,
  resolveRepairCommand,
  playTurnAssignMove
};
