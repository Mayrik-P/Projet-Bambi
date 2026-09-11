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
// (voir images/vehicles/).
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
// Arborescence : images/hazards/ (voir aussi images/vehicles/ — dossier
// "images/" unique à la racine, une catégorie par sous-dossier, choix
// retenu avec Mayrik pour rester cohérent quand d'autres catégories
// s'ajouteront : dashboards, dégâts, extensions... SEULE exception :
// tiles/images/ reste à part, binôme avec tiles/data/ — justifié,
// contrairement aux autres catégories qui ne sont QUE des images).
const HAZARD_BACK_PATH = "../images/hazards/hazard-back.webp";
// Versos "persist" (p.7 : Blank/Dirt/Oil Slick restent en place, face
// visible, pour le reste de la partie — voir HAZARD_TYPES, engine.js).
// Mine et Wreck n'apparaissent JAMAIS ici : le moteur les défausse
// entièrement dès leur résolution (cell.hazard remis à null sans
// jamais renseigner cell.revealedHazard) — Wreck redevient une vraie
// voiture (wreckCar, déjà gérée par carImagePath), Mine disparaît
// purement et simplement, comme au livret.
const HAZARD_REVEALED_IMAGE = {
  blank: "../images/hazards/hazard-road.webp",
  dirt: "../images/hazards/hazard-mud.webp",
  oil_slick: "../images/hazards/hazard-oilslick.webp"
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
// Tous les fonds transparents (images/vehicles/*.webp) sont à la même
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

// Ombre portée des jetons hazard (retour de Mayrik, après plusieurs
// essais de filtres SVG jamais pleinement satisfaisants — voile,
// vide sur les pointes, rendu trop doux...) : plutôt qu'un calcul en
// direct, Mayrik dessine lui-même l'ombre comme une vraie image —
// contrôle artistique total, et bien plus simple/léger côté code :
// une image de plus à afficher, sans le moindre filtre.
// CONVENTION DE CANEVAS (important, retour de Mayrik) : son fichier
// est nécessairement PLUS GRAND que 316×265 pour contenir le
// débordement de l'ombre — mais le jeton lui-même reste au même
// endroit EXACT dans ce fichier (coin haut-gauche à 0,0, comme sur
// hazard-back.webp etc.), le canevas étant simplement agrandi vers la
// DROITE et le BAS (jamais vers le haut/la gauche, jamais en
// recentrant le jeton). Grâce à ça, la position à l'écran ne bouge
// PAS d'un pixel (toujours calée sur le même coin haut-gauche que les
// autres jetons) — seule la taille affichée change, mise à l'échelle
// proportionnellement à la vraie taille du fichier. Mettre à jour
// HAZARD_SHADOW_NATIVE_W/H ci-dessous avec les dimensions réelles du
// fichier une fois dessiné (mesurées en pixels, ex. via un aperçu
// d'image) — tant que ce n'est pas fait, valeurs de départ = même
// taille que les jetons (aucun débordement, à corriger dès que
// Mayrik donne les vraies dimensions).
const HAZARD_SHADOW_NATIVE_W = 326;
const HAZARD_SHADOW_NATIVE_H = 275;
const HAZARD_SHADOW_SCALE = HAZARD_IMG_W / HAZARD_IMG_NATIVE_W; // même facteur d'échelle que les jetons normaux (pixels natifs -> unités SVG)
const HAZARD_SHADOW_W = HAZARD_SHADOW_NATIVE_W * HAZARD_SHADOW_SCALE;
const HAZARD_SHADOW_H = HAZARD_SHADOW_NATIVE_H * HAZARD_SHADOW_SCALE;
const HAZARD_SHADOW_PATH = "../images/hazards/hazard-shadow.webp";

// --- Marqueurs état véhicule (images/markers/) — remplacent l'ancien
// rond noir/chiffre en surimpression (retour de Mayrik) une fois les
// vrais fichiers déposés sur GitHub. Taille eyeballée (pas de repère
// visuel précis à mesurer, contrairement aux tuiles/véhicules/hazards
// qui ont une résolution native calée sur la case) — à ajuster si
// besoin une fois vu par Mayrik dans son navigateur.
const DAMAGE_MARKER_PATH = "../images/markers/marker-damaged.webp";
const INOPERABLE_MARKER_PATH = "../images/markers/marker-inoperable.webp";
const MARKER_ICON_SIZE = IMG_CELL_W * 0.55;
// Consigne pour Mayrik (retour après sa question sur la cohérence
// visuelle) : dessiner la forme de l'ombre en NOIR OPAQUE (alpha
// plein, pas de transparence propre au fichier) — c'est le CODE qui
// applique l'opacité, via CAR_SHADOW_OPACITY, la MÊME constante déjà
// utilisée pour l'ombre des véhicules (jamais une valeur séparée) :
// garantit une intensité rigoureusement identique entre les deux,
// impossible à obtenir en réglant "à l'œil" une transparence dans le
// fichier lui-même. Un futur ajustement global de l'intensité se fait
// alors en un seul endroit (cette constante), sans jamais retoucher
// ni réexporter l'image.
// L'épave (wreck.webp) n'a pas de couleur de propriétaire (p.7 : pion
// neutre). Chemin relatif à partir de tools/ (où vit ce prototype),
// comme tileImagePath() ci-dessus.
function carImagePath(car) {
  if (car.isWreck) return "../images/vehicles/wreck.webp";
  return `../images/vehicles/${car.size}-${PLAYER_CAR_COLOR[car.owner]}.webp`;
}
function chopperImagePath(ch) {
  return `../images/vehicles/chopper-${PLAYER_CAR_COLOR[ch.owner]}.webp`;
}

// ===================================================================
// DASHBOARDS — pose visuelle des dés (chantier en cours, voir
// docs/spec-dashboards.md pour la spec complète validée avec Mayrik).
// PREMIÈRE TRANCHE câblée ici : sélection du dé (S1) + pose sur un
// slot ANY ou COAST d'un véhicule (S2/S3), annulation comprise (le
// dé posé reste cliquable pour revenir au diceboard, exactement
// comme cancelSelection() déjà utilisé par le panneau texte).
// Command/Repair/Airstrike/Tir/passage à END TURN (S4-S8) restent
// sur le panneau texte (renderPanel) pour l'instant — prochaine
// tranche.
//
// AUCUNE logique de jeu ajoutée ici (voir spec-dashboards.md section
// 0) : chaque clic appelle une fonction déjà existante et déjà
// utilisée par renderPanel() (pickDie/pickCar/cancelSelection) — la
// validité de ce qui est cliquable vient uniquement de
// currentTurnContext(), jamais recalculée ici.
// ===================================================================

// Tailles natives mesurées sur les vraies images (images/dashboards/,
// images/dice/) — mêmes conventions que TILE_NATIVE_*/CAR_IMG_NATIVE_*
// plus haut.
const COMMAND_IMG_NATIVE_W = 1293, COMMAND_IMG_NATIVE_H = 1134;
const DICEBOARD_IMG_NATIVE_W = 913, DICEBOARD_IMG_NATIVE_H = 341;
const VEHICLE_DASH_NATIVE = {
  small: { w: 1409, h: 756 },
  medium: { w: 1515, h: 756 },
  large: { w: 1409, h: 756 }
};
// die-move-pip.webp fait exactement 63px = 189/3 : la grille de pips
// 3x3 tombe pile sur les tiers de la face, aucune approximation.
const DIE_IMG_NATIVE = 189;
// damage-front.webp — image générique utilisée pour TOUT jeton dégât
// une fois stocké face cachée sous un dashboard (voir spec section 2 :
// "on ne voit plus quel dommage c'était"), quel que soit son type réel.
const DAMAGE_TOKEN_NATIVE_W = 519, DAMAGE_TOKEN_NATIVE_H = 487;

// Échelle UNIQUE appliquée aux pixels natifs de TOUTES les images de
// cette zone (dashboards ET dés) — retour de Mayrik : tous ces
// visuels ont été dessinés à la même résolution/proportion, et tous
// les emplacements (ANY/COAST/Command/diceboard) sont prévus à la
// taille exacte d'un dé. Donc AUCUN coefficient de taille séparé par
// catégorie n'est nécessaire (contrairement à une 1ère version de ce
// fichier qui forçait tous les dashboards à la même hauteur affichée,
// obligeant à ajuster une taille de dé différente par catégorie pour
// compenser) : un seul facteur d'échelle suffit, exactement comme
// IMG_CELL_W/GRID_CELL_W plus haut pour les tuiles.
const DASH_SCALE = 0.16;
function scaledSize(nativeW, nativeH) { return { w: nativeW * DASH_SCALE, h: nativeH * DASH_SCALE }; }
// Taille affichée d'un dé — LA SEULE taille utilisée pour tout ce qui
// est dé, que ce soit sur le diceboard ou posé sur un slot.
const DIE_DISPLAY_SIZE = DIE_IMG_NATIVE * DASH_SCALE;
const PLAYER_ROW_GAP = 16;

// Position de chaque board, en PIXELS NATIFS (avant mise à l'échelle
// DASH_SCALE), relative au coin haut-gauche du command board — qui
// sert d'ancre fixe à (0,0) : "tout à gauche de l'écran, zéro marge"
// (retour de Mayrik). Calé par Mayrik dans son navigateur via
// tools/calage-dashboards-layout.html (clic + réglage fin) —
// l'emboîtement par chevauchement (encoches imprimées) est donc pris
// en compte, pas juste des bords qui se touchent.
const BOARD_LAYOUT = {
  diceboard: { x: 191, y: 1047 },
  small: { x: 1204, y: 187 },
  medium: { x: 2565, y: 184 },
  large: { x: 4034, y: 186 }
};
// Rectangle affiché (repère SVG local à une ligne, origine 0,0 =
// coin haut-gauche du command board de CETTE ligne) pour l'un des 5
// boards. "command" est toujours l'ancre ; les 4 autres viennent de
// BOARD_LAYOUT.
function boardBox(kind) {
  if (kind === "command") {
    const s = scaledSize(COMMAND_IMG_NATIVE_W, COMMAND_IMG_NATIVE_H);
    return { x: 0, y: 0, w: s.w, h: s.h };
  }
  if (kind === "diceboard") {
    const s = scaledSize(DICEBOARD_IMG_NATIVE_W, DICEBOARD_IMG_NATIVE_H);
    return { x: BOARD_LAYOUT.diceboard.x * DASH_SCALE, y: BOARD_LAYOUT.diceboard.y * DASH_SCALE, w: s.w, h: s.h };
  }
  const native = VEHICLE_DASH_NATIVE[kind];
  const s = scaledSize(native.w, native.h);
  const off = BOARD_LAYOUT[kind];
  return { x: off.x * DASH_SCALE, y: off.y * DASH_SCALE, w: s.w, h: s.h };
}
// Boîte englobante de TOUS les boards d'un même joueur — voir version
// complète (incluant les jetons dégât) juste après VEHICLE_SLOT_FRACTION
// ci-dessous, dont ce calcul a besoin.

function dashboardImagePath(playerName, kind) {
  // kind: "command" | "diceboard" | "small" | "medium" | "large" | "<size>-inoperable"
  if (kind === "diceboard") return "../images/dashboards/diceboard.webp"; // fichier générique, sans couleur
  const color = PLAYER_CAR_COLOR[playerName];
  if (kind === "command") return `../images/dashboards/command-${color}.webp`;
  return `../images/dashboards/dashboard-${color}-${kind}.webp`;
}

// Positions des slots de pose de dé, en FRACTION (0..1) de la largeur/
// hauteur AFFICHÉE du dashboard concerné. Calées par Mayrik dans son
// navigateur via tools/calage-dashboards.html (clic + réglage fin).
const VEHICLE_SLOT_FRACTION = {
  // Une entrée par TAILLE de véhicule (small/medium/large) — jamais
  // partagée entre les 3 : leurs dashboards n'ont pas le même rapport
  // largeur/hauteur (medium ~7% plus large que small/large), donc pas
  // le même agencement imprimé (confirmé par le calage : coast1/coast2
  // diffèrent nettement entre les trois tailles).
  small: {
    any: { x: 0.498, y: 0.452 },
    endTurn: { x: 0.499, y: 0.742 }, // pas encore câblé (S8, prochaine tranche)
    coast1: { x: 0.805, y: 0.513 },
    coast2: { x: 0.694, y: 0.720 }, // arbitraire (aucun repère visuel imprimé, voir spec section 6)
    damage1: { x: 0.284, y: 1.267 }, // sous le dashboard, priorité gauche (voir spec section 2) — calé par Mayrik
    damage2: { x: 0.716, y: 1.267 } // calé par Mayrik
  },
  medium: {
    any: { x: 0.498, y: 0.451 },
    endTurn: { x: 0.498, y: 0.739 },
    coast1: { x: 0.809, y: 0.512 },
    coast2: { x: 0.707, y: 0.720 },
    damage1: { x: 0.299, y: 1.267 },
    damage2: { x: 0.700, y: 1.267 }
  },
  large: {
    any: { x: 0.499, y: 0.451 },
    endTurn: { x: 0.499, y: 0.739 },
    coast1: { x: 0.848, y: 0.511 },
    coast2: { x: 0.735, y: 0.721 },
    damage1: { x: 0.284, y: 1.267 },
    damage2: { x: 0.714, y: 1.267 }
  }
};

// Rectangle affiché (même repère local que boardBox) d'un jeton dégât
// pour une taille de véhicule et un slot ("damage1"/"damage2") donnés
// — même échelle DASH_SCALE que tout le reste (retour de Mayrik :
// aucun coefficient séparé), centré sur la fraction calée.
function damageTokenBox(size, slotKey) {
  const board = boardBox(size);
  const f = VEHICLE_SLOT_FRACTION[size][slotKey];
  const s = scaledSize(DAMAGE_TOKEN_NATIVE_W, DAMAGE_TOKEN_NATIVE_H);
  return { x: board.x + f.x * board.w - s.w / 2, y: board.y + f.y * board.h - s.h / 2, w: s.w, h: s.h };
}
// Boîte englobante de TOUS les boards d'un même joueur, jetons dégât
// compris (repère local ci-dessus) — sert à empiler les lignes des
// différents joueurs sans chevauchement, quelle que soit la géométrie
// exacte une fois calée. Les 2 emplacements dégât de chaque véhicule
// sont TOUJOURS comptés (même si le véhicule n'a aucun dégât en ce
// moment) pour que la hauteur de ligne reste stable pendant la partie
// plutôt que de sauter quand un dégât apparaît/disparaît.
const ROW_BBOX = (() => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (b) => {
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
  };
  ["command", "diceboard", "small", "medium", "large"].forEach((k) => grow(boardBox(k)));
  ["small", "medium", "large"].forEach((size) => {
    grow(damageTokenBox(size, "damage1"));
    grow(damageTokenBox(size, "damage2"));
  });
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
})();
const COMMAND_SLOT_FRACTION = {
  // Pas encore câblés cette tranche (Command reste sur le panneau
  // texte) — géométrie calée par anticipation pour la prochaine.
  nitro: { x: 0.858, y: 0.166 },
  drift: { x: 0.142, y: 0.836 },
  repair: { x: 0.857, y: 0.840 },
  airstrike: { x: 0.142, y: 0.162 }
};
// Orientation imprimée de chaque slot sur l'image réelle (retour de
// Mayrik) : ANY et END TURN sont de vrais carrés droits, mais COAST
// et les 4 commandes sont dessinés tournés à 45° (losanges) — un dé
// posé dessus doit donc être tourné pareil, pas juste centré. Les 4
// emplacements du diceboard sont eux aussi de vrais carrés droits.
const SLOT_ROTATION = {
  any: 0, endTurn: 0, coast1: 45, coast2: 45,
  nitro: 45, drift: 45, repair: 45, airstrike: 45,
  slot0: 0, slot1: 0, slot2: 0, slot3: 0,
  damage1: 0, damage2: 0
};
// 4 emplacements DROITS (retour de Mayrik) — calés par Mayrik dans son
// navigateur via tools/calage-dashboards.html.
const DICEBOARD_SLOT_FRACTION = {
  slot0: { x: 0.142, y: 0.607 },
  slot1: { x: 0.380, y: 0.607 },
  slot2: { x: 0.619, y: 0.607 },
  slot3: { x: 0.857, y: 0.607 }
};

// Coordonnées en cellule d'une grille 3x3 (col,row) — un pip fait
// exactement 1/3 de la face (voir DIE_IMG_NATIVE), donc un placement
// par cellule de grille est pixel-exact, pas une approximation.
function diePipLayout(value) {
  const TL = [0, 0], TR = [2, 0], ML = [0, 1], MR = [2, 1], BL = [0, 2], BR = [2, 2], C = [1, 1];
  const layouts = {
    1: [C], 2: [TL, BR], 3: [TL, C, BR],
    4: [TL, TR, BL, BR], 5: [TL, TR, C, BL, BR],
    6: [TL, TR, ML, MR, BL, BR]
  };
  return layouts[value] || [];
}

// Dessine un dé de mouvement statique (face colorée + pips) — PREMIER
// rendu statique du projet (l'animation de lancer — chute/rebonds/
// cyclage 2D, déjà décidée dans son principe, voir mémoire projet —
// reste un chantier séparé). x,y = coin haut-gauche, size = côté
// affiché. extraAttrs sert à ajouter class="clickable" sans dupliquer
// le markup entre dé du diceboard et dé déjà posé sur un dashboard.
// rotationDeg (optionnel) : tourne le dé (face + pips ensemble, comme
// un vrai dé physique) autour de son propre centre — nécessaire pour
// les slots COAST/Command, imprimés en losange (voir SLOT_ROTATION).
function dieMarkup(value, color, x, y, size, extraAttrs, rotationDeg) {
  const pipCell = size / 3;
  const facePath = `../images/dice/die-move-${color}.webp`;
  const pipPath = `../images/dice/die-move-pip.webp`;
  const pips = diePipLayout(value).map(([col, row]) => {
    const px = x + col * pipCell, py = y + row * pipCell;
    return `<image href="${pipPath}" xlink:href="${pipPath}" x="${px.toFixed(1)}" y="${py.toFixed(1)}" width="${pipCell.toFixed(1)}" height="${pipCell.toFixed(1)}" pointer-events="none"/>`;
  }).join("");
  const cx = x + size / 2, cy = y + size / 2;
  const rot = rotationDeg ? `transform="rotate(${rotationDeg} ${cx.toFixed(1)} ${cy.toFixed(1)})"` : "";
  return `<g ${extraAttrs || ""} ${rot}>
    <image href="${facePath}" xlink:href="${facePath}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${size.toFixed(1)}" height="${size.toFixed(1)}" pointer-events="none"/>
    ${pips}
  </g>`;
}

// Réconcilie l'état visuel des 4 emplacements du diceboard d'un
// joueur avec son pool réel (G.roundState.dicePool[joueur]) pour CE
// round. Ré-initialisé au changement de round (les 4 dés fraîchement
// lancés reprennent l'ordre du tableau, gauche à droite). Dans le
// même round, un slot ne bouge JAMAIS tant que sa valeur reste dans
// le pool — seul un dé réellement assigné (retiré du pool par
// commitAssignAndCommand) vide son emplacement, plutôt que de faire
// glisser visuellement les autres dés vers la gauche à chaque pose.
// Les valeurs en double (ex. deux 4) sont réconciliées par comptage,
// pas par égalité stricte — un slot n'est vidé que si le pool a
// réellement moins d'occurrences de sa valeur qu'avant.
// Pool "visuel" d'un joueur : identique au vrai pool
// (G.roundState.dicePool) tant que rien n'est encore posé, MAIS avec
// les dés déjà posés sur un dashboard (ANY/COAST/Command — sel.dieValue
// une fois sel.car choisi, sel.commandDieValue une fois choisi) retirés
// visuellement, même si le moteur ne les retire réellement du pool
// qu'au commit. Sans ça, un dé posé restait dupliqué : visible à la
// fois sur le diceboard ET sur le dashboard où il vient d'être posé.
function visualDicePool(playerName) {
  const pool = [...(G.roundState.dicePool[playerName] || [])];
  if (playerName === HUMAN) {
    if (sel.car) {
      const i = pool.indexOf(sel.dieValue);
      if (i !== -1) pool.splice(i, 1);
    }
    if (sel.commandDieValue !== undefined && sel.commandDieValue !== null) {
      const i = pool.indexOf(sel.commandDieValue);
      if (i !== -1) pool.splice(i, 1);
    }
  }
  return pool;
}

// Réconcilie les 2 emplacements dégât (gauche/droite) d'UN véhicule
// avec son car.damageTokens réel. Règle : un jeton déjà en place (côté
// gauche ou droit) y reste tant qu'il est toujours dans
// car.damageTokens — retiré uniquement s'il en a réellement disparu
// (Repair). Un jeton NOUVEAU (acquisition) va dans le 1er emplacement
// libre, gauche en priorité — jamais l'inverse. Réconciliation par
// comptage (comme diceboardSlots) pour bien gérer deux jetons de même
// valeur (ex. deux "dent") sans ambiguïté.
function damageSlots(car) {
  const tokens = car.damageTokens || [];
  if (!damageSlotState[car.id]) damageSlotState[car.id] = { left: null, right: null };
  const state = damageSlotState[car.id];

  const remaining = new Map();
  tokens.forEach((v) => remaining.set(v, (remaining.get(v) || 0) + 1));

  ["left", "right"].forEach((side) => {
    const v = state[side];
    if (v === null) return;
    const left = remaining.get(v) || 0;
    if (left <= 0) { state[side] = null; return; } // retiré depuis le dernier rendu (Repair)
    remaining.set(v, left - 1); // toujours présent -> garde sa place
  });

  remaining.forEach((count, value) => {
    for (let i = 0; i < count; i++) {
      if (state.left === null) state.left = value;
      else if (state.right === null) state.right = value;
      // les deux emplacements sont pleins : ne devrait pas arriver
      // (2 jetons = inopérable, jamais 3), ignoré par sécurité.
    }
  });

  return state;
}

// Réconcilie l'état visuel des 4 emplacements du diceboard d'un
// joueur avec son pool VISUEL (voir visualDicePool ci-dessus) pour CE
// round. Ré-initialisé au changement de round (les 4 dés fraîchement
// lancés reprennent l'ordre du tableau, gauche à droite). Dans le
// même round, un slot ne bouge JAMAIS tant que sa valeur reste dans
// le pool — seul un dé réellement assigné (retiré du pool, réellement
// ou visuellement) vide son emplacement, plutôt que de faire glisser
// visuellement les autres dés vers la gauche à chaque pose.
// Les valeurs en double (ex. deux 4) sont réconciliées par comptage,
// pas par égalité stricte — un slot n'est vidé que si le pool a
// réellement moins d'occurrences de sa valeur qu'avant.
function diceboardSlots(playerName) {
  const pool = visualDicePool(playerName);
  const state = diceboardSlotState[playerName];
  const remaining = new Map(); // valeur -> nombre d'occurrences dans le pool actuel
  pool.forEach((v) => remaining.set(v, (remaining.get(v) || 0) + 1));

  if (state && state.round === G.roundState.roundNumber) {
    const reconciled = state.slots.map((v) => {
      if (v === null) return null;
      const left = remaining.get(v) || 0;
      if (left <= 0) return null; // ce dé a été assigné depuis le dernier rendu
      remaining.set(v, left - 1);
      return v;
    });
    let leftover = 0;
    remaining.forEach((n) => { leftover += n; });
    if (leftover === 0) {
      // Cas normal en vraie partie : le pool n'a fait QUE rétrécir
      // depuis le dernier rendu (jamais de dé qui "réapparaît" en
      // cours de round) -> les slots gardent leur position stable.
      state.slots = reconciled;
      return state.slots;
    }
    // Sinon : le pool contient des valeurs qu'aucun slot existant ne
    // peut expliquer — n'arrive jamais en vraie partie (un pool ne
    // fait que rétrécir dans un round), mais peut arriver quand un
    // scénario de test impose un pool directement (convention déjà
    // utilisée par tous les autres test-ui-*.js). On retombe alors sur
    // une réinitialisation propre plutôt que de laisser des dés
    // orphelins invisibles.
  }
  const slots = [null, null, null, null];
  for (let i = 0; i < Math.min(4, pool.length); i++) slots[i] = pool[i];
  diceboardSlotState[playerName] = { round: G.roundState.roundNumber, slots };
  return slots;
}

// Rend le diceboard + command board + 3 dashboards véhicule de chaque
// joueur, joueur actif en haut (retour de Mayrik, voir
// spec-dashboards.md section 2). Construit comme un bloc paramétrique
// par joueur (originY en paramètre implicite via rowIndex) — pour ne
// pas avoir à retoucher cette fonction le jour où on passera à un
// affichage un-joueur-à-la-fois (carousel/slider), décision actée
// avec Mayrik.
function renderDashboards() {
  const svg = document.getElementById("dashboards");
  if (!svg) return; // anciens tests jsdom sans ce conteneur : ne casse rien
  svg.innerHTML = "";

  const cp = getCurrentPlayer(G.roundState);
  const ctx = (cp === HUMAN && !gameOver) ? currentTurnContext() : null;
  const dieStep = !!(ctx && ctx.canPlay && (sel.step || "die") === "die");
  const carStep = !!(ctx && ctx.canPlay && sel.step === "car");
  const clickableCars = carStep ? (ctx.mode === "coast" ? ctx.coastableCars : ctx.activatableCars) : [];
  const clickableCarSet = new Set(clickableCars);

  const commandDieStep = !!(ctx && ctx.canPlay && sel.step === "command-die");
  const commandTypeStep = !!(ctx && ctx.canPlay && sel.step === "command");
  const repairTargetStep = !!(ctx && ctx.canPlay && sel.step === "repair-target");
  // Types de Command éligibles pour le dé déjà choisi (sel.commandDieValue)
  // — EXACTEMENT le même appel que le panneau texte (voir renderPanel,
  // step "command"), jamais une règle recalculée ici.
  const eligibleCommandTypes = commandTypeStep
    ? new Set(getAvailableCommands(
        [sel.commandDieValue],
        G.allCars.filter((c) => c.owner === HUMAN && c.status !== "eliminated" && c.damageTokens.length > 0)
      ).map((c) => c.type))
    : new Set();
  // Véhicules réparables du joueur (Repair) — même filtre que le
  // panneau texte (voir renderPanel, step "repair-target").
  const myRepairable = repairTargetStep
    ? new Set(G.allCars.filter((c) => c.owner === HUMAN && c.status !== "eliminated" && c.damageTokens.length > 0))
    : new Set();

  const order = cp ? [cp, ...PLAYER_NAMES.filter((p) => p !== cp)] : PLAYER_NAMES;

  let maxRight = 0;
  order.forEach((playerName, rowIndex) => {
    // Origine de CETTE ligne, décalée pour que le point le plus en
    // haut/à gauche de la boîte englobante (ROW_BBOX) tombe pile à la
    // bonne place (0 pour la 1ère ligne, empilé ensuite) — général,
    // fonctionne même si un board calé déborde légèrement au-dessus
    // ou à gauche du command board.
    const rowOriginX = -ROW_BBOX.minX;
    const rowOriginY = rowIndex * (ROW_BBOX.h + PLAYER_ROW_GAP) - ROW_BBOX.minY;
    const at = (kind) => { const b = boardBox(kind); return { x: rowOriginX + b.x, y: rowOriginY + b.y, w: b.w, h: b.h }; };
    const atDamage = (size, slotKey) => { const b = damageTokenBox(size, slotKey); return { x: rowOriginX + b.x, y: rowOriginY + b.y, w: b.w, h: b.h }; };

    // --- Command board : ancre de la ligne, dessiné en premier (en
    // dessous des autres à l'emboîtement) ---
    const cmd = at("command");
    const cmdPath = dashboardImagePath(playerName, "command");
    svg.insertAdjacentHTML("beforeend", `<image href="${cmdPath}" xlink:href="${cmdPath}" x="${cmd.x.toFixed(1)}" y="${cmd.y.toFixed(1)}" width="${cmd.w.toFixed(1)}" height="${cmd.h.toFixed(1)}" pointer-events="none"/>`);

    // Slots Command (Nitro/Drift/Repair/Airstrike) : cliquables
    // uniquement à l'étape "command", et seulement ceux compatibles
    // avec le dé déjà choisi (eligibleCommandTypes, calculé plus haut
    // via la même fonction que le panneau texte).
    if (playerName === HUMAN && commandTypeStep) {
      ["nitro", "drift", "repair", "airstrike"].forEach((type) => {
        if (!eligibleCommandTypes.has(type)) return;
        const f = COMMAND_SLOT_FRACTION[type];
        const cx = cmd.x + f.x * cmd.w, cy = cmd.y + f.y * cmd.h;
        const sx = cx - DIE_DISPLAY_SIZE / 2, sy = cy - DIE_DISPLAY_SIZE / 2;
        const rotAttr = SLOT_ROTATION[type] ? ` transform="rotate(${SLOT_ROTATION[type]} ${cx.toFixed(1)} ${cy.toFixed(1)})"` : "";
        svg.insertAdjacentHTML("beforeend", `<rect class="clickable" x="${sx.toFixed(1)}" y="${sy.toFixed(1)}" width="${DIE_DISPLAY_SIZE.toFixed(1)}" height="${DIE_DISPLAY_SIZE.toFixed(1)}" fill="#b0d458" fill-opacity="0.55" stroke="#b0d458" stroke-width="1.5"${rotAttr}/>`);
        svg.lastElementChild.addEventListener("click", () => { pickCommandChoice(type); render(); });
      });
    }

    // Dé de Command déjà posé (couche de présentation, comme pour
    // ANY/COAST — voir spec-dashboards.md section 1). Visible dès que
    // le type est choisi (repair-target/airstrike-placement/
    // airstrike-shoot-arc/commit), reclic dessus = annuler (même
    // cancelSelection() que partout ailleurs, reset complet du tour —
    // comportement déjà existant, pas nouveau).
    if (playerName === HUMAN && ctx && sel.commandType) {
      const f = COMMAND_SLOT_FRACTION[sel.commandType];
      const cx = cmd.x + f.x * cmd.w, cy = cmd.y + f.y * cmd.h;
      const dieX = cx - DIE_DISPLAY_SIZE / 2, dieY = cy - DIE_DISPLAY_SIZE / 2;
      const isCancelable = PRE_COMMIT_STEPS.has(sel.step) && sel.step !== "commit";
      svg.insertAdjacentHTML("beforeend", dieMarkup(sel.commandDieValue, PLAYER_CAR_COLOR[playerName], dieX, dieY, DIE_DISPLAY_SIZE, isCancelable ? 'class="clickable"' : "", SLOT_ROTATION[sel.commandType]));
      if (isCancelable) {
        svg.lastElementChild.addEventListener("click", () => { cancelSelection(); });
      }
    }

    // --- Diceboard : juste en dessous du command board (retour de
    // Mayrik) — vraie image, 4 emplacements droits. Réconcilié avec le
    // pool réel via diceboardSlots() — voir diceboardSlotState plus
    // haut. Dessiné APRÈS le command board (par-dessus à l'emboîtement).
    const dice = at("diceboard");
    const dicePath = dashboardImagePath(playerName, "diceboard");
    svg.insertAdjacentHTML("beforeend", `<image href="${dicePath}" xlink:href="${dicePath}" x="${dice.x.toFixed(1)}" y="${dice.y.toFixed(1)}" width="${dice.w.toFixed(1)}" height="${dice.h.toFixed(1)}" pointer-events="none"/>`);
    diceboardSlots(playerName).forEach((value, i) => {
      if (value === null) return;
      const slotKey = "slot" + i;
      const f = DICEBOARD_SLOT_FRACTION[slotKey];
      const dx = dice.x + f.x * dice.w - DIE_DISPLAY_SIZE / 2, dy = dice.y + f.y * dice.h - DIE_DISPLAY_SIZE / 2;
      const isClickable = playerName === HUMAN && (dieStep || commandDieStep);
      svg.insertAdjacentHTML("beforeend", dieMarkup(value, PLAYER_CAR_COLOR[playerName], dx, dy, DIE_DISPLAY_SIZE, isClickable ? 'class="clickable"' : "", SLOT_ROTATION[slotKey]));
      if (isClickable) {
        const handler = dieStep ? (() => { pickDie(value); render(); }) : (() => { pickCommandDieChoice(value); render(); });
        svg.lastElementChild.addEventListener("click", handler);
      }
    });

    // --- Dashboards véhicules, emboîtés sur le bord droit du command
    // board puis les uns dans les autres, dans l'ordre small -> medium
    // -> large (retour de Mayrik) — chacun dessiné par-dessus le
    // précédent pour l'effet d'encoche. ---
    ["small", "medium", "large"].forEach((size) => {
      const dim = at(size);
      const car = G.allCars.find((c) => c.owner === playerName && c.size === size && c.status !== "eliminated");
      const isInoperable = !!(car && car.status === "inoperable");
      const kind = isInoperable ? `${size}-inoperable` : size;

      if (car) {
        const imgPath = dashboardImagePath(playerName, kind);
        svg.insertAdjacentHTML("beforeend", `<image href="${imgPath}" xlink:href="${imgPath}" x="${dim.x.toFixed(1)}" y="${dim.y.toFixed(1)}" width="${dim.w.toFixed(1)}" height="${dim.h.toFixed(1)}" pointer-events="none"/>`);
      }
      // Véhicule éliminé (car === undefined ici) -> emplacement laissé
      // vide, voir spec-dashboards.md section 2.

      // Jetons dégât stockés sous le dashboard — 2 emplacements STABLES
      // (gauche/droite, voir damageSlots() plus haut) : la priorité
      // gauche ne joue qu'à l'obtention d'un nouveau jeton ; au Repair,
      // le joueur choisit LEQUEL il retire et l'autre garde sa place
      // (retour de Mayrik — prépare l'extension à dégâts à effet
      // persistant, où il faudra cibler un jeton précis). Toujours
      // face cachée (damage-front.webp, générique quel que soit le
      // type réel, voir spec section 2). Halo vert (même couleur que
      // les slots ANY/COAST/Command) quand cliquable, sans quoi rien
      // ne distingue visuellement un jeton réparable d'un jeton juste
      // affiché (autre retour de Mayrik).
      if (car) {
        const damagePath = "../images/damage/damage-front.webp";
        const isRepairable = playerName === HUMAN && repairTargetStep && myRepairable.has(car);
        const drawToken = (box, tokenValue) => {
          if (isRepairable) {
            // Halo réduit d'1/4 par rapport à la 1ère version (retour de
            // Mayrik : trop grand), toujours centré sur le jeton.
            const oldPad = box.w * 0.18;
            const rw = (box.w + oldPad * 2) * 0.75, rh = (box.h + oldPad * 2) * 0.75;
            const rx = box.x + box.w / 2 - rw / 2, ry = box.y + box.h / 2 - rh / 2;
            svg.insertAdjacentHTML("beforeend", `<rect x="${rx.toFixed(1)}" y="${ry.toFixed(1)}" width="${rw.toFixed(1)}" height="${rh.toFixed(1)}" rx="6" fill="#b0d458" fill-opacity="0.55" stroke="#b0d458" stroke-width="2"/>`);
          }
          svg.insertAdjacentHTML("beforeend", `<image href="${damagePath}" xlink:href="${damagePath}" x="${box.x.toFixed(1)}" y="${box.y.toFixed(1)}" width="${box.w.toFixed(1)}" height="${box.h.toFixed(1)}" class="${isRepairable ? "clickable" : ""}" ${isRepairable ? "" : 'pointer-events="none"'}/>`);
          if (isRepairable) svg.lastElementChild.addEventListener("click", () => { pickRepairTarget(car, tokenValue); render(); });
        };
        const slots = damageSlots(car);
        if (slots.left !== null) drawToken(atDamage(size, "damage1"), slots.left);
        if (slots.right !== null) drawToken(atDamage(size, "damage2"), slots.right);
      }

      if (car && !isInoperable && playerName === HUMAN && clickableCarSet.has(car)) {
        const slotKey = ctx.mode === "coast" ? (car.coastCount === 0 ? "coast1" : "coast2") : "any";
        const f = VEHICLE_SLOT_FRACTION[size][slotKey];
        const cx = dim.x + f.x * dim.w, cy = dim.y + f.y * dim.h;
        const sx = cx - DIE_DISPLAY_SIZE / 2, sy = cy - DIE_DISPLAY_SIZE / 2;
        const rotAttr = SLOT_ROTATION[slotKey] ? ` transform="rotate(${SLOT_ROTATION[slotKey]} ${cx.toFixed(1)} ${cy.toFixed(1)})"` : "";
        svg.insertAdjacentHTML("beforeend", `<rect class="clickable" x="${sx.toFixed(1)}" y="${sy.toFixed(1)}" width="${DIE_DISPLAY_SIZE.toFixed(1)}" height="${DIE_DISPLAY_SIZE.toFixed(1)}" fill="#b0d458" fill-opacity="0.55" stroke="#b0d458" stroke-width="1.5"${rotAttr}/>`);
        svg.lastElementChild.addEventListener("click", () => { pickCar(car); render(); });
      }

      // Dé déjà posé sur ce véhicule (couche de présentation propre à
      // l'UI, voir spec-dashboards.md section 1 — le moteur ne connaît
      // pas la position visuelle des dés). Reclic dessus = annuler,
      // exactement comme le bouton "Annuler" déjà utilisé par le
      // panneau texte (cancelSelection() gère déjà son propre render()).
      if (car && ctx && sel.car === car) {
        const slotKey = ctx.mode === "coast" ? "coast1" : "any";
        const f = VEHICLE_SLOT_FRACTION[size][slotKey];
        const dieX = dim.x + f.x * dim.w - DIE_DISPLAY_SIZE / 2, dieY = dim.y + f.y * dim.h - DIE_DISPLAY_SIZE / 2;
        const isCancelable = PRE_COMMIT_STEPS.has(sel.step) && sel.step !== "commit";
        svg.insertAdjacentHTML("beforeend", dieMarkup(sel.dieValue, PLAYER_CAR_COLOR[playerName], dieX, dieY, DIE_DISPLAY_SIZE, isCancelable ? 'class="clickable"' : "", SLOT_ROTATION[slotKey]));
        if (isCancelable) {
          svg.lastElementChild.addEventListener("click", () => { cancelSelection(); });
        }
      }
    });

    maxRight = Math.max(maxRight, rowOriginX + ROW_BBOX.maxX);
  });

  const totalH = order.length * (ROW_BBOX.h + PLAYER_ROW_GAP) + PLAYER_ROW_GAP;
  svg.setAttribute("viewBox", `0 0 ${maxRight} ${totalH}`);
}


// ===================================================================
// ÉTAT DE JEU — initialisation
// ===================================================================
let G = null; // { progressionState, allCars, allChoppers, roundState }
let sel = {}; // sélection/progression en cours de construction pour le tour humain
let fullLog = []; // journal cumulé affiché sous le plateau
// Couche de présentation propre à l'UI (voir spec-dashboards.md
// section 1) : le moteur ne connaît qu'un TABLEAU de dés restants
// (G.roundState.dicePool[joueur]), pas leur emplacement visuel parmi
// les 4 du diceboard — sans ça, retirer un dé du milieu ferait
// "glisser" tous les autres visuellement à chaque clic. Réconciliée à
// chaque rendu par diceboardSlots() ci-dessous, jamais lue par le
// moteur. Forme : { [joueur]: { round, slots: [valeur|null, ...4] } }.
let diceboardSlotState = {};
// Même principe, pour les 2 emplacements dégât (gauche/droite) sous
// chaque dashboard véhicule. Règle (retour de Mayrik) : la priorité
// gauche ne joue qu'à L'OBTENTION d'un jeton (le nouveau va dans le
// 1er emplacement libre, gauche d'abord) — au Repair, le joueur choisit
// LEQUEL des deux il retire, et l'AUTRE garde sa place (ne glisse pas
// vers la gauche). Important pour l'extension à venir (dégâts à effet
// persistant, face visible en permanence) : il faudra pouvoir cibler
// un jeton précis plutôt qu'un autre. Forme : { [car.id]: { left, right } }.
let damageSlotState = {};
let gameOver = false;
let gameOverInfo = null;

// ===================================================================
// SAUVEGARDE LOCALE (localStorage) — retour de Mayrik : éviter de
// perdre une partie de test si le téléphone interrompt l'onglet
// (appel, changement d'appli...). Pratique standard des jeux
// web/PWA : sauvegarde à des points de contrôle sûrs (jamais en plein
// milieu d'un clic) + sur perte de focus de l'onglet (`visibilitychange`,
// plus fiable que `beforeunload` sur mobile, gardé quand même en
// filet de sécurité). Ne sauvegarde QUE les données de partie pures
// (progressionState/allCars/allChoppers/roundState — déjà de purs
// objets JSON, vérifié) — jamais `sel` (état d'interface transitoire,
// contient des références directes vers des objets voiture, pas du
// JSON à part entière) : au chargement, la partie restaurée reprend
// toujours au DÉBUT d'une activation (choix dé+véhicule), jamais en
// plein milieu d'un mouvement en cours. Compromis assumé : si une
// voiture avait déjà commencé à bouger au moment de la coupure, elle
// reste simplement là où elle en était et son tour est considéré
// terminé — plutôt que de tenter de rejouer le clic en cours.
const SAVE_KEY = "trv_bambi_save_v1";
const SAVE_VERSION = 1;

function saveGameState() {
  try {
    if (!G || !G.progressionState) return;
    const payload = {
      v: SAVE_VERSION,
      savedAt: Date.now(),
      progressionState: G.progressionState,
      allCars: G.allCars,
      allChoppers: G.allChoppers,
      roundState: G.roundState
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
  } catch (e) {
    // best-effort uniquement (quota dépassé, navigation privée,
    // localStorage désactivé...) — ne doit jamais interrompre la partie
  }
}

function loadGameState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    if (!payload || payload.v !== SAVE_VERSION || !payload.progressionState || !payload.allCars || !payload.roundState) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

function clearSavedGame() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* best-effort */ }
}

// Restaure une partie sauvegardée dans G, prête à reprendre au début
// d'une nouvelle activation (voir le compromis expliqué plus haut).
function restoreGameState(payload) {
  G = {
    progressionState: payload.progressionState,
    allCars: payload.allCars,
    allChoppers: payload.allChoppers,
    roundState: payload.roundState,
    aiPending: null,
    aiAnimating: false
  };
  sel = {};
  fullLog = [{ sep: "🔄 Partie reprise (sauvegarde locale)" }];
}

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
    clearSavedGame(); // partie terminée : rien à reprendre
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

// tokenValue (optionnel) : jeton précis choisi par le joueur (clic
// direct sur l'un des deux visuels sous le dashboard — voir
// renderDashboards). Absent = comportement générique (vieux panneau
// texte, retire un jeton quelconque) — voir engine.js:repairCar.
function pickRepairTarget(target, tokenValue) {
  sel.command = { type: "repair", dieValue: 6, target, tokenValue };
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
      polyEl.setAttribute("fill", fill);
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
          <image href="${HAZARD_SHADOW_PATH}" xlink:href="${HAZARD_SHADOW_PATH}" x="${hx.toFixed(1)}" y="${hy.toFixed(1)}" width="${HAZARD_SHADOW_W.toFixed(1)}" height="${HAZARD_SHADOW_H.toFixed(1)}" opacity="${CAR_SHADOW_OPACITY}" pointer-events="none"/>
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
          <image href="${HAZARD_SHADOW_PATH}" xlink:href="${HAZARD_SHADOW_PATH}" x="${hx.toFixed(1)}" y="${hy.toFixed(1)}" width="${HAZARD_SHADOW_W.toFixed(1)}" height="${HAZARD_SHADOW_H.toFixed(1)}" opacity="${CAR_SHADOW_OPACITY}" pointer-events="none"/>
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
    polyEl.setAttribute("fill", "transparent");
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
      ${isActive ? `<circle cx="${cx}" cy="${cy}" r="16" fill="none" stroke="#b0d458" stroke-width="2.5" pointer-events="none"/>` : ""}
      ${isInoperableVisual ? `<image href="${INOPERABLE_MARKER_PATH}" xlink:href="${INOPERABLE_MARKER_PATH}" x="${(cx - MARKER_ICON_SIZE / 2).toFixed(1)}" y="${(cy - MARKER_ICON_SIZE / 2).toFixed(1)}" width="${MARKER_ICON_SIZE.toFixed(1)}" height="${MARKER_ICON_SIZE.toFixed(1)}" pointer-events="none"/>` : (car.damageTokens.length > 0 ? `<image href="${DAMAGE_MARKER_PATH}" xlink:href="${DAMAGE_MARKER_PATH}" x="${(cx - MARKER_ICON_SIZE / 2).toFixed(1)}" y="${(cy - MARKER_ICON_SIZE / 2).toFixed(1)}" width="${MARKER_ICON_SIZE.toFixed(1)}" height="${MARKER_ICON_SIZE.toFixed(1)}" pointer-events="none"/>` : "")}
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

  // Surlignage des cases sélectionnables — TOUJOURS par-dessus tout
  // (tuiles, hazards, véhicules), retour de Mayrik après capture
  // d'écran réelle montrant le surlignage caché sous les jetons
  // hazard. Dessiné en tout dernier, purement visuel et non
  // interactif (pointer-events none) : le clic reste géré par le
  // polygone d'origine de la case (transparent, plus haut dans cette
  // fonction) — même zone cliquable qu'avant, juste redessinée
  // par-dessus pour rester visible quel que soit ce qu'il y a dessous.
  // cellPoly() fonctionne aussi bien pour les cases réelles que pour
  // la marge hors grille (sortie par l'avant) : un seul passage
  // couvre les deux cas, plus besoin de logique séparée.
  for (const h of highlights) {
    const poly = cellPoly(h.col, h.row);
    const polyEl = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    polyEl.setAttribute("points", pts2s(poly));
    polyEl.setAttribute("fill", "#b0d458");
    polyEl.setAttribute("fill-opacity", "0.55");
    polyEl.setAttribute("pointer-events", "none");
    svg.appendChild(polyEl);
  }

  // Phase de tir normale (S7, après mouvement) ET arc de tir Airstrike
  // — pas dans highlightedCells() pour les cibles elles-mêmes (cible =
  // une VOITURE, pas juste une case) : marqueurs de cible
  // (target-small/medium/large selon la taille du véhicule visé,
  // retour de Mayrik : le joueur doit voir la taille donc la chance de
  // toucher) directement sur chaque cible éligible, + un marqueur de
  // refus (marker-no.webp) sur la case juste derrière le tireur —
  // TOUJOURS affiché, même pour Airstrike où cliquer une case vide de
  // l'arc équivaut déjà à refuser (retour de Mayrik : si les 3 cases
  // de l'arc sont occupées, il n'y a plus AUCUNE case vide à cliquer,
  // donc le refus doit rester possible explicitement).
  function drawShootMarkers(targets, shooterColRow, onPickTarget, onDecline) {
    targets.forEach((target) => {
      const { cx, cy } = cellCenter(target.col, target.row);
      const markerPath = `../images/markers/target-${target.size}.webp`;
      svg.insertAdjacentHTML("beforeend", `<image href="${markerPath}" xlink:href="${markerPath}" x="${(cx - MARKER_ICON_SIZE / 2).toFixed(1)}" y="${(cy - MARKER_ICON_SIZE / 2).toFixed(1)}" width="${MARKER_ICON_SIZE.toFixed(1)}" height="${MARKER_ICON_SIZE.toFixed(1)}" class="clickable"/>`);
      svg.lastElementChild.addEventListener("click", () => { onPickTarget(target); render(); });
    });
    const rear = getRearArc(shooterColRow).find((a) => a.name === "rear");
    if (rear && isOnBoard(board(), rear.col, rear.row)) {
      const { cx, cy } = cellCenter(rear.col, rear.row);
      const noPath = "../images/markers/marker-no.webp";
      svg.insertAdjacentHTML("beforeend", `<image href="${noPath}" xlink:href="${noPath}" x="${(cx - MARKER_ICON_SIZE / 2).toFixed(1)}" y="${(cy - MARKER_ICON_SIZE / 2).toFixed(1)}" width="${MARKER_ICON_SIZE.toFixed(1)}" height="${MARKER_ICON_SIZE.toFixed(1)}" class="clickable"/>`);
      svg.lastElementChild.addEventListener("click", () => { onDecline(); render(); });
    }
  }

  if (sel.step === "shoot" && sel.car) {
    drawShootMarkers(sel.shootTargets || [], sel.car, (t) => pickShootTarget(t), () => pickShootTarget(null));
  }

  if (sel.step === "airstrike-shoot-arc" && sel.airstrikePlacement) {
    // Même géométrie que highlightedCells() pour "airstrike-shoot-arc"
    // (voir plus haut) — jamais recalculée différemment ici, juste
    // réutilisée pour savoir QUELS véhicules de l'arc marquer. Le
    // refus se place derrière le CHOPPER (le tireur ici), pas derrière
    // la voiture du joueur.
    const chopper = G.allChoppers.find((c) => c.owner === HUMAN);
    const hypotheticalChopper = { ...chopper, ...sel.airstrikePlacement };
    const targets = getShootTargetOptions(hypotheticalChopper, G.allCars);
    drawShootMarkers(
      targets,
      sel.airstrikePlacement,
      (t) => pickAirstrikeShootCell(t.col, t.row),
      () => declineAirstrikeShoot()
    );
  }
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
  saveGameState(); // point de contrôle sûr : voir le commentaire détaillé près de SAVE_KEY

  ensureRoadDieRolled(G.roundState);
  document.getElementById("roundBadge").textContent = `Round ${G.roundState.roundNumber}`;
  const cp = getCurrentPlayer(G.roundState);
  document.getElementById("playerBadge").textContent = cp ? `${cp} joue` : "Partie terminée";
  document.getElementById("roadDieBadge").textContent = `Dé Road ce round : ${G.roundState.roadDie}`;
  document.getElementById("commandUsedBadge").textContent = cp ? `Command déjà utilisée par ${cp} : ${G.roundState.commandUsedThisRound[cp] ? "oui" : "non"}` : "";
  document.getElementById("dicePool").innerHTML = cp ? (G.roundState.dicePool[cp] || []).map((d) => `<span class="die">${d}</span>`).join("") : "";

  renderBoard();
  renderDashboards();
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
const savedGame = loadGameState();
if (savedGame && confirm("Une partie sauvegardée a été trouvée. Reprendre cette partie ?")) {
  restoreGameState(savedGame);
} else {
  if (savedGame) clearSavedGame(); // le joueur a choisi de repartir à zéro
  newGame();
}
resetSelection();
render();

// Filets de sécurité (voir le commentaire détaillé près de SAVE_KEY) :
// `visibilitychange` est plus fiable que `beforeunload` sur mobile
// (déclenché quand l'app passe en arrière-plan, pas seulement à la
// fermeture) — les deux sont gardés, `render()` sauvegarde déjà à
// chaque action mais ces deux événements couvrent le cas où le
// dernier `render()` remonte à un moment antérieur.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") saveGameState();
});
window.addEventListener("beforeunload", () => { saveGameState(); });
