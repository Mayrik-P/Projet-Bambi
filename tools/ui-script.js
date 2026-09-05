"use strict";

// ===================================================================
// Prototype jouable — Phase 2, point 3 (retour d'usage de Mayrik).
// Aucune logique de jeu n'est réimplémentée ici : tout passe par les
// fonctions du bundle moteur (engine.js + ai-decision.js +
// human-decision.js + turn-executor.js, injectées juste au-dessus).
//
// Remplace complètement l'ancien flux (destination choisie d'un coup
// + cible de tir automatique) par un flux CASE PAR CASE :
//   - le joueur choisit chaque case une par une dans l'arc avant
//     COURANT de sa voiture (executeMoveStep/executeEntryStep,
//     appelés une fois par clic — jamais un chemin précalculé) ;
//   - le Bonus Road, une fois accepté, suit exactement la même boucle
//     case par case, avec son propre budget de points ;
//   - si un pas fait perdre des points de mouvement (Slam, Mine,
//     élimination, ou plus aucune case accessible), un message
//     explicite s'affiche avec un bouton "Continuer" — jamais un
//     enchaînement automatique qui masquerait ce qui vient de se
//     passer ;
//   - une fois le mouvement terminé, le joueur choisit librement sa
//     cible de tir (ou aucune) parmi les options légales.
// L'IA, elle, continue de jouer ses tours de façon atomique via
// executeDecision — aucun changement de ce côté.
// ===================================================================

const HUMAN = "Vous";
const OPPONENT = "IA";
const PLAYER_NAMES = [HUMAN, OPPONENT];
// Couleur de véhicule par joueur — table FIXE temporaire (Mayrik n'a
// pas encore tranché : à terme, un écran proposera le choix parmi les
// 5 couleurs disponibles avant le lancement d'une partie). En
// attendant, changer ces deux valeurs suffit pour tester une autre
// combinaison. Couleurs disponibles : blue/green/orange/purple/white
// (voir cars/images/).
const PLAYER_CAR_COLOR = { [HUMAN]: "blue", [OPPONENT]: "orange" };

// --- Géométrie du plateau (reprise à l'identique des viewers de debug) ---
// --- Calibrage final, réglé à la main par Mayrik avec l'outil
// tools/calage.html (grille interactive posée en transparence sur les
// vraies images, ajustée visuellement jusqu'à correspondance exacte).
// Deux couches INDÉPENDANTES avec leurs propres tailles de case :
// l'image (le visuel des tuiles) et la grille interactive (zones de
// clic/surlignage). Elles n'ont pas exactement la même taille de case
// (37.90 vs 35.60) — c'est normal et volontaire, pas une erreur de
// calcul : réglé ainsi, l'écart s'absorbe naturellement sur la largeur
// totale du plateau sans qu'aucun saut ou correctif par tuile soit
// nécessaire côté grille (contrairement à une précédente version plus
// compliquée qui essayait de faire suivre à la grille les mêmes sauts
// de chevauchement que l'image, ce qui n'était pas la bonne piste).
const TILE_NATIVE_W = 2500, TILE_NATIVE_H = 1891, TILE_NATIVE_COLS = 8, TILE_NATIVE_ROW_UNITS = 7;
const NATIVE_COL_W = TILE_NATIVE_W / TILE_NATIVE_COLS; // 312.5px — largeur native d'une colonne

// Couche IMAGE (le visuel des tuiles)
const IMG_OFFSET_X = 0, IMG_OFFSET_Y = 0;
const IMG_CELL_W = 37.90;
const IMG_CELL_H = IMG_CELL_W * (TILE_NATIVE_H / TILE_NATIVE_ROW_UNITS) / (TILE_NATIVE_W / TILE_NATIVE_COLS); // respecte le vrai rapport largeur/hauteur, jamais de valeur indépendante qui déformerait l'image
// Chevauchement entre tuiles adjacentes (zigzag qui s'emboîte) —
// mesuré ~0.48 largeur de colonne (canal alpha, cohérent sur 3 tuiles).
const TILE_OVERLAP = 0.48 * IMG_CELL_W;

// Couche GRILLE (cases interactives, surlignage) — calage final
// Mayrik. Un pas RÉGULIER par colonne (pas de saut par tuile).
const GRID_OFFSET_X = -3.00, GRID_OFFSET_Y = 32.50;
const GRID_CELL_W = 35.60, GRID_CELL_H = 32.80;
// Amplitude du zigzag et marge de gauche, mesurées sur le canal alpha
// (identiques sur 3 tuiles différentes), exprimées en proportion
// d'une colonne puis appliquées à la taille de case de la GRILLE.
const ZIGZAG_LEFT_MARGIN = GRID_CELL_W * (89.333 / NATIVE_COL_W);
const QUIN = GRID_CELL_W * (57.667 / NATIVE_COL_W), NOTCH = 4;

// --- Images hazards (jetons face cachée + versos persistants) ---
// Confirmé par Mayrik : même résolution native par case que les
// tuiles (mesuré : 316x265px, quasi identique au budget natif d'une
// colonne de tuile, 312.5x270px) — donc AUCUN calage de taille
// nécessaire, contrairement aux véhicules en leur temps. Une seule
// image, taille IMG_CELL_W (la même échelle "1 case" que les tuiles),
// centrée sur cellCenter() comme les véhicules.
const HAZARD_IMG_NATIVE_W = 316, HAZARD_IMG_NATIVE_H = 265;
const HAZARD_IMG_W = IMG_CELL_W;
const HAZARD_IMG_H = HAZARD_IMG_W * (HAZARD_IMG_NATIVE_H / HAZARD_IMG_NATIVE_W);
// Dossier réel du dépôt : "hazards/Images" (I majuscule, contrairement
// à cars/images et tiles/images) — respecter exactement la casse.
const HAZARD_BACK_PATH = "../hazards/Images/hazard-back.webp";
// Versos "persist" (p.7 : Blank/Dirt/Oil Slick restent en place, face
// visible, pour le reste de la partie — voir HAZARD_TYPES, engine.js).
// Mine et Wreck n'apparaissent JAMAIS ici : le moteur les défausse
// entièrement dès leur résolution (cell.hazard remis à null sans
// jamais renseigner cell.revealedHazard) — Wreck redevient une vraie
// voiture (wreckCar, déjà gérée par carImagePath), Mine disparaît
// purement et simplement, comme au livret.
const HAZARD_REVEALED_IMAGE = {
  blank: "../hazards/Images/hazard-road.webp",
  dirt: "../hazards/Images/hazard-mud.webp",
  oil_slick: "../hazards/Images/hazard-oilslick.webp"
};

// Particularité du jeu physique, confirmée par Mayrik : la Finish
// Line ne fait PAS la largeur d'une colonne standard sur les lignes
// 1/3/5 (rangées "pointe sortante") — ses cases y débordent à droite
// du visuel. Sans conséquence : la partie est de toute façon terminée
// dès qu'une voiture l'atteint. On ne cherche donc PAS à faire rentrer
// la grille dans le visuel de la Finish Line à tout prix.
function cellPoly(col, row) {
  const rowTop = GRID_OFFSET_Y + row * GRID_CELL_H;
  const rowBot = rowTop + GRID_CELL_H;
  const mid = (rowTop + rowBot) / 2;
  const quinShift = (row % 2 === 0) ? -QUIN : QUIN;
  const x0 = GRID_OFFSET_X + col * GRID_CELL_W + ZIGZAG_LEFT_MARGIN + quinShift;
  const rx = x0 + GRID_CELL_W + NOTCH;
  return [[x0, rowTop], [x0 + GRID_CELL_W, rowTop], [rx, mid], [x0 + GRID_CELL_W, rowBot], [x0, rowBot], [x0 + NOTCH, mid]];
}
function pts2s(p) { return p.map((v) => v[0].toFixed(1) + "," + v[1].toFixed(1)).join(" "); }
function cellCenter(col, row) {
  const p = cellPoly(col, row);
  const cx = (p[0][0] + p[1][0] + p[3][0] + p[4][0]) / 4 + NOTCH / 2;
  const cy = (p[0][1] + p[3][1]) / 2;
  return { cx, cy };
}
const TERRAIN_FILL = { road: "#4a4a55", off_road: "#7a5c3a", mud: "#3d2a1a", impassable: "#5c2020" };

// L'identifiant d'une tuile réelle (tile.id, ex. "vendetta-01a") est
// posé par instantiateTile() (engine.js) et correspond EXACTEMENT au
// nom de fichier — aucun manifeste séparé à maintenir. La Finish Line
// n'a pas d'id (générée directement par createFinishLineTile(),
// engine.js) mais porte sa propre face visuelle aléatoire (tile.face,
// "a"/"b"). Une tuile de test (createTestTile, utilisée uniquement par
// les suites de tests, jamais par ce prototype) n'a ni id ni face : on
// retombe alors sur le rendu couleur existant, inchangé. Chemin
// relatif à PARTIR DE tools/ (où vit ce prototype), PAS de la racine
// du dépôt — tiles/ est un dossier voisin de tools/, d'où le "../".
function tileImagePath(tile) {
  if (!tile) return null;
  if (tile.face) return `../tiles/images/finishline-${tile.face}.webp`;
  if (tile.id) return `../tiles/images/${tile.id}.webp`;
  return null;
}

// Largeur d'affichage RÉELLE de l'image d'une tuile, en respectant son
// PROPRE rapport largeur/hauteur (jamais une valeur forcée qui la
// déformerait). Les tuiles route standard (2500x1891px, 8 colonnes)
// ont déjà exactement le bon rapport par construction de IMG_CELL_H
// (voir plus haut) : t.cols*IMG_CELL_W est donc déjà correct pour elles.
// La Finish Line est un visuel à part, mesuré différemment
// (364x1891px — plus large qu'1/8 d'une tuile standard) : sa largeur
// est calculée séparément à partir de ses vraies proportions, quitte
// à déborder de quelques pixels de son unique colonne logique plutôt
// que d'être étirée pour la remplir pile.
const FINISHLINE_NATIVE_W = 364, FINISHLINE_NATIVE_H = 1891;
function tileImageWidth(tile) {
  if (tile.face) return (7 * IMG_CELL_H) * (FINISHLINE_NATIVE_W / FINISHLINE_NATIVE_H);
  return tile.cols * IMG_CELL_W;
}

// --- Images véhicules (voitures + choppers) ---
// Tous les fonds transparents (cars/images/*.webp) sont à la même
// taille native (600x332px), véhicule centré dedans (confirmé par
// Mayrik) — un seul ratio suffit donc pour respecter les proportions,
// quelle que soit la taille (small/medium/large) ou le type
// (voiture/chopper). Il suffit de centrer l'image sur cellCenter().
// CAR_IMG_W confirmée correcte par Mayrik dès le premier essai (même
// résolution native utilisée pour tuiles/véhicules/hazards, donc même
// échelle) — aucun calage de taille nécessaire.
const CAR_IMG_NATIVE_W = 600, CAR_IMG_NATIVE_H = 332;
const CAR_IMG_W = GRID_CELL_W * 1.35;
const CAR_IMG_H = CAR_IMG_W * (CAR_IMG_NATIVE_H / CAR_IMG_NATIVE_W);
// Décalage horizontal calé par Mayrik avec tools/calage-vehicules.html :
// compense le fait que le centre géométrique de la case (cellCenter())
// n'est pas perçu visuellement au centre à cause de l'angle rentrant
// gauche du chevron — sans ce décalage, le véhicule mordait trop sur
// cet angle. Positif = vers la droite.
const CAR_IMG_OFFSET_X = 1.50;

// Ombre portée sous chaque véhicule (retour de Mayrik) : donne une
// impression de volume/hauteur au-dessus du plateau. Une ellipse
// générique ne collait pas bien à la silhouette allongée des
// véhicules (retour de Mayrik, 1er essai) — remplacée par une VRAIE
// silhouette : une copie de la même image, teintée en noir via un
// filtre SVG (feColorMatrix, force tous les canaux de couleur à 0 en
// gardant le canal alpha intact — donc la forme exacte du véhicule,
// pas une approximation géométrique), légèrement décalée à 45° vers
// le bas-droite (même distance en X et Y, PAS proportionnelle à
// CAR_IMG_W/H séparément, sinon l'angle ne serait pas un vrai 45°).
// Toujours dans la MÊME orientation que le véhicule (y compris
// retourné à 180° si inopérable) puisque c'est littéralement sa
// propre forme qui est projetée, contrairement à une ellipse externe
// qui n'avait pas à suivre la rotation.
const CAR_SHADOW_OFFSET = CAR_IMG_W * 0.045;
const CAR_SHADOW_OPACITY = 0.4;
function carShadowMarkup(imgPath, x, y, isRotated) {
  const sx = x + CAR_SHADOW_OFFSET, sy = y + CAR_SHADOW_OFFSET;
  // Si le véhicule est retourné à 180° (inopérable), sa silhouette
  // l'est aussi — mais autour du propre centre DÉCALÉ de la silhouette
  // (sx+largeur/2, sy+hauteur/2), jamais celui du véhicule réel :
  // sinon la rotation swinguerait l'ombre à un endroit différent d'un
  // simple décalage, au lieu de rester fidèle à sa position.
  const rotation = isRotated ? `transform="rotate(180 ${(sx + CAR_IMG_W / 2).toFixed(1)} ${(sy + CAR_IMG_H / 2).toFixed(1)})"` : "";
  return `<image href="${imgPath}" xlink:href="${imgPath}" x="${sx.toFixed(1)}" y="${sy.toFixed(1)}" width="${CAR_IMG_W.toFixed(1)}" height="${CAR_IMG_H.toFixed(1)}" ${rotation} filter="url(#vehicleShadowFilter)" opacity="${CAR_SHADOW_OPACITY}" pointer-events="none"/>`;
}

// Même traitement d'ombre portée pour les jetons hazard (retour de
// Mayrik) — même filtre de silhouette partagé (#vehicleShadowFilter,
// défini une seule fois par rendu, générique — pas spécifique aux
// véhicules malgré son nom), même principe de décalage (45°,
// bas-droite), même opacité. S'applique aussi bien à la face cachée
// (hazard-back) qu'aux versos persistants (Road/Mud/Oil Slick) —
// aucune rotation possible pour un hazard (pas de notion
// d'inopérable ici).
// DIFFÉRENCE avec le véhicule (retour de Mayrik après capture d'écran
// réelle) : la silhouette d'une voiture est arrondie, sans jamais
// atteindre une largeur nulle nulle part — un simple décalage laisse
// donc toujours un peu de silhouette qui dépasse tout autour. Le
// jeton hazard, lui, a de VRAIES pointes (pointe droite, encoche
// gauche) où la forme a une largeur quasi nulle : un simple décalage
// y sépare complètement l'ombre du jeton (vide visible constaté par
// Mayrik, "impression de flotter"). Correction : l'ombre est aussi
// LÉGÈREMENT AGRANDIE (pas seulement décalée) autour de son propre
// centre déjà décalé — elle déborde donc un peu de partout, ce qui
// comble ce vide au niveau des pointes tout en gardant le décalage
// diagonal comme direction dominante.
const HAZARD_SHADOW_OFFSET = HAZARD_IMG_W * 0.045;
const HAZARD_SHADOW_SCALE = 1.10;
function hazardShadowMarkup(imgPath, x, y) {
  const realCenterX = x + HAZARD_IMG_W / 2, realCenterY = y + HAZARD_IMG_H / 2;
  const shadowCenterX = realCenterX + HAZARD_SHADOW_OFFSET, shadowCenterY = realCenterY + HAZARD_SHADOW_OFFSET;
  const shadowW = HAZARD_IMG_W * HAZARD_SHADOW_SCALE, shadowH = HAZARD_IMG_H * HAZARD_SHADOW_SCALE;
  const sx = shadowCenterX - shadowW / 2, sy = shadowCenterY - shadowH / 2;
  return `<image href="${imgPath}" xlink:href="${imgPath}" x="${sx.toFixed(1)}" y="${sy.toFixed(1)}" width="${shadowW.toFixed(1)}" height="${shadowH.toFixed(1)}" filter="url(#vehicleShadowFilter)" opacity="${CAR_SHADOW_OPACITY}" pointer-events="none"/>`;
}

// L'épave (wreck.webp) n'a pas de couleur de propriétaire (p.7 : pion
// neutre). Chemin relatif à partir de tools/ (où vit ce prototype),
// comme tileImagePath() ci-dessus.
function carImagePath(car) {
  if (car.isWreck) return "../cars/images/wreck.webp";
  return `../cars/images/${car.size}-${PLAYER_CAR_COLOR[car.owner]}.webp`;
}
function chopperImagePath(ch) {
  return `../cars/images/chopper-${PLAYER_CAR_COLOR[ch.owner]}.webp`;
}


// ===================================================================
// ÉTAT DE JEU — initialisation
// ===================================================================
let G = null; // { progressionState, allCars, allChoppers, roundState }
let sel = {}; // sélection/progression en cours de construction pour le tour humain
let fullLog = []; // journal cumulé affiché sous le plateau
let gameOver = false;
let gameOverInfo = null;

function newGame() {
  const rawTiles = loadRealTiles();
  let setup, attempts = 0;
  do { setup = setupTileProgressionFromRawData(rawTiles, { playerCount: 2 }); attempts++; } while (!setup.ok && attempts < 20);
  const progressionState = createTileProgressionState(setup.rearTile, setup.middleTile, setup.leadTile, setup.drawPile, { playerCount: 2 });
  const allCars = [];
  const allChoppers = [];
  for (const name of PLAYER_NAMES) {
    allChoppers.push(createChopper(name));
    allCars.push(createCarOffBoard(name, CAR_SIZE.SMALL));
    allCars.push(createCarOffBoard(name, CAR_SIZE.MEDIUM));
    allCars.push(createCarOffBoard(name, CAR_SIZE.LARGE));
  }
  const roundState = createRoundState(PLAYER_NAMES);
  G = { progressionState, allCars, allChoppers, roundState, aiPending: null, aiAnimating: false };
  sel = {};
  fullLog = [];
  gameOver = false;
  gameOverInfo = null;
}

function board() { return buildBoardFromProgressionState(G.progressionState); }

function pushLogLines(lines, turnLabel) {
  if (turnLabel) fullLog.push({ sep: turnLabel });
  for (const l of lines) fullLog.push({ line: l });
}

// Une seule séparation de tour affichée, même si le tour humain
// pousse maintenant son log en plusieurs fois (Assign+Command, chaque
// pas de mouvement, tir, fin de tour) plutôt qu'en un seul bloc comme
// avant.
function logTurn(lines) {
  const label = sel.turnStarted ? undefined : sel.turnLabel;
  pushLogLines(lines, label);
  sel.turnStarted = true;
}

function checkEnd() {
  const end = checkGameEndConditions(G.progressionState, G.allCars, G.allChoppers, PLAYER_NAMES);
  if (end && end.gameOver) {
    gameOver = true;
    gameOverInfo = end;
    pushLogLines(end.log || []);
  }
}

// ===================================================================
// TOUR DE L'IA — un clic pour déclencher. Depuis le chantier
// générateurs (docs/rewrite-plan.md), le tour de l'IA n'est plus
// forcément atomique : un Slam (direct ou révélé par un Wreck)
// survenant PENDANT ce tour et impliquant une voiture DU JOUEUR
// HUMAIN plus grande met désormais la résolution en pause pour lui
// demander sa décision de relance (p.9) — exactement comme pour son
// propre tour — au lieu de retomber silencieusement sur la politique
// par défaut de l'IA (écart remonté par Mayrik le 25/08, cf. journal).
// G.aiPending, quand présent, retient le générateur en pause :
// { gen, ctx, turnLabel } — voir resumeAiSlamRerollChoice() plus bas.
// ===================================================================
function playAiTurn() {
  ensureRoadDieRolled(G.roundState);
  const cp = getCurrentPlayer(G.roundState);
  if (!cp || cp !== OPPONENT) return;
  const b = board();
  const decision = decideAssignAndCommand(G.progressionState, b, G.allCars, G.allChoppers, G.roundState.dicePool, cp, G.roundState);
  if (!decision) {
    const log = [`${cp} : rien à jouer → passe forcée.`];
    advanceTurn(G.roundState, G.allCars).log.forEach((l) => log.push(l));
    pushLogLines(log, `Round ${G.roundState.roundNumber} — ${cp}`);
    checkEnd();
    resetSelection();
    render();
    return;
  }
  // Verrou anti double-clic PENDANT l'animation case par case : les
  // pauses {type:"step"} passent par setTimeout (voir
  // driveAiTurnGenerator, qui pose G.aiAnimating dès son premier
  // appel), donc playAiTurn() rend la main au navigateur entre deux
  // cases — sans ce verrou, un second clic sur "Jouer le tour de
  // l'IA" pendant ce délai lancerait UNE SECONDE décision en parallèle
  // sur le même état de jeu.
  const gen = executeDecisionGen(G.progressionState, G.roundState, G.allCars, G.allChoppers, PLAYER_NAMES, cp, decision, {
    isHumanOwner: (owner) => owner === HUMAN,
    emitSteps: true // pause visuelle case par case (voir driveAiTurnGenerator) — jamais activé côté self-play/tests
  });
  driveAiTurnGenerator(gen, `Round ${G.roundState.roundNumber} — ${cp}`);
}

// Délai (ms) entre deux cases affichées pendant le mouvement de l'IA —
// PUREMENT VISUEL, aucun effet sur les règles ni sur l'issue de la
// partie (voir engine.js, `options.emitSteps`). Demandé par Mayrik le
// 28/08 : lire le log à chaque tour pour repérer un mouvement suspect
// est trop lent sur un grand nombre de parties ; un petit temps de
// pause à chaque case permet de le voir directement au coup d'œil.
// 0 = pas de pause du tout (utile pour l'automatisation/les tests —
// voir test-ui-ai-step-pause.js). Pensé pour devenir un réglage de
// vitesse choisi par le joueur dans le jeu définitif (Mayrik).
let AI_STEP_DELAY_MS = 500;

// Fait avancer le générateur du tour IA en cours jusqu'à sa fin OU
// jusqu'à sa prochaine pause. DEUX types de pause bien distincts :
//   - {type:"step", ...} : purement informative, aucune décision à
//     prendre — on affiche juste la nouvelle position, on attend
//     AI_STEP_DELAY_MS, puis on reprend automatiquement tout seul
//     (gen.next() sans réponse : la valeur reprise n'est jamais lue,
//     voir engine.js).
//   - {type:"slam-reroll", ...} : demande une VRAIE décision du joueur
//     (inchangé depuis le chantier générateurs) — stocke le
//     générateur dans G.aiPending et attend un clic.
// Une pause peut se reproduire plusieurs fois d'affilée peu importe le
// type (ex. plusieurs cases d'affilée, ou un Slam en chaîne qui
// implique une DEUXIÈME voiture humaine) — chaque pause est traitée de
// façon identique, sans code spécial, puisque le générateur reprend
// exactement là où il s'est arrêté.
function driveAiTurnGenerator(gen, turnLabel, answer) {
  G.aiAnimating = true;
  const outcome = driveInteractive(gen, answer);
  if (!outcome.done) {
    if (outcome.pending.type === "step") {
      render(); // affiche IMMÉDIATEMENT la case qui vient d'être atteinte
      // Victoire IMMÉDIATE (retour de Mayrik) : un véhicule — y compris
      // celui du joueur humain, projeté par un Slam pendant le tour de
      // l'IA — qui vient d'atteindre la Finish Line doit terminer la
      // partie À CETTE CASE PRÉCISE, sans attendre la fin du tour
      // complet de l'IA (qui peut inclure d'autres actions après ce
      // pas). On abandonne alors le générateur en pause : le moteur a
      // déjà arrêté net le mouvement à cette case (voir engine.js,
      // isFinishLine), donc l'état du plateau reste cohérent.
      checkEnd();
      if (gameOver) {
        G.aiAnimating = false;
        G.aiPending = null;
        render();
        return;
      }
      if (AI_STEP_DELAY_MS > 0) {
        setTimeout(() => driveAiTurnGenerator(gen, turnLabel), AI_STEP_DELAY_MS);
      } else {
        driveAiTurnGenerator(gen, turnLabel);
      }
      return;
    }
    G.aiPending = { gen, ctx: outcome.pending, turnLabel };
    render();
    return;
  }
  G.aiPending = null;
  G.aiAnimating = false;
  pushLogLines(outcome.result.log || [], turnLabel);
  checkEnd();
  resetSelection();
  render();
}

// Réponse du joueur humain à la pause de relance déclenchée PENDANT
// le tour de l'IA (voir le panneau "ai-slam-reroll-choice" dans
// renderPanel). Reprend le même générateur là où il s'est arrêté.
function resumeAiSlamRerollChoice(wantsReroll) {
  if (!G.aiPending) return;
  const { gen, turnLabel } = G.aiPending;
  driveAiTurnGenerator(gen, turnLabel, wantsReroll);
}

// ===================================================================
// TOUR HUMAIN — ASSIGN / COMMAND (inchangé dans son principe : ces
// choix restent groupés AVANT tout mouvement, comme au livret p.8)
// ===================================================================
function resetSelection() {
  sel = { step: "die" };
}

function currentTurnContext() {
  ensureRoadDieRolled(G.roundState);
  const b = board();
  return getTurnContext(G.progressionState, b, G.allCars, G.allChoppers, G.roundState.dicePool, HUMAN, G.roundState);
}

function passHumanTurnIfImpossible(ctx) {
  if (ctx.canPlay) return false;
  const log = [`${HUMAN} : ${ctx.reason}`];
  advanceTurn(G.roundState, G.allCars).log.forEach((l) => log.push(l));
  pushLogLines(log, `Round ${G.roundState.roundNumber} — ${HUMAN}`);
  checkEnd();
  resetSelection();
  return true;
}

function pickDie(dieValue) {
  sel.dieValue = dieValue;
  sel.step = "car";
}

function pickCar(car) {
  sel.car = car;
  sel.step = (sel.mode === "assign" && sel.commandAvailable) ? "command-die" : "commit";
}

// ===================================================================
// COMMAND — choix RÉORGANISÉ (retour de Mayrik, 28/08) : on choisit
// d'abord le DÉ à consacrer à une Command (ou aucun), PUIS seulement
// le TYPE de Command, restreint à celles compatibles avec ce dé —
// inverse de l'ordre précédent (type d'abord, dé ensuite), qui
// obligeait à voir tous les types possibles avant de savoir avec
// quel dé les payer.
// ===================================================================

// Étape 1 : dé consacré à une Command (ou aucun).
function pickCommandDieChoice(dieValue) {
  if (dieValue === null) {
    sel.command = null;
    sel.step = "commit";
    return;
  }
  sel.commandDieValue = dieValue;
  sel.step = "command";
}

// Étape 2 : type de Command, restreint aux seules compatibles avec le
// dé déjà choisi (voir getAvailableCommands([sel.commandDieValue], ...)
// dans renderPanel — un seul dé dans le tableau retourne naturellement
// que les types qui l'acceptent, sans logique dupliquée ici).
function pickCommandChoice(type) {
  sel.commandType = type;
  if (type === "repair") {
    sel.step = "repair-target";
  } else if (type === "airstrike") {
    sel.step = "airstrike-placement"; // plus d'étape de "cible visée" séparée (retour de Mayrik) — la cible se choisit directement en désignant une case de l'arc avant du chopper, une fois posé
  } else {
    sel.command = { type, dieValue: sel.commandDieValue };
    sel.step = "commit";
  }
}

function pickRepairTarget(target) {
  sel.command = { type: "repair", dieValue: 6, target };
  sel.step = "commit";
}

// Airstrike (p.8) — nouveau flux en 2 étapes au lieu de 3 (retour de
// Mayrik) : poser le chopper, PUIS viser directement une case de son
// arc avant (case occupée par un adversaire = tir dessus, case vide
// ou "Ne pas tirer" = aucun tir) — plus de liste de cibles séparée
// avant le placement, qui obligeait à un double choix redondant.
function pickAirstrikePlacement(col, row) {
  sel.airstrikePlacement = { col, row };
  const chopper = G.allChoppers.find((c) => c.owner === HUMAN);
  // Chopper HYPOTHÉTIQUE (copie, jamais muté) : juste posé au bon
  // endroit pour calculer son arc avant AVANT le vrai placement, qui
  // n'aura lieu qu'à l'exécution réelle (commitAssignAndCommand).
  const hypotheticalChopper = { ...chopper, col, row };
  const targets = getShootTargetOptions(hypotheticalChopper, G.allCars);
  if (targets.length === 0) {
    // Rien à viser depuis cette case -> aucune raison de demander quoi
    // que ce soit (même logique que le tir normal sans cible).
    sel.command = { type: "airstrike", dieValue: sel.commandDieValue, target: null, placement: { col, row } };
    sel.step = "commit";
    return;
  }
  sel.step = "airstrike-shoot-arc";
}

function pickAirstrikeShootCell(col, row) {
  const target = G.allCars.find(
    (c) => c.col === col && c.row === row && c.owner !== HUMAN && c.status !== CAR_STATUS.ELIMINATED && !c.isChopper
  ) || null; // case vide cliquée -> null -> pas de tir
  sel.command = { type: "airstrike", dieValue: sel.commandDieValue, target, placement: sel.airstrikePlacement };
  sel.step = "commit";
}

function declineAirstrikeShoot() {
  sel.command = { type: "airstrike", dieValue: sel.commandDieValue, target: null, placement: sel.airstrikePlacement };
  sel.step = "commit";
}

// ===================================================================
// COMMIT — ASSIGN + COMMAND exécutés UNE FOIS (dés retirés du pool,
// Command résolue), point de non-retour : au-delà, "Annuler" n'est
// plus proposé (un dé assigné ne se rend pas, comme sur un vrai
// plateau). Démarre ensuite le mouvement interactif : entrée en jeu
// (colonne 0) si la voiture n'est pas encore sur le plateau, sinon
// directement le premier pas de l'arc avant.
// ===================================================================
function commitAssignAndCommand() {
  sel.turnLabel = `Round ${G.roundState.roundNumber} — ${HUMAN}`;
  sel.turnStarted = false;

  const intent = { car: sel.car, dieValue: sel.dieValue, command: sel.command || null, isCoast: sel.mode === "coast" };
  const { log, effectiveDieValue, slamOptions, pendingAirstrikeShoot } = executeAssignAndCommand(G.roundState, G.allCars, G.allChoppers, G.progressionState, HUMAN, intent);
  logTurn(log);

  sel.slamOptions = slamOptions;
  sel.remaining = intent.isCoast ? 1 : effectiveDieValue;
  sel.roadEligible = true; // accumulé pas à pas (ET logique) tout au long du mouvement
  sel.hadSlam = false; // un Slam met fin à la phase de mouvement complète (p.9) : plus de bonus Road possible ensuite
  sel.hadDamage = false; // p.9/p.12 : "A car loses its remaining moves when it takes damage" — même effet que le Slam sur le bonus Road, quelle que soit la source du dégât (aujourd'hui, uniquement la Mine)
  sel.roadBonusOffered = false;
  sel.inRoadBonus = false;

  if (sel.car.col === null && !intent.isCoast) {
    sel.step = "entry-row";
  } else {
    sel.step = "move-step";
  }
  checkEnd();
  if (!gameOver) checkStuckAtMovementStart();

  // Airstrike (retour de Mayrik) : le chopper vient d'être placé
  // (déjà visible au prochain render(), juste après ce commit) — le
  // tir, lui, n'est résolu qu'après une courte pause PUREMENT VISUELLE
  // (même principe que AI_STEP_DELAY_MS pour le mouvement de l'IA :
  // aucun effet sur les règles), pour que le joueur voie distinctement
  // le chopper atterrir avant de voir le résultat du tir.
  if (pendingAirstrikeShoot && !gameOver) {
    setTimeout(() => {
      const shootOutcome = executeAirstrikeShoot(G.progressionState, G.allCars, G.allChoppers, pendingAirstrikeShoot.chopper, pendingAirstrikeShoot.target, G.roundState.roundNumber);
      logTurn(shootOutcome.log);
      checkEnd();
      render();
    }, AI_STEP_DELAY_MS);
  }
}

// Vérifie qu'il existe au moins une case légale pour le tout PREMIER
// pas du mouvement (entrée en jeu ou arc avant initial) — cas limite
// distinct de celui déjà géré dans handleStepResult (qui, lui, vérifie
// APRÈS chaque pas si le suivant reste possible) : ici, aucun pas n'a
// encore été joué, donc rien dans le log ne peut expliquer un blocage.
// Sans ce contrôle, une voiture dont les 3 cases de l'arc avant sont
// Impassable (ou dont toute la colonne d'entrée l'est) affichait
// "Choisissez la prochaine case" SANS AUCUNE case cliquable et SANS
// AUCUN moyen de continuer — trouvé en pilotant réellement le
// prototype (jsdom), jamais en relisant le code.
function checkStuckAtMovementStart() {
  if (sel.step === "entry-row") {
    const options = getEntryRowOptions(board(), sel.remaining, G.allCars);
    if (options.length === 0) {
      sel.step = "movement-stopped";
      sel.stopMessage = buildStopMessage([], sel.remaining, "aucune case de la colonne d'entrée n'est accessible (toutes Impassable ou coût de terrain trop élevé)");
    }
  } else if (sel.step === "move-step") {
    const options = getMovementStepOptions(board(), sel.car, sel.remaining, G.allCars);
    if (options.length === 0) {
      sel.step = "movement-stopped";
      sel.stopMessage = buildStopMessage([], sel.remaining, "aucune case de l'arc avant n'est accessible depuis la position actuelle (toutes Impassable ou coût de terrain trop élevé)");
    }
  }
}

// ===================================================================
// MOUVEMENT CASE PAR CASE (Point 3)
// ===================================================================

// Extrait {remainingAfter, roadEligible} d'un résultat d'entrée
// (forme plate) ou de mouvement (forme imbriquée sous .moveResult) —
// les deux fonctions renvoient des formes légèrement différentes
// (voir turn-executor.js), jamais réconciliées côté moteur pour ne
// pas risquer de régression sur le chemin IA qui les utilise aussi.
function extractStepOutcome(result, isEntryStep) {
  if (isEntryStep) return { remainingAfter: result.remaining, roadEligible: result.roadEligible, slam: result.slam };
  return {
    remainingAfter: result.moveResult ? result.moveResult.remaining : result.remaining,
    roadEligible: result.roadEligible,
    slam: result.moveResult ? result.moveResult.slam : result.slam
  };
}

function buildStopMessage(log, pointsLost, fallbackReason) {
  const tail = log.length > 0 ? log.slice(-3).join(" — ") : fallbackReason;
  const pointsLabel = pointsLost === 1 ? "1 mouvement perdu" : `${pointsLost} mouvements perdus`;
  return `${pointsLabel} — ${tail}`;
}

// Point d'entrée commun après CHAQUE pas (entrée en jeu, mouvement
// normal, ou pas de Bonus Road — même mécanique dans les 3 cas).
// `remainingBefore`/`option` viennent de l'écran (déjà affichés au
// joueur avant son clic) ; `result`/`isEntryStep` viennent de
// l'exécution réelle du pas.
function handleStepResult(remainingBefore, option, result, isEntryStep) {
  logTurn(result.log || []);
  const { remainingAfter, roadEligible, slam } = extractStepOutcome(result, isEntryStep);
  sel.roadEligible = sel.roadEligible && !!roadEligible;
  sel.hadSlam = sel.hadSlam || !!slam;
  sel.remaining = remainingAfter;

  // Vérification IMMÉDIATE après CE pas précis (pas seulement quand
  // `result.gameOver` est explicitement positionné par le moteur, ce
  // qui n'arrivait en pratique qu'en toute fin de tour via
  // executeEndOfTurn) : une voiture qui vient d'atteindre la Finish
  // Line doit déclarer la victoire ICI, avant même de proposer un tir
  // ou un Bonus Road — jamais après une action supplémentaire (retour
  // de Mayrik).
  checkEnd();
  if (gameOver) {
    resetSelection();
    return;
  }

  const car = sel.car;
  const pointsLost = computePointsLost(remainingBefore, option, remainingAfter);

  if (car.status === CAR_STATUS.ELIMINATED || pointsLost > 0) {
    sel.step = "movement-stopped";
    sel.stopMessage = buildStopMessage(result.log || [], pointsLost > 0 ? pointsLost : remainingBefore);
    return;
  }

  if (remainingAfter === 0) {
    proceedAfterMovement();
    return;
  }

  resumeMovementLoopOrStop(remainingAfter);
}

// Reprend la boucle de mouvement (move-step / road-bonus-step) si au
// moins une case reste légalement accessible depuis la position
// actuelle, sinon signale la perte des points restants — factorisé
// pour être appelé après CHAQUE pas (y compris un décalage de tuile,
// qui ne bloque plus le joueur avec une annonce séparée : le décalage
// reste visible dans le journal via logTurn, mais le mouvement
// continue directement).
function resumeMovementLoopOrStop(remainingAfter) {
  const nextOptions = getMovementStepOptions(board(), sel.car, remainingAfter, G.allCars);
  if (nextOptions.length === 0) {
    sel.step = "movement-stopped";
    sel.stopMessage = buildStopMessage([], remainingAfter, "plus aucune case accessible depuis la position actuelle");
    return;
  }
  sel.step = sel.inRoadBonus ? "road-bonus-step" : "move-step";
}

// ===================================================================
// SLAM — RELANCE INTERACTIVE (p.9, retour de Mayrik) — la relance est
// proposée au joueur humain dès que la voiture PLUS GRANDE dans le
// Slam est la sienne, quelle que soit l'ORIGINE du Slam (occupant déjà
// visible, Wreck révélé à l'instant, OU Slam en chaîne déclenché par
// un dégât Dazed) : `executeEntryStepGen`/`executeMoveStepGen`/
// `executeShootGen` (turn-executor.js) mettent nativement la
// résolution en pause via `isHumanOwner`, exactement comme pour le
// tour de l'IA (voir driveAiTurnGenerator plus haut) — même mécanisme
// générique des deux côtés, sans aucune prévisualisation ni rejeu de
// dés forcés : ancien hack (buildPredictedSlamOpponent/
// matchesPreviewedSlam, limité aux Slams directs et Wreck, jamais aux
// chaînes) retiré au profit de ce mécanisme unique, qui couvre TOUS
// les cas sans distinction.
// ===================================================================

// Fait avancer le générateur d'un pas humain (entrée, mouvement, tir)
// jusqu'à sa fin OU sa prochaine pause — mirroir exact de
// driveAiTurnGenerator, avec `onComplete(result)` appelé une fois le
// pas entièrement résolu (peut lui-même avoir traversé plusieurs
// pauses d'affilée, ex. un Slam en chaîne impliquant deux voitures
// humaines successives — géré nativement, sans code spécial).
function driveHumanStepGenerator(gen, onComplete, answer) {
  const outcome = driveInteractive(gen, answer);
  if (!outcome.done) {
    sel.pendingHumanSlam = { gen, ctx: outcome.pending, onComplete };
    sel.step = "slam-reroll-choice";
    return;
  }
  sel.pendingHumanSlam = null;
  onComplete(outcome.result);
}

// Réponse du joueur à la pause de relance déclenchée pendant SON
// PROPRE pas (entrée, mouvement, ou tir).
function resumeHumanSlamRerollChoice(wantsReroll) {
  if (!sel.pendingHumanSlam) return;
  const { gen, onComplete } = sel.pendingHumanSlam;
  driveHumanStepGenerator(gen, onComplete, wantsReroll);
}

function pickEntryRow(option) {
  const remainingBefore = sel.remaining;
  const damageBefore = sel.car.damageTokens.length;
  const gen = executeEntryStepGen(G.progressionState, G.allCars, sel.car, remainingBefore, option.entryRow, {
    ...sel.slamOptions,
    isHumanOwner: (owner) => owner === HUMAN
  });
  driveHumanStepGenerator(gen, (result) => {
    if (sel.car.damageTokens.length > damageBefore) sel.hadDamage = true;
    handleStepResult(remainingBefore, option, result, true);
  });
}

function pickMoveStep(option) {
  const remainingBefore = sel.remaining;
  const damageBefore = sel.car.damageTokens.length;
  const gen = executeMoveStepGen(G.progressionState, G.allCars, G.allChoppers, PLAYER_NAMES, sel.car, remainingBefore, option.direction, {
    ...sel.slamOptions,
    isHumanOwner: (owner) => owner === HUMAN
  });
  driveHumanStepGenerator(gen, (result) => {
    if (sel.car.damageTokens.length > damageBefore) sel.hadDamage = true;
    handleStepResult(remainingBefore, option, result, false);
  });
}

// Le joueur a pris connaissance du message "mouvements perdus" —
// jamais d'enchaînement automatique avant ce clic explicite (demande
// de Mayrik).
function continueAfterStop() {
  if (sel.inRoadBonus) {
    proceedToShootPhase();
  } else {
    proceedAfterMovement();
  }
}

// ===================================================================
// APRÈS LE MOUVEMENT (principal OU Bonus Road) : Bonus Road d'abord
// (si éligible, jamais offert 2 fois), puis le tir.
// ===================================================================
function proceedAfterMovement() {
  const car = sel.car;
  // p.11 : "You MAY NOT use the road die" pendant un Coast — le bonus
  // Road ne doit JAMAIS être proposé pour ce type de tour, même si la
  // voiture est restée entièrement sur route (correctif du 28/08,
  // retour de Mayrik + capture des règles p.11 : ordre de résolution
  // du mouvement mis à jour dans l'arbre de décision en conséquence).
  if (!sel.roadBonusOffered && !sel.inRoadBonus && !sel.hadSlam && !sel.hadDamage && sel.mode !== "coast" && car.status === CAR_STATUS.OPERABLE && sel.roadEligible && G.roundState.roadDie) {
    sel.roadBonusOffered = true;
    sel.step = "road-bonus-choice";
    return;
  }
  proceedToShootPhase();
}

function acceptRoadBonus() {
  sel.inRoadBonus = true;
  sel.remaining = G.roundState.roadDie;
  const options = getMovementStepOptions(board(), sel.car, sel.remaining, G.allCars);
  if (options.length === 0) {
    logTurn([`Bonus Road non appliqué : aucune case accessible pour les ${sel.remaining} case(s) imposées.`]);
    proceedToShootPhase();
    return;
  }
  sel.step = "road-bonus-step";
}

function declineRoadBonus() {
  proceedToShootPhase();
}

// ===================================================================
// TIR — cible librement choisie (ou aucune), jamais automatique.
// ===================================================================
function proceedToShootPhase() {
  const car = sel.car;
  if (G.roundState.roundNumber === 1) {
    logTurn([`Tir impossible : les armes ne sont pas encore actives au 1er round (p.10).`]);
    finishHumanTurn();
    return;
  }
  if (car.status !== CAR_STATUS.OPERABLE) {
    logTurn([`${car.id} n'est plus opérable → tir impossible.`]);
    finishHumanTurn();
    return;
  }
  sel.shootTargets = getShootTargetOptions(car, G.allCars);
  if (sel.shootTargets.length === 0) {
    logTurn([`Aucune cible à portée pour ${car.id} → tir automatiquement passé.`]);
    finishHumanTurn();
    return;
  }
  sel.step = "shoot";
}

function pickShootTarget(target) {
  const gen = executeShootGen(G.progressionState, G.allCars, G.allChoppers, sel.car, target, G.roundState.roundNumber, {
    ...sel.slamOptions,
    isHumanOwner: (owner) => owner === HUMAN
  });
  driveHumanStepGenerator(gen, (result) => {
    logTurn(result.log || []);
    finishHumanTurn();
  });
}

function finishHumanTurn() {
  const result = executeEndOfTurn(G.progressionState, G.roundState, G.allCars, G.allChoppers, PLAYER_NAMES, sel.car);
  logTurn(result.log || []);
  if (result.gameOver) {
    gameOver = true;
    gameOverInfo = result;
  }
  resetSelection();
}

function cancelSelection() {
  resetSelection();
  render();
}

// ===================================================================
// RENDU
// ===================================================================
function isOnBoard(b, col, row) {
  return col >= 0 && col < b.cols && row >= 0 && row < b.rows;
}

// Sépare les options d'un pas en deux groupes : celles qui tombent sur
// une vraie case du plateau affiché (cliquables directement dessus),
// et celles qui tombent HORS de la grille rendue (sortie latérale/
// arrière -> élimination, ou sortie par l'avant de la tuile de tête)
// — ces dernières n'ont AUCUN polygone dessiné à cet endroit (le rendu
// ne dessine que les cases 0..cols-1 / 0..rows-1), donc jamais
// cliquables sur le plateau : elles restent néanmoins des choix
// légaux (jamais masqués, voir human.getMovementStepOptions) et sont
// proposées comme boutons distincts dans le panneau.
function splitOnAndOffBoardOptions(b, options) {
  const onBoard = [], offBoard = [];
  for (const o of options) {
    const col = o.col !== undefined ? o.col : 0;
    const row = o.entryRow !== undefined ? o.entryRow : o.row;
    (isOnBoard(b, col, row) ? onBoard : offBoard).push(o);
  }
  return { onBoard, offBoard };
}

function offBoardOptionLabel(option) {
  if (option.outcome === "exits-front") return `Continuer vers la tuile suivante (${option.direction})`;
  return `Sortir du plateau — ÉLIMINATION (${option.direction})`;
}

function highlightedCells() {
  if (!sel.step) return [];
  const b = board();
  if (sel.step === "entry-row") {
    const options = getEntryRowOptions(b, sel.remaining, G.allCars);
    const { onBoard } = splitOnAndOffBoardOptions(b, options);
    return onBoard.map((o) => ({ col: 0, row: o.entryRow, onClick: () => { pickEntryRow(o); render(); } }));
  }
  if (sel.step === "move-step" || sel.step === "road-bonus-step") {
    const options = getMovementStepOptions(b, sel.car, sel.remaining, G.allCars);
    const { onBoard, offBoard } = splitOnAndOffBoardOptions(b, options);
    // "exits-front" (sortie par l'avant -> tuile suivante) : pas une
    // élimination, juste la suite normale du plateau. On la propose
    // directement comme case cliquable dans la marge de droite déjà
    // réservée pour la Finish Line (col = b.cols), plutôt que par un
    // bouton texte séparé — même mécanisme de surlignage que le reste
    // du plateau, à la demande de Mayrik.
    const exitsFront = offBoard.filter((o) => o.outcome === "exits-front");
    return [...onBoard, ...exitsFront].map((o) => ({ col: o.col, row: o.row, onClick: () => { pickMoveStep(o); render(); } }));
  }
  if (sel.step === "airstrike-placement") {
    const chopper = G.allChoppers.find((c) => c.owner === HUMAN);
    const placements = listValidAirstrikePlacements(b, G.allCars, G.allChoppers, chopper);
    return placements.map((p) => ({ col: p.col, row: p.row, onClick: () => { pickAirstrikePlacement(p.col, p.row); render(); } }));
  }
  if (sel.step === "airstrike-shoot-arc") {
    const chopper = G.allChoppers.find((c) => c.owner === HUMAN);
    const hypotheticalChopper = { ...chopper, ...sel.airstrikePlacement };
    const arc = getFrontArc(hypotheticalChopper).filter((a) => isOnBoard(b, a.col, a.row));
    return arc.map((a) => ({ col: a.col, row: a.row, onClick: () => { pickAirstrikeShootCell(a.col, a.row); render(); } }));
  }
  return [];
}

// Fenêtre d'affichage resserrée au plus juste (zéro marge inutile,
// choix validé avec Mayrik) : calculée une fois pour toutes en
// simulant le nombre MAXIMAL de tuiles jamais visibles à la fois (3
// tuiles route + Finish Line), sur les DEUX couches (image ET grille,
// qui n'ont pas exactement la même étendue) — sinon l'apparition de
// la Finish Line changerait l'échelle de tout le plateau d'un coup.
const BOARD_VIEW = (() => {
  const tiles = [{ cols: TILE_NATIVE_COLS }, { cols: TILE_NATIVE_COLS }, { cols: TILE_NATIVE_COLS }, { face: "a" }];
  let imgX = IMG_OFFSET_X, imgRight = 0;
  for (const t of tiles) { const w = tileImageWidth(t); imgRight = Math.max(imgRight, imgX + w); imgX += w - TILE_OVERLAP; }
  const imgBottom = IMG_OFFSET_Y + 7 * IMG_CELL_H;
  let gridMaxX = -Infinity, gridMaxY = -Infinity;
  const totalCols = 3 * TILE_NATIVE_COLS + 1;
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < totalCols; col++) {
      const rowBot = GRID_OFFSET_Y + (row + 1) * GRID_CELL_H;
      const quinShift = (row % 2 === 0) ? -QUIN : QUIN;
      const rx = GRID_OFFSET_X + col * GRID_CELL_W + ZIGZAG_LEFT_MARGIN + quinShift + GRID_CELL_W + NOTCH;
      gridMaxX = Math.max(gridMaxX, rx);
      gridMaxY = Math.max(gridMaxY, rowBot);
    }
  }
  return { w: Math.max(imgRight, gridMaxX), h: Math.max(imgBottom, gridMaxY) };
})();

function renderBoard() {
  const b = board();
  const svg = document.getElementById("board");
  svg.setAttribute("viewBox", `0 0 ${BOARD_VIEW.w} ${BOARD_VIEW.h}`);
  svg.innerHTML = "";

  // Filtre de silhouette pour l'ombre des véhicules (voir
  // carShadowMarkup) : force tous les canaux de couleur à 0 tout en
  // gardant le canal alpha (donc la forme) intact — une image de
  // véhicule normale, passée par ce filtre, devient sa propre
  // silhouette noire. Défini UNE SEULE FOIS par rendu (réutilisé par
  // tous les véhicules/choppers via url(#vehicleShadowFilter)), jamais
  // par voiture — inutile de dupliquer un <filter> identique.
  svg.insertAdjacentHTML("beforeend", `<defs><filter id="vehicleShadowFilter" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"/></filter></defs>`);

  const highlights = highlightedCells();
  const highlightMap = new Map(highlights.map((h) => [h.col + "," + h.row, h]));

  // Une image par tuile réelle (rear/middle/lead/finish), dans l'ordre
  // où elles se suivent sur le plateau — même ordre que
  // buildBoardFromProgressionState()/checkGameEndConditions(). Posées
  // AVANT la boucle de cases pour rester sous les polygones/marqueurs/
  // voitures (ordre d'insertion SVG = ordre d'empilement visuel).
  // pointer-events désactivé : les clics continuent d'atteindre le
  // polygone de la case, inchangé, l'image n'est qu'un habillage
  // visuel par-dessus lequel rien ne se déclenche.
  const orderedTiles = [G.progressionState.rearTile, G.progressionState.middleTile, G.progressionState.leadTile, G.progressionState.finishLineTile].filter(Boolean);
  const colHasImage = [];
  let colOffset = 0;
  let imgX = IMG_OFFSET_X; // position réelle de l'image courante — chevauche la précédente
  for (const t of orderedTiles) {
    const imgPath = tileImagePath(t);
    if (imgPath) {
      const imgEl = document.createElementNS("http://www.w3.org/2000/svg", "image");
      imgEl.setAttribute("href", imgPath);
      imgEl.setAttributeNS("http://www.w3.org/1999/xlink", "href", imgPath); // vieux moteurs de rendu SVG
      imgEl.setAttribute("x", imgX);
      imgEl.setAttribute("y", IMG_OFFSET_Y);
      imgEl.setAttribute("width", tileImageWidth(t));
      imgEl.setAttribute("height", 7 * IMG_CELL_H); // 6 lignes cliquables + 1 ligne de bandeau
      imgEl.setAttribute("preserveAspectRatio", "none");
      imgEl.setAttribute("pointer-events", "none");
      svg.appendChild(imgEl);
    }
    for (let c = 0; c < t.cols; c++) colHasImage[colOffset + c] = !!imgPath;
    colOffset += t.cols;
    imgX += tileImageWidth(t) - TILE_OVERLAP;
  }

  for (let row = 0; row < b.rows; row++) {
    for (let col = 0; col < b.cols; col++) {
      const cell = b.grid[row][col];
      const poly = cellPoly(col, row);
      // Une vraie image de tuile couvre déjà cette case : le polygone
      // devient transparent (garde uniquement son rôle de zone
      // cliquable/surbrillance) et perd son contour noir de debug —
      // le contour des cases est déjà dessiné sur le visuel de la
      // tuile. Repli inchangé (couleur + contour) si aucune image.
      const fill = colHasImage[col] ? "transparent" : (TERRAIN_FILL[cell.terrain] || "#444");
      const key = col + "," + row;
      const hl = highlightMap.get(key);
      const polyEl = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      polyEl.setAttribute("points", pts2s(poly));
      polyEl.setAttribute("fill", hl ? "#ffd166" : fill);
      if (hl) polyEl.setAttribute("fill-opacity", "0.55"); // laisse deviner l'image en dessous
      polyEl.setAttribute("stroke", colHasImage[col] ? "none" : "#111");
      polyEl.setAttribute("stroke-width", "0.6");
      if (hl) {
        polyEl.classList.add("clickable");
        polyEl.addEventListener("click", hl.onClick);
      }
      svg.appendChild(polyEl);
      if (cell.hazard) {
        // Face cachée : la vraie image hazard-back (générique, ne
        // révèle rien) — plus de lettre de debug (retour de Mayrik :
        // il veut désormais tester avec les vraies sensations de jeu,
        // sans connaître le type avant de le révéler en jouant).
        const { cx, cy } = cellCenter(col, row);
        const hx = cx - HAZARD_IMG_W / 2, hy = cy - HAZARD_IMG_H / 2;
        svg.insertAdjacentHTML("beforeend", `<g>
          ${hazardShadowMarkup(HAZARD_BACK_PATH, hx, hy)}
          <image href="${HAZARD_BACK_PATH}" xlink:href="${HAZARD_BACK_PATH}" x="${hx.toFixed(1)}" y="${hy.toFixed(1)}" width="${HAZARD_IMG_W.toFixed(1)}" height="${HAZARD_IMG_H.toFixed(1)}" pointer-events="none"/>
        </g>`);
      } else if (cell.revealedHazard && HAZARD_REVEALED_IMAGE[cell.revealedHazard]) {
        // Verso persistant (Blank/Dirt/Oil Slick, p.7) : reste visible
        // pour le reste de la partie, aucune lettre de debug nécessaire
        // puisque c'est déjà une information publique une fois révélée.
        const { cx, cy } = cellCenter(col, row);
        const hx = cx - HAZARD_IMG_W / 2, hy = cy - HAZARD_IMG_H / 2;
        const p = HAZARD_REVEALED_IMAGE[cell.revealedHazard];
        svg.insertAdjacentHTML("beforeend", `<g>
          ${hazardShadowMarkup(p, hx, hy)}
          <image href="${p}" xlink:href="${p}" x="${hx.toFixed(1)}" y="${hy.toFixed(1)}" width="${HAZARD_IMG_W.toFixed(1)}" height="${HAZARD_IMG_H.toFixed(1)}" pointer-events="none"/>
        </g>`);
      }
    }
  }

  // Cases surlignées HORS de la grille réelle (col >= b.cols) : la
  // sortie par l'avant ("exits-front"), affichée dans la marge de
  // droite réservée à la Finish Line (voir highlightedCells()). La
  // boucle ci-dessus ne les couvre jamais (elle s'arrête à b.cols-1) —
  // sans ce complément, ces cases étaient calculées mais jamais
  // dessinées ni cliquables : partie bloquée (bug réel signalé par
  // Mayrik). Pas de case/terrain réel ici, juste le surlignage.
  for (const h of highlights) {
    if (h.col < b.cols) continue;
    const poly = cellPoly(h.col, h.row);
    const polyEl = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    polyEl.setAttribute("points", pts2s(poly));
    polyEl.setAttribute("fill", "#ffd166");
    polyEl.setAttribute("fill-opacity", "0.55");
    polyEl.setAttribute("stroke", "none");
    polyEl.classList.add("clickable");
    polyEl.addEventListener("click", h.onClick);
    svg.appendChild(polyEl);
  }

  // Cas particulier d'empilement : pendant la pause de décision de
  // relance d'un Slam (voir driveHumanStepGenerator/G.aiPending plus
  // haut), la voiture ENTRANTE ("car", passée comme topCar à
  // resolveSlamGen) et celle déjà présente ("occupant"/wreck, passée
  // comme bottomCar) partagent réellement la même case — aucune des
  // deux n'a encore bougé, la résolution est en pause en attendant la
  // réponse du joueur. Convention demandée par Mayrik : la voiture qui
  // vient de percuter (TOP) se dessine PAR-DESSUS celle qui était déjà
  // là (BOTTOM). En dehors de cette pause précise, deux voitures ne
  // partagent jamais la même case (le Slam est entièrement résolu de
  // façon synchrone), donc ce réordonnancement ne s'applique dans
  // aucun autre cas.
  const pendingSlamCtx = (G.aiPending && G.aiPending.ctx) || (sel.pendingHumanSlam && sel.pendingHumanSlam.ctx) || null;
  const slamTopCar = pendingSlamCtx ? pendingSlamCtx.topCar : null;
  const carsInDrawOrder = slamTopCar ? G.allCars.slice().sort((a, b) => (a === slamTopCar ? 1 : 0) - (b === slamTopCar ? 1 : 0)) : G.allCars;

  carsInDrawOrder.forEach((car) => {
    if (car.col === null || car.status === "eliminated") return;
    const { cx, cy } = cellCenter(car.col, car.row);
    const isActive = sel.car === car;
    const imgPath = carImagePath(car);
    const x = cx + CAR_IMG_OFFSET_X - CAR_IMG_W / 2, y = cy - CAR_IMG_H / 2;
    // Voiture inopérable (2 dégâts) : le jeu physique se contente de
    // retourner le véhicule à 180° (il pointe vers l'arrière du
    // plateau, p.8) plutôt que de le retirer — reproduit ici par une
    // rotation de l'image AUTOUR DE SON PROPRE CENTRE (x+largeur/2,
    // qui vaut cx+CAR_IMG_OFFSET_X À CAUSE du décalage de calage, PAS
    // cx tout court) : le centre affiché ne bouge donc pas d'un pixel,
    // seule l'orientation change. Plus de trait blanc en travers.
    // EXCLUT explicitement les épaves (`car.isWreck`) : le moteur leur
    // donne le statut "inoperable" en interne (p.7 : traitées comme de
    // petites voitures inopérables pour le Slam), mais ce n'est qu'une
    // mécanique de jeu — visuellement une épave reste une épave, pas
    // un véhicule endommagé retourné.
    const isInoperableVisual = car.status === "inoperable" && !car.isWreck;
    const imgCenterX = x + CAR_IMG_W / 2;
    const rotation = isInoperableVisual ? `transform="rotate(180 ${imgCenterX.toFixed(1)} ${cy.toFixed(1)})"` : "";
    // pointer-events="none" : l'image est purement visuelle, jamais
    // cible de clic — sans ça, elle s'interpose au-dessus du polygone
    // de la case (posé avant dans le DOM, donc visuellement dessous,
    // mais qui recevait quand même les clics avant) et rendait la case
    // difficile/impossible à cliquer quand un véhicule adverse
    // l'occupe. Le surlignage jaune reste lui aussi au-dessus de tout
    // dans l'ordre visuel (posé sur le polygone, avant les véhicules),
    // inchangé.
    svg.insertAdjacentHTML("beforeend", `<g>
      ${carShadowMarkup(imgPath, x, y, isInoperableVisual)}
      <image href="${imgPath}" xlink:href="${imgPath}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${CAR_IMG_W.toFixed(1)}" height="${CAR_IMG_H.toFixed(1)}" ${rotation} pointer-events="none" ${isInoperableVisual ? 'opacity="0.5"' : ""}/>
      ${isActive ? `<circle cx="${cx}" cy="${cy}" r="16" fill="none" stroke="#ffd166" stroke-width="2.5" pointer-events="none"/>` : ""}
      ${car.damageTokens.length > 0 ? `<circle cx="${cx + 10}" cy="${cy - 8}" r="5" fill="#111" pointer-events="none"/><text x="${cx + 10}" y="${cy - 5}" font-size="7" text-anchor="middle" fill="#e11" pointer-events="none">${car.damageTokens.length}</text>` : ""}
    </g>`);
  });

  G.allChoppers.forEach((ch) => {
    if (!ch.placed || ch.col === null) return;
    const { cx, cy } = cellCenter(ch.col, ch.row);
    const imgPath = chopperImagePath(ch);
    const x = cx + CAR_IMG_OFFSET_X - CAR_IMG_W / 2, y = cy - CAR_IMG_H / 2;
    svg.insertAdjacentHTML("beforeend", `<g>
      ${carShadowMarkup(imgPath, x, y, false)}
      <image href="${imgPath}" xlink:href="${imgPath}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${CAR_IMG_W.toFixed(1)}" height="${CAR_IMG_H.toFixed(1)}" pointer-events="none"/>
    </g>`);
  });
}

function choiceButton(label, onClick, selected) {
  const btn = document.createElement("button");
  btn.className = "choice" + (selected ? " selected" : "");
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

// Étapes AVANT commitAssignAndCommand() : "Annuler" reste possible,
// aucun dé n'a encore quitté le pool. Au-delà (mouvement, tir), plus
// de retour en arrière — un dé assigné ne se rend pas.
const PRE_COMMIT_STEPS = new Set(["car", "die", "command", "command-die", "repair-target", "airstrike-placement", "airstrike-shoot-arc", "commit"]);

function renderPanel() {
  const panel = document.getElementById("panel");
  panel.innerHTML = "";

  if (gameOver) return;

  ensureRoadDieRolled(G.roundState);
  const cp = getCurrentPlayer(G.roundState);
  if (!cp) return;

  if (cp === OPPONENT) {
    const h2 = document.createElement("h2");
    h2.textContent = `Au tour de ${OPPONENT}`;
    panel.appendChild(h2);

    if (G.aiPending) {
      // Pause en cours DANS le tour de l'IA (voir driveAiTurnGenerator) :
      // un Slam implique une voiture DU JOUEUR plus grande — c'est à
      // lui de décider la relance (p.9), exactement comme pour son
      // propre tour (voir "slam-reroll-choice" plus bas).
      const ctx = G.aiPending.ctx;
      const p = document.createElement("div");
      p.textContent = `SLAM pendant le tour de ${OPPONENT} ! Dé de slam : ${ctx.slamRoll} | Dé de direction : ${ctx.directionRoll}. Votre voiture (${ctx.largerCar.size}) est plus grande — voulez-vous relancer les deux dés (une seule relance possible, p.9) ?`;
      panel.appendChild(p);
      const choices = document.createElement("div");
      choices.className = "choices";
      choices.appendChild(choiceButton("Oui, relancer", () => { resumeAiSlamRerollChoice(true); render(); }));
      choices.appendChild(choiceButton("Non, garder ce résultat", () => { resumeAiSlamRerollChoice(false); render(); }));
      panel.appendChild(choices);
      return;
    }

    const btn = document.createElement("button");
    btn.className = "primary";
    btn.textContent = "Jouer le tour de l'IA ▶";
    btn.addEventListener("click", playAiTurn);
    if (G.aiAnimating) {
      // Anti double-clic (voir playAiTurn) : le tour est en cours
      // d'animation case par case (setTimeout), pas de nouvelle
      // décision à lancer par-dessus tant que celle-ci n'est pas
      // terminée.
      btn.disabled = true;
      btn.textContent = "L'IA joue... ▶";
      panel.appendChild(btn);
      return;
    }
    panel.appendChild(btn);
    return;
  }

  // --- Tour humain ---
  const ctx = currentTurnContext();
  if (PRE_COMMIT_STEPS.has(sel.step || "die")) {
    if (passHumanTurnIfImpossible(ctx)) { render(); return; }
    sel.mode = ctx.mode;
    sel.commandAvailable = ctx.commandAvailable;
  }

  const h2 = document.createElement("h2");
  h2.textContent = ctx.mode === "coast" && PRE_COMMIT_STEPS.has(sel.step || "die") ? "Votre tour — Coast (aucune voiture disponible à activer)" : "Votre tour";
  panel.appendChild(h2);

  const choices = document.createElement("div");
  choices.className = "choices";

  if (!sel.step) sel.step = "die";

  if (sel.step === "die") {
    const p = document.createElement("div");
    p.textContent = ctx.mode === "coast" ? "Choisissez un dé à assigner en Coast (comptera comme 1 quelle que soit sa valeur) :" : "Choisissez un dé pour le mouvement :";
    panel.appendChild(p);
    ctx.pool.forEach((d) => {
      choices.appendChild(choiceButton(String(d), () => { pickDie(d); render(); }));
    });
  } else if (sel.step === "car") {
    const p = document.createElement("div");
    p.textContent = `Dé choisi : ${sel.dieValue}. ` + (ctx.mode === "coast" ? "Choisissez la voiture à faire avancer d'une case (Coast) :" : "Choisissez la voiture à activer :");
    panel.appendChild(p);
    const list = ctx.mode === "coast" ? ctx.coastableCars : ctx.activatableCars;
    list.forEach((car) => {
      choices.appendChild(choiceButton(`${car.size} (${car.col === null ? "hors plateau" : "col " + car.col + ",row " + car.row})`, () => { pickCar(car); render(); }));
    });
  } else if (sel.step === "command-die") {
    const p = document.createElement("div");
    p.textContent = "Voulez-vous consacrer un des dés restants à une Command ?";
    panel.appendChild(p);
    const remaining = ctx.pool.filter((v, i) => i !== ctx.pool.indexOf(sel.dieValue));
    choices.appendChild(choiceButton("Aucune Command", () => { pickCommandDieChoice(null); render(); }));
    remaining.forEach((d) => {
      choices.appendChild(choiceButton(String(d), () => { pickCommandDieChoice(d); render(); }));
    });
  } else if (sel.step === "command") {
    const p = document.createElement("div");
    p.textContent = `Dé ${sel.commandDieValue} consacré à une Command — laquelle ?`;
    panel.appendChild(p);
    const myRepairable = G.allCars.filter((c) => c.owner === HUMAN && c.status !== "eliminated" && c.damageTokens.length > 0);
    const commands = getAvailableCommands([sel.commandDieValue], myRepairable);
    commands.forEach((c) => {
      choices.appendChild(choiceButton(c.type, () => { pickCommandChoice(c.type); render(); }));
    });
  } else if (sel.step === "repair-target") {
    const p = document.createElement("div");
    p.textContent = "Repair — choisissez la voiture à réparer :";
    panel.appendChild(p);
    const myRepairable = G.allCars.filter((c) => c.owner === HUMAN && c.status !== "eliminated" && c.damageTokens.length > 0);
    myRepairable.forEach((c) => choices.appendChild(choiceButton(`${c.size} (col ${c.col},row ${c.row})${c.status === "inoperable" ? " [INOPÉRABLE]" : ""}`, () => { pickRepairTarget(c); render(); })));
  } else if (sel.step === "airstrike-placement") {
    const p = document.createElement("div");
    p.textContent = "Cliquez une case surlignée pour placer le chopper (Airstrike).";
    panel.appendChild(p);
  } else if (sel.step === "airstrike-shoot-arc") {
    const p = document.createElement("div");
    p.textContent = "Chopper placé — cliquez une case surlignée (son arc avant) pour tirer dessus si elle est occupée, ou :";
    panel.appendChild(p);
    choices.appendChild(choiceButton("Ne pas tirer", () => { declineAirstrikeShoot(); render(); }));
  } else if (sel.step === "commit") {
    const p = document.createElement("div");
    p.textContent = `Prêt : ${sel.car.size}, dé ${sel.dieValue}${sel.command ? ", Command " + sel.command.type + " (dé " + sel.command.dieValue + ")" : ""}. Le tour va commencer — plus d'annulation possible au-delà.`;
    panel.appendChild(p);
    const btn = document.createElement("button");
    btn.className = "primary";
    btn.textContent = "Commencer le mouvement";
    btn.addEventListener("click", () => { commitAssignAndCommand(); render(); });
    panel.appendChild(btn);
  } else if (sel.step === "entry-row") {
    const p = document.createElement("div");
    p.textContent = `Entrée en jeu — cliquez une case surlignée de la colonne d'entrée (${sel.remaining} point(s) de mouvement disponibles).`;
    panel.appendChild(p);
    const { offBoard } = splitOnAndOffBoardOptions(board(), getEntryRowOptions(board(), sel.remaining, G.allCars));
    offBoard.forEach((o) => choices.appendChild(choiceButton(offBoardOptionLabel({ ...o, direction: "rangée " + o.entryRow }), () => { pickEntryRow(o); render(); })));
  } else if (sel.step === "move-step") {
    const p = document.createElement("div");
    p.textContent = `Choisissez la prochaine case (${sel.remaining} point(s) de mouvement restants).`;
    panel.appendChild(p);
    // Les sorties par l'avant ("exits-front") sont désormais des cases
    // cliquables sur le plateau (marge de droite) — voir
    // highlightedCells(). Les sorties latérales/arrière
    // ("eliminated-edge") ne sont plus proposées du tout ici (ni
    // bouton, ni case) : confirmé avec Mayrik — légal dans les règles
    // (élimination volontaire, jamais interdite en soi) mais aucun
    // joueur ne choisit jamais de s'auto-éliminer un véhicule, donc
    // inutile à proposer. Reste un choix légal côté moteur
    // (human-decision.js inchangé) — seul l'affichage humain le masque.
  } else if (sel.step === "road-bonus-step") {
    const p = document.createElement("div");
    p.textContent = `Bonus Road — choisissez la prochaine case (${sel.remaining} point(s) restants, montant fixe : le trajet doit utiliser tout le bonus).`;
    panel.appendChild(p);
    // Même remarque que pour "move-step" ci-dessus.
  } else if (sel.step === "slam-reroll-choice") {
    const ctx = sel.pendingHumanSlam.ctx;
    const p = document.createElement("div");
    p.textContent = `SLAM ! Dé de slam : ${ctx.slamRoll} | Dé de direction : ${ctx.directionRoll}. Votre voiture (${ctx.largerCar.size}) est plus grande — voulez-vous relancer les deux dés (une seule relance possible, p.9) ?`;
    panel.appendChild(p);
    choices.appendChild(choiceButton("Oui, relancer", () => { resumeHumanSlamRerollChoice(true); render(); }));
    choices.appendChild(choiceButton("Non, garder ce résultat", () => { resumeHumanSlamRerollChoice(false); render(); }));
  } else if (sel.step === "movement-stopped") {
    const msg = document.createElement("div");
    msg.className = "stop-message";
    msg.textContent = sel.stopMessage;
    panel.appendChild(msg);
    const btn = document.createElement("button");
    btn.className = "primary";
    btn.textContent = "Continuer";
    btn.addEventListener("click", () => { continueAfterStop(); render(); });
    panel.appendChild(btn);
  } else if (sel.step === "road-bonus-choice") {
    const p = document.createElement("div");
    p.textContent = `Trajet resté 100% sur route ! Voulez-vous utiliser le bonus Road (+${G.roundState.roadDie} cases, montant fixe, non modifiable) ?`;
    panel.appendChild(p);
    choices.appendChild(choiceButton(`Oui, +${G.roundState.roadDie}`, () => { acceptRoadBonus(); render(); }));
    choices.appendChild(choiceButton("Non merci", () => { declineRoadBonus(); render(); }));
  } else if (sel.step === "shoot") {
    const p = document.createElement("div");
    p.textContent = "Mouvement terminé — choisissez une cible pour le tir, ou ne tirez pas :";
    panel.appendChild(p);
    choices.appendChild(choiceButton("Ne pas tirer", () => { pickShootTarget(null); render(); }));
    (sel.shootTargets || []).forEach((t) => {
      const label = t.isWreck ? "l'épave" : `${t.owner} ${t.size}`; // aucun affichage UI "brut" d'une épave (owner null) — retour de Mayrik
      choices.appendChild(choiceButton(`Tirer sur ${label}`, () => { pickShootTarget(t); render(); }));
    });
  }

  panel.appendChild(choices);

  if (PRE_COMMIT_STEPS.has(sel.step) && sel.step !== "die" && sel.step !== "commit") {
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "secondary";
    cancelBtn.textContent = "Annuler / recommencer ce tour";
    cancelBtn.addEventListener("click", cancelSelection);
    panel.appendChild(cancelBtn);
  }
}

function render() {
  ensureRoadDieRolled(G.roundState);
  document.getElementById("roundBadge").textContent = `Round ${G.roundState.roundNumber}`;
  const cp = getCurrentPlayer(G.roundState);
  document.getElementById("playerBadge").textContent = cp ? `${cp} joue` : "Partie terminée";
  document.getElementById("roadDieBadge").textContent = `Dé Road ce round : ${G.roundState.roadDie}`;
  document.getElementById("commandUsedBadge").textContent = cp ? `Command déjà utilisée par ${cp} : ${G.roundState.commandUsedThisRound[cp] ? "oui" : "non"}` : "";
  document.getElementById("dicePool").innerHTML = cp ? (G.roundState.dicePool[cp] || []).map((d) => `<span class="die">${d}</span>`).join("") : "";

  renderBoard();
  renderPanel();

  document.getElementById("damageRow").innerHTML = G.allCars
    .filter((car) => car.status !== "eliminated" && !car.isWreck) // les épaves n'ont aucun affichage UI (retour de Mayrik)
    .map((car) => `<span class="badge">${car.owner} ${car.size} : ${car.damageTokens.length} dégât(s)${car.status === "inoperable" ? " [INOPÉRABLE]" : ""}</span>`)
    .join("");

  const banner = document.getElementById("winnerBanner");
  if (gameOver) {
    banner.style.display = "block";
    banner.textContent = gameOverInfo.winner
      ? `🏁 Partie terminée : victoire de ${gameOverInfo.winner} (${gameOverInfo.reason}).`
      : `Partie terminée sans vainqueur.`;
  } else {
    banner.style.display = "none";
  }

  const logEl = document.getElementById("log");
  logEl.innerHTML = fullLog.slice().reverse().map((e) => e.sep ? `<div class="turn-sep">${e.sep}</div>` : `<div class="line">${e.line}</div>`).join("");
}

// ===================================================================
// DÉMARRAGE
// ===================================================================
newGame();
resetSelection();
render();
