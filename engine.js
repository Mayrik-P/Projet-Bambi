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
    movedThisTurn: false
  };
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

function moveCar(tile, car, dieValue, chosenPath, allCars = []) {
  // chosenPath : liste de directions ("front-left" | "front" | "front-right"),
  // une par case franchie. Pour l'étape 1, c'est le joueur (ou plus
  // tard l'IA) qui choisit ce chemin à l'avance ; le moteur se
  // contente de vérifier et d'appliquer.
  // allCars : toutes les voitures en jeu, pour détecter les cases occupées.

  if (car.status !== CAR_STATUS.OPERABLE) {
    return { ok: false, reason: "La voiture n'est pas opérationnelle." };
  }

  let remaining = dieValue;
  const log = [];

  for (const direction of chosenPath) {
    if (remaining <= 0) break;

    const arc = getFrontArc(car);
    const target = arc.find((a) => a.name === direction);
    if (!target) {
      return { ok: false, reason: `Direction invalide : ${direction}` };
    }

    const space = getSpace(tile, target.col, target.row);

    if (space === null) {
      // Sortie par le bord gauche/droit → élimination (p.5)
      car.status = CAR_STATUS.ELIMINATED;
      log.push(`${car.id} sort par le bord latéral → ÉLIMINÉE`);
      return { ok: true, log, eliminated: true };
    }

    if (space === undefined) {
      // Sortie par l'avant/arrière de la tuile — géré à l'étape
      // "plusieurs tuiles qui défilent", pas encore ici.
      log.push(`${car.id} atteint le bord avant/arrière de la tuile (non géré à cette étape)`);
      return { ok: true, log, offTileEdge: true };
    }

    if (space.terrain === TERRAIN.IMPASSABLE) {
      car.status = CAR_STATUS.ELIMINATED;
      log.push(`${car.id} entre sur une case impassable → ÉLIMINÉE`);
      return { ok: true, log, eliminated: true };
    }

    const cost = MOVE_COST[space.terrain];
    const mudExceptionApplies = space.terrain === TERRAIN.MUD && remaining === 1; // p.7 : entrer dans la boue avec 1 seul déplacement restant est autorisé

    if (cost > remaining && !mudExceptionApplies) {
      return { ok: false, reason: "Pas assez de déplacements restants pour cette case." };
    }

    // On entre dans la case
    car.col = target.col;
    car.row = target.row;
    remaining = mudExceptionApplies ? 0 : remaining - cost;
    log.push(`${car.id} avance en ${direction} vers (col ${target.col}, row ${target.row}) — terrain ${space.terrain}`);

    // Case occupée par une autre voiture (p.7/p.9) : perte immédiate de
    // tout déplacement restant, empilement, et résolution du slam.
    const occupant = getCarAt(allCars, target.col, target.row, car);
    if (occupant) {
      log.push(`${car.id} entre dans la case de ${occupant.id} → SLAM`);
      remaining = 0;
      const slamResult = resolveSlam(tile, allCars, car, occupant);
      log.push(...slamResult.log);
      return { ok: true, log, remaining: 0, slam: slamResult };
    }
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

// Déplace une voiture d'UNE case dans une direction donnée, sans
// tenir compte du coût de terrain (utilisé par le slam, et plus
// tard par les effets d'extension type rampe/desert glass).
// Retourne un log, et déclenche récursivement un nouveau slam si la
// case d'arrivée est déjà occupée (chaîne de slams, p.9).
function forceMoveOneSpace(tile, car, allCars, directionName, forcedDice = {}) {
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

  const occupant = getCarAt(allCars, targetCol, targetRow, car);
  if (occupant) {
    log.push(`${car.id} atterrit sur ${occupant.id} → nouveau slam en chaîne`);
    const chained = resolveSlam(tile, allCars, car, occupant, forcedDice);
    log.push(...chained.log);
  }

  return { log };
}

// Résout un slam entre deux voitures empilées dans la même case.
// forcedDice = { slam: "top"|"bottom", direction: nom de direction }
// permet de forcer le résultat pour les tests (sinon aléatoire).
function resolveSlam(tile, allCars, topCar, bottomCar, forcedDice = {}) {
  const log = [];

  let slamRoll = rollSlamDie(forcedDice.slam);
  let directionRoll = rollDirectionDie(forcedDice.direction);

  // p.9 : si une voiture est plus grande que l'autre, le propriétaire
  // de la plus grande peut demander UNE relance des deux dés — même
  // si la plus grande est inopérable ou si les deux appartiennent au
  // même joueur. Pour l'instant, exposé via forcedDice.reroll = true
  // (décision du joueur/IA prise en amont, pas encore automatisée ici).
  if (SIZE_RANK[topCar.size] !== SIZE_RANK[bottomCar.size] && forcedDice.reroll) {
    log.push("Relance demandée (voiture plus grande impliquée dans le slam)");
    slamRoll = rollSlamDie(forcedDice.rerolledSlam);
    directionRoll = rollDirectionDie(forcedDice.rerolledDirection);
  }

  const movingCar = slamRoll === "top" ? topCar : bottomCar;
  log.push(`Dé de slam : ${slamRoll} → ${movingCar.id} bouge | Dé de direction : ${directionRoll}`);

  const moveResult = forceMoveOneSpace(tile, movingCar, allCars, directionRoll, forcedDice);
  log.push(...moveResult.log);

  return { log, movingCar, direction: directionRoll };
}

// -----------------------------------------------------------------
// EXPORTS (pour test-engine.js)
// -----------------------------------------------------------------

module.exports = {
  TERRAIN,
  MOVE_COST,
  CAR_SIZE,
  CAR_STATUS,
  DIRECTIONS,
  DICE_FACES,
  createTestTile,
  getSpace,
  createCar,
  getFrontArc,
  getCarAt,
  moveCar,
  rollSlamDie,
  rollDirectionDie,
  forceMoveOneSpace,
  resolveSlam
};
