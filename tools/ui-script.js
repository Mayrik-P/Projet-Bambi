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

// Identité par couleur (retour de Mayrik) : chaque joueur, humain ou
// IA, est identifié directement par sa couleur de véhicule — c'est
// cette couleur qui sert de clé partout dans le moteur (playerName),
// jamais un nom générique "Vous"/"IA". L'affichage textuel (les
// quelques endroits où un nom apparaît en clair) passe par
// playerLabel() ci-dessous, qui construit "Humain Bleu"/"IA Verte" à
// la volée — jamais stocké comme identifiant.
//
// OPPONENT reste "orange" (1ère IA) pour ne rien casser de l'existant
// (tests, code déjà écrit autour d'un scénario 1 IA) — le joueur
// humain est TOUJOURS bleu, les IA supplémentaires prennent
// vert/violet dans l'ordre d'ajout. AI_COUNT (1 à 3) est fixé par
// l'écran d'accueil (voir showStartScreen()/configurePlayers() plus
// bas) avant tout appel à newGame(). Couleurs disponibles :
// blue/green/orange/purple/white (voir images/vehicles/) — white
// reste en réserve si Mayrik veut un jour un 5e joueur.
const HUMAN = "blue";
const OPPONENT = "orange";
const AI_COLORS = ["orange", "green", "purple"];
let AI_COUNT = 1;
let PLAYER_NAMES = [HUMAN, ...AI_COLORS.slice(0, AI_COUNT)];
// Devient une identité pure (chaque joueur EST sa couleur) — gardée
// comme vraie table plutôt que remplacée par playerName partout, pour
// ne toucher aucun des nombreux appels existants qui font déjà
// PLAYER_CAR_COLOR[playerName]. Reconstruite par configurePlayers().
let PLAYER_CAR_COLOR = Object.fromEntries(PLAYER_NAMES.map((p) => [p, p]));

// Nom d'affichage lisible pour les quelques endroits où un nom de
// joueur apparaît en texte (jamais utilisé comme clé/identifiant).
const COLOR_LABEL_FR = { blue: "Bleu", orange: "Orange", green: "Verte", purple: "Violette", white: "Blanche" };
function playerLabel(playerName) {
  const role = playerName === HUMAN ? "Humain" : "IA";
  return `${role} ${COLOR_LABEL_FR[playerName] || playerName}`;
}

// Reconfigure PLAYER_NAMES/PLAYER_CAR_COLOR pour un nombre d'IA donné
// (1 à 3, borné à AI_COLORS.length) — appelé par l'écran d'accueil
// avant newGame(). Un appel newGame() est TOUJOURS nécessaire après
// pour que la partie démarre avec le bon nombre de joueurs (chopper +
// 3 véhicules par joueur, voir newGame()).
function configurePlayers(aiCount) {
  AI_COUNT = Math.max(1, Math.min(AI_COLORS.length, aiCount));
  PLAYER_NAMES = [HUMAN, ...AI_COLORS.slice(0, AI_COUNT)];
  PLAYER_CAR_COLOR = Object.fromEntries(PLAYER_NAMES.map((p) => [p, p]));
}

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
// Petit utilitaire (revue de code : factorise 12 occurrences
// identiques de cette balise <image> SVG à travers le fichier) —
// jamais un comportement nouveau, juste le même texte généré,
// jusqu'ici recopié à chaque appel. href/xlink:href dupliqués pour la
// compatibilité SVG1 (certains navigateurs/exports n'honorent que
// l'un des deux) — inchangé.
function drawImage(svg, path, x, y, w, h, extraAttrs = 'pointer-events="none"') {
  svg.insertAdjacentHTML("beforeend", `<image href="${path}" xlink:href="${path}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" ${extraAttrs}/>`);
}
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
// Marge transparente à gauche dans les webp de véhicules, en fraction
// de la largeur du fichier (mesurée image par image, médiane par
// taille). Sert à caler un élément sur le véhicule DESSINÉ plutôt que
// sur le bord du fichier.
const CAR_ART_LEFT_MARGIN = { small: 0.212, medium: 0.122, large: 0.095 };

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

// Position du dé Road actif ce round — calée par Mayrik dans l'espace
// libre entre le plateau, le command board et le dashboard SMALL (y
// négatif : au-dessus du sommet réel de l'image small). Toujours
// relative à SMALL spécifiquement (jamais medium/large — les 3
// dashboards n'ont pas le même agencement, voir VEHICLE_SLOT_FRACTION
// ci-dessus), et dessinée UNE FOIS PAR LIGNE JOUEUR (donc toujours
// visible, peu importe lequel des deux occupe cette ligne à l'instant
// donné — retour de Mayrik).
const ROAD_DIE_FRACTION = { x: 0.142, y: -0.126 };

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
// Position d'un dé (taille DIE_DISPLAY_SIZE) centré sur un slot
// fractionnaire d'une boîte donnée (command board, dashboard véhicule...)
// — factorise un calcul répété à l'identique à 6 endroits de
// renderDashboards (retour de Mayrik, revue de code). `cx`/`cy` (le
// centre, avant recentrage) restent utiles à l'appelant pour la
// rotation SVG (`transform="rotate(deg cx cy)"`), donc renvoyés aussi.
// Décalage du dé sur un emplacement IMPRIMÉ (retour de Mayrik) : le dé
// et le carré imprimé font presque exactement la même taille, sans
// aucune marge — le bord clair de l'emplacement dépassait donc en bas
// à droite, et tombait pile du côté où le dé porte son ombrage en
// biseau, ce qui cassait l'effet de relief. On pousse le dé vers le
// bas et la droite pour qu'il recouvre ce bord-là ; le bord qui
// réapparaît en haut à gauche est voulu, il joue le biseau lumineux
// (retour de Mayrik).
//
// Exprimé en PIXELS NATIFS de l'image du dé (189 px), comme toutes les
// autres mesures de cette zone : il suit donc automatiquement
// DASH_SCALE et le zoom du rail, sans réglage séparé par niveau de
// zoom. Calé par Mayrik dans son navigateur via
// tools/calage-decalage-des.html.
//
// NE S'APPLIQUE QU'aux emplacements imprimés du diceboard et des
// dashboards véhicule. Le command board en est exclu (son calage
// convient tel quel, retour de Mayrik), et le dé Road aussi — il flotte
// dans un espace libre, sans emplacement imprimé à recouvrir.
const DIE_SLOT_NUDGE = { x: 3.5, y: 3.5 };

// `nudge` (optionnel) : décalage en pixels natifs, voir DIE_SLOT_NUDGE.
// Il déplace AUSSI le centre rendu (cx/cy), sans quoi un dé tourné
// (slots COAST/Command en losange) pivoterait autour d'un point qui
// n'est plus le sien.
function slotDieOrigin(box, fraction, nudge) {
  const nx = (nudge ? nudge.x : 0) * DASH_SCALE;
  const ny = (nudge ? nudge.y : 0) * DASH_SCALE;
  const cx = box.x + fraction.x * box.w + nx, cy = box.y + fraction.y * box.h + ny;
  return { x: cx - DIE_DISPLAY_SIZE / 2, y: cy - DIE_DISPLAY_SIZE / 2, cx, cy };
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
  // BUG RÉEL trouvé par Mayrik (le diceboard ne répondait à aucun
  // clic réel) : un <g> ne dessine jamais rien par lui-même — si TOUTES
  // ses images enfants ont pointer-events="none", il n'existe plus
  // AUCUNE surface cliquable dans toute la zone, malgré le
  // class="clickable" posé sur le <g>. Invisible en test jsdom, qui
  // déclenche l'écouteur directement sans passer par un vrai hit-test
  // respectant pointer-events. Corrigé : on ne désactive les
  // pointer-events des enfants QUE si le dé n'est PAS cliquable
  // (purement décoratif, où ça n'a de toute façon aucun effet).
  const isClickable = (extraAttrs || "").includes("clickable");
  const pe = isClickable ? "" : ' pointer-events="none"';
  const pipCell = size / 3;
  const facePath = `../images/dice/die-move-${color}.webp`;
  const pipPath = `../images/dice/die-move-pip.webp`;
  const pips = diePipLayout(value).map(([col, row]) => {
    const px = x + col * pipCell, py = y + row * pipCell;
    return `<image href="${pipPath}" xlink:href="${pipPath}" x="${px.toFixed(1)}" y="${py.toFixed(1)}" width="${pipCell.toFixed(1)}" height="${pipCell.toFixed(1)}"${pe}/>`;
  }).join("");
  const cx = x + size / 2, cy = y + size / 2;
  const rot = rotationDeg ? `transform="rotate(${rotationDeg} ${cx.toFixed(1)} ${cy.toFixed(1)})"` : "";
  return `<g ${extraAttrs || ""} ${rot}>
    <image href="${facePath}" xlink:href="${facePath}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${size.toFixed(1)}" height="${size.toFixed(1)}"${pe}/>
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
// Le pool affiché est désormais EXACTEMENT le pool du moteur.
//
// Avant, on en retranchait les dés choisis pour simuler leur retrait
// avant le commit — d'où deux comportements différents selon l'ordre de
// sélection (retour de Mayrik), et un bug de dé disparu quand une même
// valeur existait en double. Un dé choisi n'est plus retiré du pool : il
// est simplement DESSINÉ AUTREMENT, en emplacement vide surligné (voir
// pendingDiceSlots et la boucle de dessin du diceboard). L'emplacement
// garde donc sa place, et sert de bouton d'annulation.
function visualDicePool(playerName) {
  return [...(G.roundState.dicePool[playerName] || [])];
}

// Emplacements dont le dé est choisi mais pas encore posé : ils sont
// affichés vides et surlignés, et un clic dessus annule le choix. Les
// valeurs en double sont appariées une par une (deux 4 choisis = deux
// emplacements distincts), jamais par égalité simple.
function pendingDiceSlots(playerName) {
  const pending = new Map(); // index de slot -> "car" | "command"
  if (playerName !== HUMAN || sel.diceCommitted) return pending;
  const slots = diceboardSlots(playerName);
  const prendre = (valeur, role) => {
    if (valeur === undefined || valeur === null) return;
    const i = slots.findIndex((v, idx) => v === valeur && !pending.has(idx));
    if (i !== -1) pending.set(i, role);
  };
  prendre(sel.dieValue, "car");
  prendre(sel.commandDieValue, "command");
  return pending;
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
// Ordre des lignes du bloc dashboards, joueur actif en tête, suivi du
// reste dans l'ordre RÉEL du tour (rotation de playerOrder à partir du
// joueur actif) — retour de Mayrik : HUMAN ne doit jamais rester
// coincé en 2e position pendant tous les tours de chaque IA, mais
// descendre progressivement selon sa vraie place dans la rotation.
// Factorisé (ex-code dupliqué dans renderDashboards et réutilisé par
// l'animation de lancer de dés en début de round, qui a besoin de la
// même origine de ligne par joueur).
function currentDashboardRowOrder() {
  const cp = getCurrentPlayer(G.roundState);
  const po = G.roundState.playerOrder;
  const cpIdx = cp ? po.indexOf(cp) : -1;
  return cpIdx >= 0 ? [...po.slice(cpIdx), ...po.slice(0, cpIdx)] : PLAYER_NAMES;
}

function renderDashboards() {
  const rail = document.getElementById("dashboards-rail");
  if (!rail) return; // anciens tests jsdom sans ce conteneur : ne casse rien

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

  // Retour de Mayrik : l'ordre des lignes doit suivre l'ORDRE RÉEL DU
  // TOUR (rotation de playerOrder à partir du joueur actif), jamais
  // juste "cp en tête, les autres dans leur ordre fixe de table" —
  // sinon HUMAN restait coincé en 2e position pendant TOUS les tours
  // de chaque IA, au lieu de descendre progressivement selon sa vraie
  // place dans la rotation.
  const order = currentDashboardRowOrder();

  // RAIL (étape 5b) : un SVG par joueur au lieu d'un seul grand SVG.
  // Le dessin d'une rangée était déjà entièrement paramétré par son
  // origine, donc chaque rangée se dessine simplement à l'origine 0 de
  // son propre SVG. Ce qu'on y gagne : les rangées deviennent des
  // éléments que la mise en page peut répartir (2 colonnes en paysage
  // et sur ordinateur), que le défilement peut accrocher, et que l'on
  // peut ramener à l'écran individuellement pour le joueur actif.
  while (rail.children.length > order.length) rail.lastElementChild.remove();
  while (rail.children.length < order.length) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    el.setAttribute("class", "dash-row");
    rail.appendChild(el);
  }

  let svg = null;              // SVG de la rangée en cours de dessin
  let maxRight = 0;
  let pendingAiButton = null;
  order.forEach((playerName, rowIndex) => {
    // Origine de CETTE ligne, décalée pour que le point le plus en
    // haut/à gauche de la boîte englobante (ROW_BBOX) tombe pile à la
    // bonne place (0 pour la 1ère ligne, empilé ensuite) — général,
    // fonctionne même si un board calé déborde légèrement au-dessus
    // ou à gauche du command board.
    // Chaque rangée a désormais son propre SVG : son origine ne dépend
    // plus de son rang, elle est toujours en haut de SON SVG.
    svg = rail.children[rowIndex];
    svg.innerHTML = "";
    svg.dataset.dashRow = playerName;
    const rowOriginX = -ROW_BBOX.minX;
    const rowOriginY = -ROW_BBOX.minY;
    const at = (kind) => { const b = boardBox(kind); return { x: rowOriginX + b.x, y: rowOriginY + b.y, w: b.w, h: b.h }; };
    const atDamage = (size, slotKey) => { const b = damageTokenBox(size, slotKey); return { x: rowOriginX + b.x, y: rowOriginY + b.y, w: b.w, h: b.h }; };

    // --- Command board : ancre de la ligne, dessiné en premier (en
    // dessous des autres à l'emboîtement) ---
    const cmd = at("command");
    const cmdPath = dashboardImagePath(playerName, "command");
    drawImage(svg, cmdPath, cmd.x, cmd.y, cmd.w, cmd.h);

    // Bouton "Jouer le tour de l'IA" — retour de Mayrik : plus de
    // question texte séparée dans le panneau. Position calculée ici
    // (au centre du command board de l'IA), mais le DESSIN réel est
    // différé après la boucle complète (voir plus bas) pour être
    // certain qu'il reste au-dessus de tout le reste, quel que soit
    // l'ordre des lignes joueurs. Absent pendant une pause de relance
    // de Slam (marqueurs reroll/no) ou une fois la partie terminée.
    if (playerName !== HUMAN && cp === playerName && !gameOver && !G.aiPending) {
      const btnW = cmd.w * 0.88, btnH = cmd.h * 0.22;
      pendingAiButton = { svg,
        bx: cmd.x + cmd.w / 2 - btnW / 2,
        by: cmd.y + cmd.h / 2 - btnH / 2,
        btnW, btnH
      };
    }

    // Slots Command (Nitro/Drift/Repair/Airstrike) : cliquables
    // uniquement à l'étape "command", et seulement ceux compatibles
    // avec le dé déjà choisi (eligibleCommandTypes, calculé plus haut
    // via la même fonction que le panneau texte).
    if (playerName === HUMAN && commandTypeStep) {
      ["nitro", "drift", "repair", "airstrike"].forEach((type) => {
        if (!eligibleCommandTypes.has(type)) return;
        const { x: sx, y: sy, cx, cy } = slotDieOrigin(cmd, COMMAND_SLOT_FRACTION[type]);
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
    // comportement déjà existant, pas nouveau). Une fois le tour
    // terminé (sel réinitialisé) OU pour l'IA (jamais de sel du tout),
    // on retombe sur commandDieState — même logique persistante que
    // END TURN/Coast, retour de Mayrik : ne restait affiché ni pour le
    // joueur ni pour l'IA jusqu'à la fin du round.
    if (playerName === HUMAN && ctx && sel.commandType) {
      const { x: dieX, y: dieY } = slotDieOrigin(cmd, COMMAND_SLOT_FRACTION[sel.commandType]);
      const isCancelable = PRE_COMMIT_STEPS.has(sel.step) && sel.step !== "commit";
      svg.insertAdjacentHTML("beforeend", dieMarkup(sel.commandDieValue, PLAYER_CAR_COLOR[playerName], dieX, dieY, DIE_DISPLAY_SIZE, isCancelable ? 'class="clickable"' : "", SLOT_ROTATION[sel.commandType]));
      if (isCancelable) {
        svg.lastElementChild.addEventListener("click", () => { cancelSelection(); });
      }
    } else if (playerName !== HUMAN && currentAiDecision && currentAiDecision.car && currentAiDecision.car.owner === playerName && currentAiDecision.command) {
      // Même affichage "vivant" que côté humain (retour de Mayrik) —
      // visible dès que la décision de l'IA est connue, avant même le
      // début du mouvement. Jamais cliquable.
      const { x: dieX, y: dieY } = slotDieOrigin(cmd, COMMAND_SLOT_FRACTION[currentAiDecision.command.type]);
      svg.insertAdjacentHTML("beforeend", dieMarkup(currentAiDecision.command.dieValue, PLAYER_CAR_COLOR[playerName], dieX, dieY, DIE_DISPLAY_SIZE, "", SLOT_ROTATION[currentAiDecision.command.type]));
    } else {
      const cd = commandDieState[playerName];
      if (cd && cd.round === G.roundState.roundNumber) {
        const { x: dieX, y: dieY } = slotDieOrigin(cmd, COMMAND_SLOT_FRACTION[cd.commandType]);
        svg.insertAdjacentHTML("beforeend", dieMarkup(cd.dieValue, PLAYER_CAR_COLOR[playerName], dieX, dieY, DIE_DISPLAY_SIZE, "", SLOT_ROTATION[cd.commandType]));
      }
    }

    // --- Diceboard : juste en dessous du command board (retour de
    // Mayrik) — vraie image, 4 emplacements droits. Réconcilié avec le
    // pool réel via diceboardSlots() — voir diceboardSlotState plus
    // haut. Dessiné APRÈS le command board (par-dessus à l'emboîtement).
    const dice = at("diceboard");
    const dicePath = dashboardImagePath(playerName, "diceboard");
    drawImage(svg, dicePath, dice.x, dice.y, dice.w, dice.h);
    const pendingSlots = pendingDiceSlots(playerName);
    diceboardSlots(playerName).forEach((value, i) => {
      if (value === null) return;
      const slotKey = "slot" + i;
      const { x: dx, y: dy } = slotDieOrigin(dice, DICEBOARD_SLOT_FRACTION[slotKey], DIE_SLOT_NUDGE);
      // Dé choisi, en attente de destination : l'emplacement reste à sa
      // place, vidé et surligné. Un clic dessus annule le choix et rend
      // le dé (retour de Mayrik).
      if (pendingSlots.has(i)) {
        const role = pendingSlots.get(i);
        svg.insertAdjacentHTML("beforeend", `<rect class="clickable" x="${dx.toFixed(1)}" y="${dy.toFixed(1)}" width="${DIE_DISPLAY_SIZE.toFixed(1)}" height="${DIE_DISPLAY_SIZE.toFixed(1)}" rx="4" fill="#b0d458" fill-opacity="0.55" stroke="#b0d458" stroke-width="1.5" stroke-dasharray="3 2" data-diceboard-pending="${playerName}:${i}"/>`);
        svg.lastElementChild.addEventListener("click", () => {
          if (role === "command") {
            // Annule le seul dé de Command : le choix du véhicule reste.
            sel.commandDieValue = null;
            sel.command = null;
            sel.commandType = null;
            sel.step = "command-die";
            render();
          } else {
            cancelSelection(); // le dé du véhicule porte tout le tour
          }
        });
        return;
      }
      const isClickable = playerName === HUMAN && (dieStep || commandDieStep);
      // data-diceboard-die : accroche utilisée UNIQUEMENT par l'animation
      // de lancer en début de round (playRoundDiceRollAnimation) pour
      // retrouver la position écran réelle de CE dé précis (via
      // getBoundingClientRect, qui tient compte du zoom et du défilement
      // automatiquement) — sans attribut, pas de comportement changé.
      const extra = (isClickable ? 'class="clickable" ' : "") + `data-diceboard-die="${playerName}:${i}"`;
      svg.insertAdjacentHTML("beforeend", dieMarkup(value, PLAYER_CAR_COLOR[playerName], dx, dy, DIE_DISPLAY_SIZE, extra, SLOT_ROTATION[slotKey]));
      if (isClickable) {
        const handler = dieStep ? (() => { pickDie(value); render(); }) : (() => { pickCommandDieChoice(value); render(); });
        svg.lastElementChild.addEventListener("click", handler);
        // Halo vert dessiné APRÈS le dé (premier plan) — retour de
        // Mayrik : même style que toutes les autres surbrillances
        // (bordure pleine + remplissage semi-transparent), pas juste
        // un contour. Taille exacte du dé, sans marge.
        svg.insertAdjacentHTML("beforeend", `<rect x="${dx.toFixed(1)}" y="${dy.toFixed(1)}" width="${DIE_DISPLAY_SIZE.toFixed(1)}" height="${DIE_DISPLAY_SIZE.toFixed(1)}" rx="4" fill="#b0d458" fill-opacity="0.55" stroke="#b0d458" stroke-width="1.5" pointer-events="none"/>`);
      }
    });

    // --- Dashboards véhicules, emboîtés sur le bord droit du command
    // board puis les uns dans les autres, dans l'ordre small -> medium
    // -> large (retour de Mayrik) — chacun dessiné par-dessus le
    // précédent pour l'effet d'encoche. ---
    ["small", "medium", "large"].forEach((size) => {
      const dim = at(size);

      // Dé Road actif ce round — retour de Mayrik : remplace l'ancien
      // texte "Dé Road ce round : N", et l'overlay flottant en haut de
      // l'écran (mal placé). Position calibrée par Mayrik dans l'espace
      // libre entre le plateau, le command board et SMALL. Affiché
      // UNIQUEMENT sur la ligne du 1er joueur DE CE ROUND (celui qui a
      // tiré le dé Road, voir roundStartIndex) — pas sur les deux
      // lignes comme avant (retour de Mayrik). Même taille que les
      // autres dés (DIE_DISPLAY_SIZE, pas MARKER_ICON_SIZE — échelles
      // différentes, retour de Mayrik : il paraissait plus petit).
      const roundStartPlayer = G.roundState.playerOrder[G.roundState.roundStartIndex];
      if (size === "small" && G.roundState.roadDie && playerName === roundStartPlayer) {
        const { x: rdX, y: rdY } = slotDieOrigin(dim, ROAD_DIE_FRACTION);
        const rdPath = `../images/dice/die-fx-road-${G.roundState.roadDie}.webp`;
        drawImage(svg, rdPath, rdX, rdY, DIE_DISPLAY_SIZE, DIE_DISPLAY_SIZE);
      }

      const car = G.allCars.find((c) => c.owner === playerName && c.size === size && c.status !== "eliminated");
      const isInoperable = !!(car && car.status === "inoperable");
      const kind = isInoperable ? `${size}-inoperable` : size;

      if (car) {
        const imgPath = dashboardImagePath(playerName, kind);
        drawImage(svg, imgPath, dim.x, dim.y, dim.w, dim.h);
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
          drawImage(svg, damagePath, box.x, box.y, box.w, box.h, isRepairable ? 'class="clickable"' : 'pointer-events="none"');
          if (isRepairable) svg.lastElementChild.addEventListener("click", () => { pickRepairTarget(car, tokenValue); render(); });
        };
        const slots = damageSlots(car);
        if (slots.left !== null) drawToken(atDamage(size, "damage1"), slots.left);
        if (slots.right !== null) drawToken(atDamage(size, "damage2"), slots.right);
      }

      if (car && !isInoperable && playerName === HUMAN && clickableCarSet.has(car)) {
        // Retour de Mayrik (nouvelle logique) : coast1 est TOUJOURS
        // l'emplacement proposé au clic, peu importe coastCount — c'est
        // coast2 qui devient prioritaire pour le STOCKAGE une fois le
        // tour terminé (voir finishHumanTurn), jamais pour la sélection
        // elle-même.
        const slotKey = ctx.mode === "coast" ? "coast1" : "any";
        const { x: sx, y: sy, cx, cy } = slotDieOrigin(dim, VEHICLE_SLOT_FRACTION[size][slotKey], DIE_SLOT_NUDGE);
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
        // sel.mode (pas ctx.mode) : ctx est recalculé à chaque rendu à
        // partir du pool RÉEL, qui a déjà changé une fois le commit
        // automatique passé (retour de Mayrik, plus de confirmation) —
        // sel.mode, lui, reste fidèle à la décision effectivement
        // prise, quel que soit l'état du pool au moment du rendu.
        // Retour de Mayrik (nouvelle logique, remplace le correctif
        // précédent) : le dé Coast reste affiché sur coast1 pendant
        // TOUT le tour en cours, peu importe coastCount — il ne
        // bascule vers coast2 (stockage définitif) qu'une fois le tour
        // terminé, voir finishHumanTurn/coastDieState ci-dessous.
        const slotKey = sel.mode === "coast" ? "coast1" : "any";
        const { x: dieX, y: dieY } = slotDieOrigin(dim, VEHICLE_SLOT_FRACTION[size][slotKey], DIE_SLOT_NUDGE);
        const isCancelable = PRE_COMMIT_STEPS.has(sel.step) && sel.step !== "commit";
        svg.insertAdjacentHTML("beforeend", dieMarkup(sel.dieValue, PLAYER_CAR_COLOR[playerName], dieX, dieY, DIE_DISPLAY_SIZE, isCancelable ? 'class="clickable"' : "", SLOT_ROTATION[slotKey]));
        if (isCancelable) {
          svg.lastElementChild.addEventListener("click", () => { cancelSelection(); });
        }
      } else if (car && playerName !== HUMAN && currentAiDecision && currentAiDecision.car === car) {
        // Même affichage "vivant", côté IA (retour de Mayrik : voir le
        // dé posé avant/pendant le mouvement, pas seulement une fois le
        // tour fini — comme pour un joueur). Jamais cliquable (aucune
        // interaction possible sur la décision de l'IA), sinon même
        // convention coast1 que côté humain.
        const slotKey = currentAiDecision.isCoast ? "coast1" : "any";
        const { x: dieX, y: dieY } = slotDieOrigin(dim, VEHICLE_SLOT_FRACTION[size][slotKey], DIE_SLOT_NUDGE);
        svg.insertAdjacentHTML("beforeend", dieMarkup(currentAiDecision.dieValue, PLAYER_CAR_COLOR[playerName], dieX, dieY, DIE_DISPLAY_SIZE, "", SLOT_ROTATION[slotKey]));
      }

      // Dé "parqué" sur END TURN (voir endTurnDieState plus haut) —
      // indépendant de sel (qui a déjà été réinitialisé une fois le
      // tour de ce véhicule terminé), reste affiché jusqu'à la fin du
      // round. Jamais cliquable/cancelable (retour définitif au-delà
      // du commit).
      if (car) {
        const et = endTurnDieState[car.id];
        if (et && et.round === G.roundState.roundNumber) {
          const { x: etX, y: etY } = slotDieOrigin(dim, VEHICLE_SLOT_FRACTION[size].endTurn, DIE_SLOT_NUDGE);
          svg.insertAdjacentHTML("beforeend", dieMarkup(et.dieValue, PLAYER_CAR_COLOR[playerName], etX, etY, DIE_DISPLAY_SIZE, "", SLOT_ROTATION.endTurn));
        }
      }

      // Dé(s) "parqué(s)" sur COAST (voir coastDieState plus haut) —
      // contrairement à END TURN, reste sur SON propre emplacement
      // (coast1/coast2), jamais transféré. Indépendant de sel, reste
      // affiché jusqu'à la fin du round. Jamais cliquable.
      if (car) {
        const cd = coastDieState[car.id];
        if (cd && cd.round === G.roundState.roundNumber) {
          ["coast1", "coast2"].forEach((slotKey, idx) => {
            const dieValue = cd.slots[idx];
            if (dieValue === null || dieValue === undefined) return;
            const { x: cdX, y: cdY } = slotDieOrigin(dim, VEHICLE_SLOT_FRACTION[size][slotKey], DIE_SLOT_NUDGE);
            svg.insertAdjacentHTML("beforeend", dieMarkup(dieValue, PLAYER_CAR_COLOR[playerName], cdX, cdY, DIE_DISPLAY_SIZE, "", SLOT_ROTATION[slotKey]));
          });
        }
      }
    });

    maxRight = Math.max(maxRight, rowOriginX + ROW_BBOX.maxX);
  });

  // BUG CORRIGÉ (retour de Mayrik : marge indésirable sous le dernier
  // command board) : l'écart (PLAYER_ROW_GAP) ne doit s'appliquer
  // qu'ENTRE deux rangées (N rangées -> N-1 écarts), jamais après la
  // dernière. L'ancienne formule (+ PLAYER_ROW_GAP après la
  // multiplication) ajoutait par erreur un écart plein en trop —
  // vérifié par le calcul : la rangée 0 démarre exactement à Y=0 (voir
  // rowOriginY = rowIndex*(h+gap) - ROW_BBOX.minY, qui annule tout
  // écart de tête), donc la hauteur correcte est purement
  // N*(h+gap) - gap (équivalent à N*h + (N-1)*gap), jamais +gap.
  // Chaque rangée porte le même viewBox : une seule rangée de haut.
  // (L'ancien calcul de hauteur totale N*(h+écart)-écart n'a plus lieu
  // d'être : l'écart entre rangées est maintenant celui de la grille
  // CSS du rail, plus un décalage dessiné dans le SVG.)
  for (const el of rail.children) el.setAttribute("viewBox", `0 0 ${maxRight} ${ROW_BBOX.h}`);

  // Bouton IA dessiné en tout dernier (retour de Mayrik : doit rester
  // au-dessus de tout, quelle que soit la ligne joueur où il se
  // trouve). border-radius répété sur les 4 coins + overflow:hidden
  // (sinon le rendu par défaut du <button> peut déborder du
  // foreignObject et donner l'impression de coins carrés en bas,
  // retour de Mayrik) ; opacity:1 explicite même désactivé (annule
  // button.primary:disabled du CSS, qui grisait le bouton pendant que
  // l'IA joue).
  if (pendingAiButton) {
    const { bx, by, btnW, btnH } = pendingAiButton;
    svg = pendingAiButton.svg; // le bouton appartient à la rangée du joueur concerné
    const label = G.aiAnimating ? "AI is playing…" : "Play the AI's turn ▶";
    svg.insertAdjacentHTML("beforeend", `<foreignObject x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${btnW.toFixed(1)}" height="${btnH.toFixed(1)}" style="overflow:visible;">
      <button xmlns="http://www.w3.org/1999/xhtml" class="primary" style="width:100%;height:100%;font-size:${(btnH * 0.26).toFixed(1)}px;line-height:1.15;white-space:normal;box-sizing:border-box;padding:2px;border-radius:6px;overflow:hidden;opacity:1;" ${G.aiAnimating ? "disabled" : ""}>${label}</button>
    </foreignObject>`);
    if (!G.aiAnimating) {
      svg.lastElementChild.querySelector("button").addEventListener("click", playAiTurn);
    }
  }
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
// Dé "parqué" sur l'emplacement END TURN d'un véhicule une fois son
// tour terminé (retour de Mayrik : n'apparaissait jamais) — reste en
// place jusqu'à la fin du round, voir spec-dashboards.md. Forme :
// { [car.id]: { round, dieValue } }.
let endTurnDieState = {};
// Dés "parqués" sur les emplacements COAST d'un véhicule — retour de
// Mayrik : contrairement à ANY (qui glisse vers END TURN), un dé posé
// en Coast reste affiché SUR SON EMPLACEMENT Coast jusqu'à la fin du
// round, pas de transfert. Forme : { [car.id]: { round, slots: [dé
// coast1 | null, dé coast2 | null] } }.
let coastDieState = {};
// Dé de Command "posé" (nitro/drift/repair/airstrike) — retour de
// Mayrik : ne restait affiché ni pour le joueur (disparaissait après
// resetSelection en fin de tour) ni pour l'IA (jamais affiché du
// tout, câblé uniquement pour sel côté humain). Contrairement à
// endTurnDieState/coastDieState (par VÉHICULE), Command est une
// ressource par JOUEUR — une seule fois par round au total, jamais
// deux fois — donc gardé par nom de joueur ici, pas par car.id.
// Forme : { [playerName]: { round, commandType, dieValue } }.
let commandDieState = {};
// Décision de l'IA EN COURS D'EXÉCUTION (retour de Mayrik : voir le dé
// posé AVANT/PENDANT le mouvement, pas seulement une fois le tour fini
// — comme pour un joueur). Symétrique à sel côté humain, mais pour
// l'IA : posé dès que decideAssignAndCommand() a répondu (avant même
// executeDecisionGen), effacé une fois le tour réellement terminé
// (juste avant que endTurnDieState/coastDieState/commandDieState ne
// prennent le relais pour l'affichage persistant jusqu'à la fin du
// round). Reste posé pendant toute l'animation case par case ET
// pendant une éventuelle pause de relance de Slam (G.aiPending),
// puisque jamais réinitialisé entre-temps.
let currentAiDecision = null;
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
  // Reconstruit PLAYER_NAMES/AI_COUNT/PLAYER_CAR_COLOR à partir de la
  // partie sauvegardée (retour de Mayrik, support multi-IA) — sans ça,
  // reprendre une partie à 3 IA après avoir rouvert l'appli (repartie
  // sur son réglage par défaut, 1 IA) afficherait les mauvaises lignes
  // de dashboard. payload.roundState.playerOrder est la source de
  // vérité, HUMAN toujours en premier (voir configurePlayers).
  PLAYER_NAMES = [...payload.roundState.playerOrder];
  AI_COUNT = PLAYER_NAMES.length - 1;
  PLAYER_CAR_COLOR = Object.fromEntries(PLAYER_NAMES.map((p) => [p, p]));
  G = {
    progressionState: payload.progressionState,
    allCars: payload.allCars,
    allChoppers: payload.allChoppers,
    roundState: payload.roundState,
    aiPending: null,
    aiAnimating: false,
    uiLocked: false // gel de rythme, voir gelerPendantLaScene
  };
  sel = {};
  fullLog = [{ sep: "🔄 Partie reprise (sauvegarde locale)" }];
}

function newGame() {
  const rawTiles = loadRealTiles();
  let setup, attempts = 0;
  do { setup = setupTileProgressionFromRawData(rawTiles, { playerCount: PLAYER_NAMES.length }); attempts++; } while (!setup.ok && attempts < 20);
  const progressionState = createTileProgressionState(setup.rearTile, setup.middleTile, setup.leadTile, setup.drawPile, { playerCount: PLAYER_NAMES.length });
  const allCars = [];
  const allChoppers = [];
  for (const name of PLAYER_NAMES) {
    allChoppers.push(createChopper(name));
    allCars.push(createCarOffBoard(name, CAR_SIZE.SMALL));
    allCars.push(createCarOffBoard(name, CAR_SIZE.MEDIUM));
    allCars.push(createCarOffBoard(name, CAR_SIZE.LARGE));
  }
  const roundState = createRoundState(PLAYER_NAMES);
  G = { progressionState, allCars, allChoppers, roundState, aiPending: null, aiAnimating: false, uiLocked: false };
  vehiculeEntrant = null;
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
  if (!cp || cp === HUMAN) return;
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
  // BUG CORRIGÉ (retour de Mayrik) : executeDecisionGen appelle
  // advanceTurn() EN INTERNE avant de signaler sa fin — si ce tour de
  // l'IA est le DERNIER du round, G.roundState.roundNumber a donc déjà
  // changé au moment où driveAiTurnGenerator enregistre l'état
  // persistant (endTurnDieState/coastDieState/commandDieState), qui se
  // retrouvait alors estampillé sur le MAUVAIS round (celui qui vient
  // de démarrer) et ne s'effaçait donc jamais au bon moment. On capture
  // le round ICI, avant tout appel, et on le transporte avec decision.
  decision.roundAtStart = G.roundState.roundNumber;
  // Retour de Mayrik : le dé doit être visible dès MAINTENANT (avant
  // le mouvement), pas seulement une fois le tour terminé — comme pour
  // un joueur qui pose son dé puis voit sa voiture bouger.
  currentAiDecision = decision;
  // Verrou anti double-clic PENDANT l'animation case par case : les
  // pauses {type:"step"} passent par setTimeout (voir
  // driveAiTurnGenerator, qui pose G.aiAnimating dès son premier
  // appel), donc playAiTurn() rend la main au navigateur entre deux
  // cases — sans ce verrou, un second clic sur "Jouer le tour de
  // l'IA" pendant ce délai lancerait UNE SECONDE décision en parallèle
  // sur le même état de jeu.
  const gen = executeDecisionGen(G.progressionState, G.roundState, G.allCars, G.allChoppers, PLAYER_NAMES, cp, decision, {
    isHumanOwner: (owner) => owner === HUMAN,
    emitEvents: true // pauses visuelles du tour (voir driveAiTurnGenerator) — jamais activé côté self-play/tests
  });
  driveAiTurnGenerator(gen, `Round ${G.roundState.roundNumber} — ${cp}`, decision);
}

// ===================================================================
// RYTHME DES ANIMATIONS (chantier 4a)
//
// Constat de Mayrik en jouant : tout s'enchaîne trop vite et, dès qu'un
// lancer de dés déplace des véhicules, on ne comprend plus ce qui se
// passe — les dés volent encore alors que la voiture a déjà bougé.
//
// Deux manques bien distincts, tous deux traités ici :
//   1. AUCUNE VITESSE RÉGLABLE — une seule constante, appliquée aux
//      seuls pas de l'IA. Elle devient une table de vitesses partagée
//      par tous les temps morts du jeu, prête pour le futur menu
//      Settings (lent / moyen / rapide).
//   2. PERSONNE N'ATTENDAIT LES ANIMATIONS — chaque dé animé rendait
//      pourtant déjà une promesse (voir animateOneMovingDie), mais elle
//      était jetée. Elles sont désormais collectées dans un registre
//      unique, et le jeu attend qu'il soit vide avant de poursuivre.
//      C'est la cause principale du « on ne comprend pas ce qui se
//      passe », et ce point ne coûte aucune ligne de moteur.
//
// CE QUI N'EST PAS FAIT ICI (chantier 4b) : enrichir les événements
// rendus par les générateurs du moteur. Tant qu'il ne rend qu'un seul
// {type:"step"} par case, on ne peut séparer que les pas existants —
// pas le lancer de dés du déplacement qu'il provoque, les deux vivant
// à l'intérieur du MÊME step. AUCUNE ligne du moteur n'est touchée par
// 4a : uniquement les pilotes, ici même.
// ===================================================================

// Vitesses proposées, en ms entre deux étapes (valeurs demandées par
// Mayrik). "medium" = 0,5 s, le réglage par défaut à juger à l'usage.
const PACE_PRESETS = { slow: 900, medium: 500, fast: 200 };
let paceSpeedName = "medium";
let PACE_MS = PACE_PRESETS[paceSpeedName];

// Point d'entrée du futur menu Settings. Renvoie false sur un nom
// inconnu (l'appelant garde alors la vitesse en cours). 0 reste
// possible en écrivant directement PACE_MS — utilisé par les tests
// pour supprimer tout temps mort (voir test-ai-step-pause.js).
function setPaceSpeed(name) {
  if (!Object.prototype.hasOwnProperty.call(PACE_PRESETS, name)) return false;
  paceSpeedName = name;
  PACE_MS = PACE_PRESETS[name];
  return true;
}
function currentPaceSpeed() { return paceSpeedName; }

// Choix de la vitesse SANS console : trois boutons sur l'écran
// d'accueil, à côté du choix du nombre d'IA (demande de Mayrik) — voir
// leur câblage dans le bloc DÉMARRAGE. Le choix vaut pour la partie
// lancée juste après et reste mémorisé d'une session à l'autre, si
// bien que l'écran d'accueil s'ouvre toujours sur la dernière vitesse
// utilisée. Le futur menu Settings n'aura rien à reprendre ici : il
// appellera les deux mêmes fonctions, setPaceSpeed() puis
// memoriserVitesse().
const PACE_STORAGE_KEY = "trv_bambi_pace_v1";

function memoriserVitesse() {
  try { window.localStorage.setItem(PACE_STORAGE_KEY, paceSpeedName); } catch (e) { /* stockage refusé : sans conséquence */ }
}

function initPaceFromStorage() {
  try {
    const memorise = window.localStorage.getItem(PACE_STORAGE_KEY);
    if (memorise) setPaceSpeed(memorise);
  } catch (e) { /* stockage refusé : on garde la vitesse par défaut */ }
}

// --- REGISTRE DES ANIMATIONS EN VOL --------------------------------
// Toute animation qui doit retarder la suite du jeu s'inscrit ici.
// Aujourd'hui une seule source : animateOneMovingDie (dés de round,
// road die, dicetrack). Une animation future — déplacement de
// véhicule, illustration, pose d'un jeton de dégât (chantier 4c) —
// n'aura qu'à s'inscrire de la même façon pour être attendue, sans
// toucher une seule ligne des pilotes.
let animationsEnVol = [];

function suivreAnimation(promesse) {
  animationsEnVol.push(promesse);
  const retirer = () => {
    const i = animationsEnVol.indexOf(promesse);
    if (i >= 0) animationsEnVol.splice(i, 1);
  };
  promesse.then(retirer, retirer);
  return promesse;
}

// Le rythme est PUREMENT VISUEL : hors d'un vrai navigateur (tests
// jsdom, self-play), aucune animation n'est jamais lancée — c'est la
// même garde que dans renderDiceTrack et
// maybeTriggerRoundDiceRollAnimation. Il n'y a donc rien à attendre, et
// tous les chemins restent exactement aussi synchrones qu'avant ce
// chantier : aucun test existant n'est affecté.
function scenePeutAnimer() {
  return typeof window !== "undefined" && typeof window.requestAnimationFrame === "function";
}

// Une salve de dés notifiée par le moteur (setDiceObserver) n'est
// transformée en animations qu'à la microtâche suivante — voir
// diceTrackFlush. Au moment où un pilote demande à attendre, l'animation
// peut donc ne pas exister ENCORE : une salve en attente compte donc
// autant qu'une animation déjà en vol, sinon on la manquerait à tous
// les coups (c'est précisément le cas des dés d'un Slam).
function animationsEnAttente() {
  if (!scenePeutAnimer()) return false;
  return animationsEnVol.length > 0 || diceTrackFlush !== null;
}

// Attend que plus rien ne vole. Renvoie null s'il n'y a rien à
// attendre : c'est ce qui permet aux pilotes de rester STRICTEMENT
// synchrones quand aucune animation n'est en cours (contrat vérifié
// par les tests existants).
function attendreAnimations() {
  if (!animationsEnAttente()) return null;
  return (async () => {
    // Boucle, et non un simple Promise.all : une animation peut en
    // faire naître une autre (salve de dés vidée pendant l'attente).
    // Le garde-fou borne la boucle — un enchaînement d'animations ne
    // doit jamais pouvoir bloquer la partie pour de bon.
    for (let garde = 0; garde < 40 && animationsEnAttente(); garde++) {
      if (diceTrackFlush) { await diceTrackFlush; continue; }
      await Promise.all(animationsEnVol.slice());
    }
  })();
}

// Le battement lui-même : le temps mort volontaire entre deux étapes,
// une fois l'écran stabilisé.
function attendreBattement() {
  return new Promise((r) => setTimeout(r, PACE_MS));
}

// Enchaîne `suite` APRÈS la fin des animations en vol, PUIS le
// battement. Reste strictement synchrone si rien ne vole et que la
// vitesse est à 0.
function apresBattement(suite) {
  const attente = attendreAnimations();
  const battre = () => { if (PACE_MS > 0) setTimeout(suite, PACE_MS); else suite(); };
  if (attente) attente.then(battre); else battre();
}

// --- GEL DE L'INTERFACE PENDANT UNE SCÈNE --------------------------
// Sans lui, rien n'empêche un deuxième clic pendant que les dés volent :
// le joueur enchaînerait un pas de plus avant même d'avoir vu le
// résultat du précédent — exactement ce que ce chantier cherche à
// supprimer. Deux protections complémentaires :
//   - highlightedCells() ne propose plus aucune case (vérifiable en
//     test, c'est le vrai danger : un pas de mouvement en trop) ;
//   - un voile transparent plein écran avale tout le reste (boutons du
//     panneau, marqueurs de tir, dashboards) sans avoir à modifier un
//     par un leurs vingt points d'attache.
function interfaceGelee() { return !!(G && G.uiLocked); }

function appliquerVoileDeGel() {
  if (typeof document === "undefined" || !document.body) return;
  const voile = document.getElementById("input-shield");
  if (!interfaceGelee()) { if (voile) voile.remove(); return; }
  if (voile) return;
  const neuf = document.createElement("div");
  neuf.id = "input-shield";
  Object.assign(neuf.style, {
    position: "fixed", inset: "0", zIndex: "9998", background: "transparent"
  });
  document.body.appendChild(neuf);
}

// Gèle l'interface le temps que la scène en cours se termine (dés en
// vol + battement), puis redessine. Ne fait rien — et ne rend donc pas
// le chemin asynchrone — s'il n'y a rien à attendre. Renvoie vrai si
// l'interface a réellement été gelée.
function gelerPendantLaScene() {
  const attente = attendreAnimations();
  if (!attente) return false;
  G.uiLocked = true;
  appliquerVoileDeGel();
  attente.then(attendreBattement).then(() => {
    G.uiLocked = false;
    render();
  });
  return true;
}

// Empilement de deux véhicules sur la même case. Jusqu'au chantier 4b,
// cet empilement n'était visible que pendant la pause de décision de
// relance d'un Slam — partout ailleurs le Slam se résolvait d'un bloc,
// trop vite pour qu'on voie quoi que ce soit. Ce n'est plus vrai :
// chaque pause de rythme expose désormais ce moment, et l'ordre de
// dessin, qui suivait l'ordre arbitraire de G.allCars, donnait tantôt
// l'un tantôt l'autre par-dessus (bug signalé par Mayrik).
//
// On retient donc le dernier véhicule ARRIVÉ sur une case. C'est très
// exactement la définition du TOP du dé de Slam : le moteur passe la
// voiture entrante comme `topCar` à resolveSlamGen, celle déjà présente
// comme `bottomCar`. Donc le dernier arrivé se dessine par-dessus,
// toujours — y compris lors d'un Slam en chaîne, où la voiture qui
// vient d'être percutée devient à son tour l'entrante sur la case
// suivante.
let vehiculeEntrant = null;

function noterVehiculeEntrant(evt) {
  if (!evt) return;
  if (evt.type === "step" && evt.car) {
    vehiculeEntrant = evt.car;
  } else if ((evt.type === "slam-dice" || evt.type === "slam-reroll") && evt.topCar) {
    // Le moteur le dit lui-même : aucune interprétation de notre côté.
    vehiculeEntrant = evt.topCar;
  }
}

// Fait avancer le générateur du tour IA en cours jusqu'à sa fin OU
// jusqu'à sa prochaine pause. DEUX types de pause bien distincts :
//   - {type:"step", ...} : purement informative, aucune décision à
//     prendre — on affiche juste la nouvelle position, on attend
//     la fin des animations en vol PUIS le battement de rythme
//     (voir apresBattement), puis on reprend automatiquement tout seul
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
function driveAiTurnGenerator(gen, turnLabel, decision, answer) {
  G.aiAnimating = true;
  const outcome = driveInteractive(gen, answer);
  if (!outcome.done) {
    if (isPresentationEvent(outcome.pending)) {
      noterVehiculeEntrant(outcome.pending);
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
      // Chantier 4a : on n'enchaîne plus au bout d'un simple délai, on
      // attend D'ABORD que les dés lancés par ce pas aient fini de
      // tomber — sans quoi le véhicule bougeait déjà pendant qu'ils
      // volaient encore.
      apresBattement(() => driveAiTurnGenerator(gen, turnLabel, decision));
      return;
    }
    G.aiPending = { gen, ctx: outcome.pending, turnLabel, decision };
    render();
    // Les dés du Slam finissent de tomber avant que la question de
    // relance ne devienne cliquable : sinon le joueur répond à un
    // résultat qu'il n'a pas encore vu.
    gelerPendantLaScene();
    return;
  }
  G.aiPending = null;
  G.aiAnimating = false;
  // Tour réellement terminé -> plus de dé "vivant" à afficher, le
  // relais est pris juste en dessous par endTurnDieState/coastDieState/
  // commandDieState (persistants jusqu'à la fin du round).
  currentAiDecision = null;
  // Même bookkeeping que finishHumanTurn (retour de Mayrik : voir la
  // même chose côté IA que côté joueur — sur quoi elle a joué quel
  // dé). decision.car/dieValue/isCoast viennent de decideAssignAndCommand,
  // stables du tout début à la toute fin de ce tour (jamais mutés en
  // cours de route, contrairement à sel côté humain). decision.roundAtStart
  // (pas G.roundState.roundNumber, potentiellement déjà avancé par
  // executeDecisionGen en interne si ce tour finissait le round — voir
  // playAiTurn) : c'est le round PENDANT LEQUEL ce dé a réellement été
  // joué qui doit être estampillé, jamais le suivant.
  const roundPlayed = decision ? decision.roundAtStart : G.roundState.roundNumber;
  if (decision && decision.car && !decision.isCoast && decision.dieValue !== undefined) {
    endTurnDieState[decision.car.id] = { round: roundPlayed, dieValue: decision.dieValue };
  }
  if (decision && decision.car && decision.isCoast && decision.dieValue !== undefined) {
    if (!coastDieState[decision.car.id] || coastDieState[decision.car.id].round !== roundPlayed) {
      coastDieState[decision.car.id] = { round: roundPlayed, slots: [null, null] };
    }
    const slots = coastDieState[decision.car.id].slots;
    const idx = slots[1] === null ? 1 : 0; // coast2 prioritaire s'il est libre, sinon coast1 — même règle que côté humain
    slots[idx] = decision.dieValue;
  }
  // Dé de Command -> persiste jusqu'à la fin du round, même règle que
  // côté humain (retour de Mayrik : ne s'affichait jamais du tout pour
  // l'IA jusqu'ici).
  if (decision && decision.car && decision.command && decision.command.dieValue !== undefined) {
    commandDieState[decision.car.owner] = { round: roundPlayed, commandType: decision.command.type, dieValue: decision.command.dieValue };
  }
  pushLogLines(outcome.result.log || [], turnLabel);
  checkEnd();
  vehiculeEntrant = null; // plus aucun empilement possible hors d'un tour
  resetSelection();
  render();
  // Le tour se termine souvent sur un tir : ses dés volent encore au
  // moment où la main revient au joueur. On la lui rend une fois la
  // scène finie, pas avant.
  gelerPendantLaScene();
}

// Réponse du joueur humain à la pause de relance déclenchée PENDANT
// le tour de l'IA (voir le panneau "ai-slam-reroll-choice" dans
// renderPanel). Reprend le même générateur là où il s'est arrêté.
function resumeAiSlamRerollChoice(wantsReroll) {
  if (!G.aiPending) return;
  const { gen, turnLabel, decision } = G.aiPending;
  driveAiTurnGenerator(gen, turnLabel, decision, wantsReroll);
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
  // Retour de Mayrik : plus de confirmation "Commencer le mouvement" —
  // si aucune Command n'est possible, on committe directement (les
  // cases de destination apparaissent tout de suite).
  if (sel.mode === "assign" && sel.commandAvailable) {
    sel.step = "command-die";
  } else {
    commitAssignAndCommand();
  }
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
    commitAssignAndCommand();
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
    commitAssignAndCommand();
  }
}

// tokenValue (optionnel) : jeton précis choisi par le joueur (clic
// direct sur l'un des deux visuels sous le dashboard — voir
// renderDashboards). Absent = comportement générique (vieux panneau
// texte, retire un jeton quelconque) — voir engine.js:repairCar.
function pickRepairTarget(target, tokenValue) {
  sel.command = { type: "repair", dieValue: 6, target, tokenValue };
  commitAssignAndCommand();
}

// Airstrike (p.8) — nouveau flux en 2 étapes au lieu de 3 (retour de
// Mayrik) : poser le chopper, PUIS viser directement une case de son
// arc avant (case occupée par un adversaire = tir dessus, case vide
// ou "Ne pas tirer" = aucun tir) — plus de liste de cibles séparée
// avant le placement, qui obligeait à un double choix redondant.
function pickAirstrikePlacement(col, row) {
  sel.airstrikePlacement = { col, row };
  const chopper = G.allChoppers.find((c) => c.owner === HUMAN);
  if (G.roundState.roundNumber === 1) {
    // Tir désactivé au round 1 (p.10) — même règle que le tir normal
    // (voir proceedToShootPhase) : le chopper se pose mais ne peut pas
    // encore tirer, retour direct au mouvement (retour de Mayrik).
    sel.command = { type: "airstrike", dieValue: sel.commandDieValue, target: null, placement: { col, row } };
    commitAssignAndCommand();
    return;
  }
  // Chopper HYPOTHÉTIQUE (copie, jamais muté) : juste posé au bon
  // endroit pour calculer son arc avant AVANT le vrai placement, qui
  // n'aura lieu qu'à l'exécution réelle (commitAssignAndCommand).
  const hypotheticalChopper = { ...chopper, col, row };
  const targets = getShootTargetOptions(hypotheticalChopper, G.allCars);
  if (targets.length === 0) {
    // Rien à viser depuis cette case -> aucune raison de demander quoi
    // que ce soit (même logique que le tir normal sans cible).
    sel.command = { type: "airstrike", dieValue: sel.commandDieValue, target: null, placement: { col, row } };
    commitAssignAndCommand();
    return;
  }
  sel.step = "airstrike-shoot-arc";
}

function pickAirstrikeShootCell(col, row) {
  const target = G.allCars.find(
    (c) => c.col === col && c.row === row && c.owner !== HUMAN && c.status !== CAR_STATUS.ELIMINATED && !c.isChopper
  ) || null; // case vide cliquée -> null -> pas de tir
  sel.command = { type: "airstrike", dieValue: sel.commandDieValue, target, placement: sel.airstrikePlacement };
  commitAssignAndCommand();
}

function declineAirstrikeShoot() {
  sel.command = { type: "airstrike", dieValue: sel.commandDieValue, target: null, placement: sel.airstrikePlacement };
  commitAssignAndCommand();
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
  // À partir d'ici le moteur retire lui-même les dés du pool : la
  // compensation visuelle de visualDicePool doit cesser (voir le
  // commentaire là-bas).
  sel.diceCommitted = true;
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
  // (même rythme partagé que le mouvement de l'IA, voir apresBattement :
  // aucun effet sur les règles), pour que le joueur voie distinctement
  // le chopper atterrir avant de voir le résultat du tir.
  if (pendingAirstrikeShoot && !gameOver) {
    apresBattement(() => {
      const shootOutcome = executeAirstrikeShoot(G.progressionState, G.allCars, G.allChoppers, pendingAirstrikeShoot.chopper, pendingAirstrikeShoot.target, G.roundState.roundNumber);
      logTurn(shootOutcome.log);
      checkEnd();
      render();
      gelerPendantLaScene(); // les dés du tir du chopper
    });
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
      stopMovementAndContinue(buildStopMessage([], sel.remaining, "aucune case de la colonne d'entrée n'est accessible (toutes Impassable ou coût de terrain trop élevé)"));
    }
  } else if (sel.step === "move-step") {
    const options = getMovementStepOptions(board(), sel.car, sel.remaining, G.allCars);
    if (options.length === 0) {
      stopMovementAndContinue(buildStopMessage([], sel.remaining, "aucune case de l'arc avant n'est accessible depuis la position actuelle (toutes Impassable ou coût de terrain trop élevé)"));
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

// Remplace l'ancien popup "movement-stopped" + bouton "Continuer"
// (retour de Mayrik : plus utile désormais que le tour s'enchaîne
// visuellement) — le message reste visible dans le journal (logTurn),
// mais le tour continue immédiatement sans clic supplémentaire.
function stopMovementAndContinue(message) {
  logTurn([message]);
  continueAfterStop();
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
    stopMovementAndContinue(buildStopMessage(result.log || [], pointsLost > 0 ? pointsLost : remainingBefore));
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
    stopMovementAndContinue(buildStopMessage([], remainingAfter, "plus aucune case accessible depuis la position actuelle"));
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
// Chantier 4a : c'est ici que le tour humain reçoit enfin le même
// rythme que celui de l'IA. Point de passage UNIQUE des trois
// générateurs humains (entrée, mouvement, tir), donc un seul appel
// suffit à couvrir tous les cas — contrairement aux vingt gestionnaires
// de clic qui, eux, ne sont pas touchés.
function driveHumanStepGenerator(gen, onComplete, answer) {
  const outcome = driveInteractive(gen, answer);
  if (!outcome.done) {
    if (isPresentationEvent(outcome.pending)) {
      noterVehiculeEntrant(outcome.pending);
      // Chantier 4b — LA CONVERGENCE DES DEUX PILOTES. Ce bloc est le
      // jumeau exact de celui de driveAiTurnGenerator : même flux
      // d'événements venu du moteur, même rythme, même traitement. Le
      // tour humain n'est plus piloté par l'interface pendant que celui
      // de l'IA est piloté par le moteur — les deux sont désormais
      // pilotés par le moteur, et la SEULE différence qui reste entre
      // eux est l'origine des décisions (un clic ici, la politique IA
      // là), ce qui est exactement la différence qui doit rester.
      //
      // Conséquence directe, et c'est tout l'objet du chantier : les
      // dés d'un Slam tombent AVANT le déplacement qu'ils provoquent,
      // y compris pendant le tour du joueur.
      G.uiLocked = true; // un pas est en cours de résolution : aucun clic
      appliquerVoileDeGel();
      render();
      apresBattement(() => driveHumanStepGenerator(gen, onComplete));
      return;
    }
    G.uiLocked = false;
    sel.pendingHumanSlam = { gen, ctx: outcome.pending, onComplete };
    sel.step = "slam-reroll-choice";
    render();
    gelerPendantLaScene(); // voir la même attente côté IA : on répond après avoir vu les dés
    return;
  }
  sel.pendingHumanSlam = null;
  G.uiLocked = false;
  onComplete(outcome.result);
  // La case suivante ne redevient cliquable qu'une fois les dés de ce
  // pas posés et le battement écoulé. Sans animation en cours, rien
  // n'est gelé et le clic suivant reste immédiat : c'est le joueur qui
  // donne le tempo tant que le jeu ne fait rien tout seul.
  render();
  gelerPendantLaScene();
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
    isHumanOwner: (owner) => owner === HUMAN,
    // Chantier 4b : le tour humain reçoit EXACTEMENT le même flux
    // d'événements que celui de l'IA (voir driveHumanStepGenerator).
    // Conditionné à scenePeutAnimer() : hors navigateur il n'y a rien à
    // montrer ni à attendre, le moteur n'émet donc rien et le tour
    // humain reste strictement synchrone, comme avant ce chantier.
    emitEvents: scenePeutAnimer()
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
    isHumanOwner: (owner) => owner === HUMAN,
    // Chantier 4b : le tour humain reçoit EXACTEMENT le même flux
    // d'événements que celui de l'IA (voir driveHumanStepGenerator).
    // Conditionné à scenePeutAnimer() : hors navigateur il n'y a rien à
    // montrer ni à attendre, le moteur n'émet donc rien et le tour
    // humain reste strictement synchrone, comme avant ce chantier.
    emitEvents: scenePeutAnimer()
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
  // Le speedometer doit refléter le bonus DÈS son acceptation (retour
  // de Mayrik). Pour le joueur humain, le mouvement est piloté pas à
  // pas par l'interface : accepter le bonus ne passe par aucun appel au
  // moteur, donc aucune notification n'arrivait et le compteur restait
  // à zéro jusqu'au premier déplacement.
  noteMovesRemaining(sel.remaining);
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
    isHumanOwner: (owner) => owner === HUMAN,
    // Chantier 4b : le tour humain reçoit EXACTEMENT le même flux
    // d'événements que celui de l'IA (voir driveHumanStepGenerator).
    // Conditionné à scenePeutAnimer() : hors navigateur il n'y a rien à
    // montrer ni à attendre, le moteur n'émet donc rien et le tour
    // humain reste strictement synchrone, comme avant ce chantier.
    emitEvents: scenePeutAnimer()
  });
  driveHumanStepGenerator(gen, (result) => {
    logTurn(result.log || []);
    finishHumanTurn();
  });
}

function finishHumanTurn() {
  // BUG MOTEUR TROUVÉ (retour de Mayrik) : car.coastCount n'était
  // JAMAIS incrémenté pour un tour Coast joué par un humain — cette
  // logique n'existe que dans playTurnCoast/playTurnCoastWithProgression
  // (utilisées par l'IA), jamais dans le chemin humain
  // (executeAssignAndCommand + executeEndOfTurn). Conséquence concrète :
  // le 2e Coast d'un round proposait toujours le slot coast1 (déjà pris)
  // au lieu de coast2, puisque coastCount restait bloqué à 0. Corrigé
  // ici, au même endroit conceptuel que le "END OF TURN" de
  // playTurnCoast — AVANT la bookkeeping coastDieState ci-dessous, qui
  // dépend de cette valeur déjà incrémentée.
  if (sel.car && sel.mode === "coast") {
    sel.car.coastCount = (sel.car.coastCount || 0) + 1;
  }
  // Dé ANY -> emplacement END TURN (retour de Mayrik) : capturé AVANT
  // resetSelection() (qui vide sel.car/sel.dieValue) — sel.mode==="coast"
  // n'a pas d'emplacement END TURN dédié (spec section 2), seul le cas
  // ANY est concerné ici.
  if (sel.car && sel.mode === "assign" && sel.dieValue !== undefined) {
    endTurnDieState[sel.car.id] = { round: G.roundState.roundNumber, dieValue: sel.dieValue };
  }
  // Dé Coast -> stocké de façon définitive à la fin du tour (jamais
  // pendant le tour lui-même, où il reste affiché sur coast1 — voir
  // plus haut). Retour de Mayrik (nouvelle logique) : coast1 est
  // TOUJOURS l'emplacement de sélection, mais coast2 est PRIORITAIRE
  // pour le stockage définitif — si coast2 est déjà pris (par un
  // Coast précédent ce round), le nouveau dé reste sur coast1.
  if (sel.car && sel.mode === "coast" && sel.dieValue !== undefined) {
    if (!coastDieState[sel.car.id] || coastDieState[sel.car.id].round !== G.roundState.roundNumber) {
      coastDieState[sel.car.id] = { round: G.roundState.roundNumber, slots: [null, null] };
    }
    const slots = coastDieState[sel.car.id].slots;
    const idx = slots[1] === null ? 1 : 0; // coast2 (index 1) prioritaire s'il est libre, sinon coast1
    slots[idx] = sel.dieValue;
  }
  // Dé de Command -> persiste jusqu'à la fin du round (retour de
  // Mayrik) — ressource par JOUEUR (une fois par round au total, voir
  // commandDieState plus haut), donc gardée par HUMAN et non par
  // sel.car.id.
  if (sel.commandType && sel.commandDieValue !== undefined) {
    commandDieState[HUMAN] = { round: G.roundState.roundNumber, commandType: sel.commandType, dieValue: sel.commandDieValue };
  }
  const result = executeEndOfTurn(G.progressionState, G.roundState, G.allCars, G.allChoppers, PLAYER_NAMES, sel.car);
  logTurn(result.log || []);
  if (result.gameOver) {
    gameOver = true;
    gameOverInfo = result;
  }
  vehiculeEntrant = null; // plus aucun empilement possible hors d'un tour
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

// Décision de relance de Slam en attente, quel que soit le mécanisme
// de pause (pendant le tour du joueur, ou pendant celui de l'IA quand
// une voiture du joueur plus grande est impliquée). Factorisé ici
// parce que DEUX endroits en ont besoin : les marqueurs dessinés sur
// le plateau, et la case de destination rendue cliquable comme
// n'importe quelle case de destination de mouvement.
function pendingSlamContext() {
  if (choixSlamMasque) return null; // choix déjà fait, voir repondreChoixSlam
  if (sel.pendingHumanSlam && sel.pendingHumanSlam.ctx) {
    return { ctx: sel.pendingHumanSlam.ctx, resume: resumeHumanSlamRerollChoice };
  }
  if (G.aiPending && G.aiPending.ctx) {
    return { ctx: G.aiPending.ctx, resume: resumeAiSlamRerollChoice };
  }
  return null;
}

// Case vers laquelle le dé Direction envoie le véhicule. Peut sortir du
// plateau (bord haut/bas/arrière) : c'est du pur calcul géométrique,
// l'appelant décide quoi en faire.
function slamDestination(ctx) {
  const delta = getDirectionDelta(ctx.directionRoll, ctx.topCar.col, ctx.topCar.row);
  return { col: ctx.topCar.col + delta.dCol, row: ctx.topCar.row + delta.dRow };
}

// Retour de Mayrik : les marqueurs doivent disparaître AVANT que le
// véhicule ne bouge. Avant ce correctif, la reprise du moteur et
// l'effacement des marqueurs tombaient dans le MÊME rendu, si bien
// qu'on voyait le véhicule se déplacer avec les marqueurs encore
// posés par-dessus. On masque donc le choix, on redessine, et on ne
// reprend la résolution qu'au battement suivant.
let choixSlamMasque = false;

function repondreChoixSlam(resume, relancer) {
  if (!scenePeutAnimer()) {
    // Hors navigateur il n'y a rien à montrer ni à séquencer : on
    // reprend tout de suite, comportement strictement inchangé.
    resume(relancer);
    render();
    return;
  }
  choixSlamMasque = true;
  render(); // les marqueurs s'effacent ici, et ici seulement
  apresBattement(() => {
    choixSlamMasque = false;
    resume(relancer);
    render();
  });
}

// Peinture d'une case surlignée. Factorisée parce qu'elle est posée à
// DEUX profondeurs différentes selon le cas — voir les deux passages
// dans renderBoard.
function peindreSurbrillance(svg, col, row) {
  const polyEl = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  polyEl.setAttribute("points", pts2s(cellPoly(col, row)));
  polyEl.setAttribute("fill", "#b0d458");
  polyEl.setAttribute("fill-opacity", "0.55");
  polyEl.setAttribute("pointer-events", "none"); // le clic reste géré par le polygone de la case
  svg.appendChild(polyEl);
}

function highlightedCells() {
  // Rythme (4a) : aucune case cliquable tant qu'une animation vole —
  // c'est la protection la plus importante, un clic de trop ici joue un
  // vrai pas de mouvement.
  if (interfaceGelee()) return [];
  // Décision de relance de Slam : la case de destination est mise en
  // surbrillance et rendue cliquable comme n'importe quelle case de
  // destination de mouvement (retour de Mayrik) — cliquer dessus
  // accepte le résultat. Placé AVANT le test sur sel.step parce que la
  // pause pendant le tour de l'IA n'a pas d'étape de sélection.
  const slamEnAttente = pendingSlamContext();
  if (slamEnAttente) {
    const dest = slamDestination(slamEnAttente.ctx);
    if (isOnBoard(board(), dest.col, dest.row)) {
      return [{ col: dest.col, row: dest.row, onClick: () => repondreChoixSlam(slamEnAttente.resume, false) }];
    }
    return [];
  }
  if (!sel.step) return [];
  const b = board();
  // Retour de Mayrik : dès qu'un dé est posé sur ANY (étape
  // "command-die", avant même un choix de Command), les cases de
  // destination doivent DÉJÀ être cliquables — pas besoin d'attendre
  // un aller-retour supplémentaire. sel.remaining n'existe pas encore
  // à ce stade (posé seulement au commit, voir commitAssignAndCommand)
  // donc on le calcule ici À L'IDENTIQUE, en pur aperçu — jamais écrit
  // dans sel tant que le joueur n'a pas réellement cliqué une case.
  // Un clic ici committe directement SANS Command (comme "Aucune
  // Command") puis rejoue l'option — même résultat que déjà cliquer
  // sur un dé de Command, en un clic de moins.
  if (sel.step === "command-die" && sel.car) {
    const previewRemaining = sel.mode === "coast" ? 1 : sel.dieValue;
    if (sel.car.col === null) {
      const options = getEntryRowOptions(b, previewRemaining, G.allCars);
      const { onBoard } = splitOnAndOffBoardOptions(b, options);
      return onBoard.map((o) => ({ col: 0, row: o.entryRow, onClick: () => { sel.command = null; commitAssignAndCommand(); pickEntryRow(o); render(); } }));
    }
    const options = getMovementStepOptions(b, sel.car, previewRemaining, G.allCars);
    const { onBoard, offBoard } = splitOnAndOffBoardOptions(b, options);
    const exitsFront = offBoard.filter((o) => o.outcome === "exits-front");
    return [...onBoard, ...exitsFront].map((o) => ({ col: o.col, row: o.row, onClick: () => { sel.command = null; commitAssignAndCommand(); pickMoveStep(o); render(); } }));
  }
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
    // Plus de cases vides cliquables ici (retour de Mayrik) : les
    // marqueurs de cible (taille) + marker-no couvrent déjà tout —
    // voir le bloc dédié dans renderBoard.
    return [];
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

  // Surbrillance de la case de destination d'un Slam : elle passe SOUS
  // les véhicules, contrairement à toutes les autres (retour de
  // Mayrik). La raison tient à une différence de nature : une case de
  // destination de mouvement est forcément VIDE, alors que la case où
  // un Slam envoie un véhicule peut très bien être déjà occupée — et
  // c'est une information décisive pour accepter ou relancer. Peinte
  // par-dessus, la surbrillance masquait justement le véhicule qui s'y
  // trouve. Ordre voulu : plateau < surbrillance < véhicule < dé Slam.
  const slamEnCours = pendingSlamContext();
  const destSousVehicules = slamEnCours ? slamDestination(slamEnCours.ctx) : null;
  if (destSousVehicules) {
    peindreSurbrillance(svg, destSousVehicules.col, destSousVehicules.row);
  }

  // Empilement de deux véhicules sur la même case. Convention demandée
  // par Mayrik, et qui est aussi celle du dé de Slam : la voiture qui
  // vient de percuter (TOP) se dessine PAR-DESSUS celle qui était déjà
  // là (BOTTOM).
  //
  // Deux sources, la plus sûre d'abord : le contexte de la décision de
  // relance en attente, qui nomme explicitement topCar ; sinon le
  // dernier véhicule arrivé sur une case (voir noterVehiculeEntrant),
  // qui couvre toutes les autres pauses de rythme ouvertes par le
  // chantier 4b. Sans empilement, ce réordonnancement ne change
  // évidemment rien.
  const pendingSlamCtx = (G.aiPending && G.aiPending.ctx) || (sel.pendingHumanSlam && sel.pendingHumanSlam.ctx) || null;
  const slamTopCar = (pendingSlamCtx ? pendingSlamCtx.topCar : null) || vehiculeEntrant;
  const carsInDrawOrder = slamTopCar ? G.allCars.slice().sort((a, b) => (a === slamTopCar ? 1 : 0) - (b === slamTopCar ? 1 : 0)) : G.allCars;

  carsInDrawOrder.forEach((car) => {
    if (car.col === null || car.status === "eliminated") return;
    const { cx, cy } = cellCenter(car.col, car.row);
    // Le halo vert marque le véhicule en cours d'action. Il ne
    // s'affichait que pour le joueur humain ; il vaut aussi pendant que
    // l'IA joue (retour de Mayrik), sinon on ne sait pas quel véhicule
    // elle est en train de bouger.
    const isActive = sel.car === car ||
      (typeof currentAiDecision !== "undefined" && currentAiDecision && currentAiDecision.car === car);
    const imgPath = carImagePath(car);
    const x = cx + CAR_IMG_OFFSET_X - CAR_IMG_W / 2, y = cy - CAR_IMG_H / 2;
    // Sommet réel de la case (pas le haut de l'image du véhicule, plus
    // bas) — retour de Mayrik : le marqueur doit coller au bord HAUT
    // de la case, sans quoi il retombe encore sur le graphisme du
    // véhicule.
    // Nouvelle position testée (retour de Mayrik) : 75% de la taille
    // normale, centré verticalement sur le véhicule, calé
    // horizontalement contre son bord GAUCHE (x = bord gauche réel de
    // l'image du véhicule, pas de la case).
    // Retour de Mayrik : bord GAUCHE du marqueur = bord GAUCHE du webp
    // du véhicule (pas centré sur ce bord) ; milieu du marqueur =
    // milieu du webp (x,y = coin haut-gauche du véhicule, déjà calculé
    // plus haut, donc naturellement "attaché" au véhicule plutôt qu'à
    // la case — suivra un futur mouvement animé sans changement ici).
    const damageMarkerSize = MARKER_ICON_SIZE * 0.75;
    // Le marqueur débordait à gauche du véhicule (retour de Mayrik).
    // Cause : les webp des véhicules ont une marge TRANSPARENTE à
    // gauche, différente selon la taille (mesurée sur les 15 images :
    // 21% pour les small, 12% pour les medium, 9,5% pour les large).
    // Aligner sur le bord du fichier revenait donc à aligner sur du
    // vide. On décale de cette marge pour coller au bord du véhicule
    // réellement dessiné.
    const markerX = x + CAR_IMG_W * (CAR_ART_LEFT_MARGIN[car.size] || 0);
    const markerY = cy - damageMarkerSize / 2;
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
      <image href="${imgPath}" xlink:href="${imgPath}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${CAR_IMG_W.toFixed(1)}" height="${CAR_IMG_H.toFixed(1)}" ${rotation} pointer-events="none"/>
      ${isActive ? `<circle cx="${cx}" cy="${cy}" r="16" fill="none" stroke="#b0d458" stroke-width="2.5" pointer-events="none"/>` : ""}
      ${isInoperableVisual ? `<image href="${INOPERABLE_MARKER_PATH}" xlink:href="${INOPERABLE_MARKER_PATH}" x="${markerX.toFixed(1)}" y="${markerY.toFixed(1)}" width="${damageMarkerSize.toFixed(1)}" height="${damageMarkerSize.toFixed(1)}" pointer-events="none"/>` : (car.damageTokens.length > 0 ? `<image href="${DAMAGE_MARKER_PATH}" xlink:href="${DAMAGE_MARKER_PATH}" x="${markerX.toFixed(1)}" y="${markerY.toFixed(1)}" width="${damageMarkerSize.toFixed(1)}" height="${damageMarkerSize.toFixed(1)}" pointer-events="none"/>` : "")}
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
    // Sauf la destination d'un Slam, déjà peinte plus haut SOUS les
    // véhicules : la repeindre ici annulerait tout l'intérêt.
    if (destSousVehicules && h.col === destSousVehicules.col && h.row === destSousVehicules.row) continue;
    peindreSurbrillance(svg, h.col, h.row);
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
      drawImage(svg, markerPath, cx - MARKER_ICON_SIZE / 2, cy - MARKER_ICON_SIZE / 2, MARKER_ICON_SIZE, MARKER_ICON_SIZE, 'class="clickable"');
      svg.lastElementChild.addEventListener("click", () => { onPickTarget(target); render(); });
    });
    const rear = getRearArc(shooterColRow).find((a) => a.name === "rear");
    if (rear && isOnBoard(board(), rear.col, rear.row)) {
      const { cx, cy } = cellCenter(rear.col, rear.row);
      const noPath = "../images/markers/marker-no.webp";
      drawImage(svg, noPath, cx - MARKER_ICON_SIZE / 2, cy - MARKER_ICON_SIZE / 2, MARKER_ICON_SIZE, MARKER_ICON_SIZE, 'class="clickable"');
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
    // Affiche le chopper à sa position choisie (retour de Mayrik :
    // manquait totalement — le vrai placement n'a lieu qu'au commit,
    // donc rien ne le montrait avant). Purement visuel, jamais mutée
    // ici (voir hypotheticalChopper ci-dessus, déjà utilisé pour le
    // calcul des cibles sans muter le vrai chopper).
    const chX = cellCenter(sel.airstrikePlacement.col, sel.airstrikePlacement.row);
    const chImgPath = chopperImagePath(hypotheticalChopper);
    const chx = chX.cx + CAR_IMG_OFFSET_X - CAR_IMG_W / 2, chy = chX.cy - CAR_IMG_H / 2;
    svg.insertAdjacentHTML("beforeend", `<g>
      ${carShadowMarkup(chImgPath, chx, chy, false)}
      <image href="${chImgPath}" xlink:href="${chImgPath}" x="${chx.toFixed(1)}" y="${chy.toFixed(1)}" width="${CAR_IMG_W.toFixed(1)}" height="${CAR_IMG_H.toFixed(1)}" pointer-events="none"/>
    </g>`);
    const targets = getShootTargetOptions(hypotheticalChopper, G.allCars);
    drawShootMarkers(
      targets,
      sel.airstrikePlacement,
      (t) => pickAirstrikeShootCell(t.col, t.row),
      () => declineAirstrikeShoot()
    );
  }

  // Décision de relance de Slam (p.9) : marker-reroll au centre de la
  // case où le Slam a lieu (topCar/bottomCar partagent réellement
  // cette case pendant la pause, voir plus haut), et la face du dé
  // Slam sur la case de DESTINATION désignée par le dé Direction.
  //
  // Il n'y a PLUS de marker-yes derrière le véhicule (retour de
  // Mayrik) : en jouant vite, le réflexe est de cliquer le dé visible
  // sur la case de destination, pas un marqueur posé ailleurs. C'est
  // donc ce dé qui accepte le résultat, et la case sous lui est mise
  // en surbrillance comme n'importe quelle case de destination de
  // mouvement (voir highlightedCells). Ça supprime du même coup la
  // variante de placement qui décalait marker-yes en rear-left quand
  // il tombait sur la même case que le dé.
  //
  // Couvre les deux mécanismes de pause existants (pendant le propre
  // tour du joueur, ou pendant celui de l'IA quand une voiture du
  // joueur plus grande est impliquée) — jamais réécrits ici, juste
  // câblés visuellement.
  const pendingSlam = pendingSlamContext();
  if (pendingSlam) {
    const { ctx, resume } = pendingSlam;
    const { cx, cy } = cellCenter(ctx.topCar.col, ctx.topCar.row);
    const rerollPath = "../images/markers/marker-reroll.webp";
    drawImage(svg, rerollPath, cx - MARKER_ICON_SIZE / 2, cy - MARKER_ICON_SIZE / 2, MARKER_ICON_SIZE, MARKER_ICON_SIZE, 'class="clickable"');
    svg.lastElementChild.addEventListener("click", () => repondreChoixSlam(resume, true));
    // Face du dé Slam SEULE (le dé Direction reste invisible) : montre
    // où le véhicule finira sans afficher le dé qui l'a déterminé.
    // Toujours affichée, MÊME si la destination sort du plateau (bord
    // haut/bas/arrière) : cellCenter est du pur calcul géométrique,
    // extrapolable sans souci hors limites — en haut ça tombe sur la
    // bande titre (aucun souci), en bas sur la zone joueur (accepté
    // tel quel). Dans ce cas hors plateau il n'y a pas de case à
    // mettre en surbrillance, mais le dé reste cliquable : c'est le
    // seul moyen d'accepter le résultat.
    const dest = slamDestination(ctx);
    const dc = cellCenter(dest.col, dest.row);
    const slamPath = `../images/dice/die-fx-slam-${ctx.slamRoll}.webp`;
    drawImage(svg, slamPath, dc.cx - MARKER_ICON_SIZE / 2, dc.cy - MARKER_ICON_SIZE / 2, MARKER_ICON_SIZE, MARKER_ICON_SIZE, 'class="clickable"');
    svg.lastElementChild.addEventListener("click", () => repondreChoixSlam(resume, false));
  }

  // Bonus Road (p.11) : plus de choix textuel Oui/Non — marker-road-N
  // (N = valeur du dé Road de ce round) sur la case juste DEVANT le
  // véhicule (accepter), marker-no derrière (refuser) — même
  // convention que partout ailleurs. Accepter affiche ensuite
  // directement les cases de destination (road-bonus-step, déjà géré
  // par highlightedCells()) — retour de Mayrik.
  if (sel.step === "road-bonus-choice" && sel.car) {
    // Retour de Mayrik : la géométrie brute (getFrontArc) ne gère pas
    // le cas où "devant" est la sortie de tuile (marge réservée
    // col=b.cols, exactement comme le reste du mouvement) — sans ça,
    // aucun marker-road ne s'affichait pour un véhicule déjà sur la
    // dernière colonne, aucun moyen de continuer. On repasse donc par
    // la même machinerie que le mouvement normal pour localiser LA
    // case avant, qu'elle soit sur le plateau ou dans la marge.
    const rbOptions = getMovementStepOptions(board(), sel.car, 1, G.allCars);
    const rbSplit = splitOnAndOffBoardOptions(board(), rbOptions);
    const rbCandidates = [...rbSplit.onBoard, ...rbSplit.offBoard.filter((o) => o.outcome === "exits-front")];
    // BUG CORRIGÉ (retour de Mayrik, cas bloquant) : quand la case
    // PILE devant est du terrain Impassable, getMovementStepOptions ne
    // retourne AUCUNE entrée "front" du tout (contrairement à un
    // véhicule/une Wreck dessus, qui reste une option "normal" —
    // seul l'Impassable est exclu en amont) — marker-road ne
    // s'affichait donc jamais, aucun moyen d'accepter le bonus. Le
    // bonus Road autorise en réalité les 3 directions avant, comme un
    // mouvement normal (voir highlightedCells/road-bonus-step, déjà
    // multi-directionnel) — on replie donc sur front-left/front-right
    // si "front" strict est indisponible, pour que le marker reste
    // toujours accessible dès qu'UNE direction avant existe.
    const front = rbCandidates.find((o) => o.direction === "front") || rbCandidates[0];
    if (front) {
      const fc = cellCenter(front.col, front.row);
      const roadPath = `../images/markers/marker-road-${G.roundState.roadDie}.webp`;
      drawImage(svg, roadPath, fc.cx - MARKER_ICON_SIZE / 2, fc.cy - MARKER_ICON_SIZE / 2, MARKER_ICON_SIZE, MARKER_ICON_SIZE, 'class="clickable"');
      svg.lastElementChild.addEventListener("click", () => { acceptRoadBonus(); render(); });
    }
    const rearRB = getRearArc(sel.car).find((a) => a.name === "rear");
    if (rearRB && isOnBoard(board(), rearRB.col, rearRB.row)) {
      const rc2 = cellCenter(rearRB.col, rearRB.row);
      const noPath2 = "../images/markers/marker-no.webp";
      drawImage(svg, noPath2, rc2.cx - MARKER_ICON_SIZE / 2, rc2.cy - MARKER_ICON_SIZE / 2, MARKER_ICON_SIZE, MARKER_ICON_SIZE, 'class="clickable"');
      svg.lastElementChild.addEventListener("click", () => { declineRoadBonus(); render(); });
    }
  }

  // Bandeau de fin de partie — retour de Mayrik : centré sur le
  // plateau de jeu ASSEMBLÉ (le vrai centre du viewBox, pas un
  // élément externe sous le plateau comme avant), dessiné en tout
  // dernier pour rester au-dessus de tout le reste.
  if (gameOver && gameOverInfo) {
    const color = gameOverInfo.winner ? PLAYER_CAR_COLOR[gameOverInfo.winner] : null;
    const colorLabel = color ? color.charAt(0).toUpperCase() + color.slice(1) : null;
    const text = gameOverInfo.winner
      ? `🏁 Game over: ${colorLabel} wins by ${gameOverInfo.reason}`
      : "🏁 Game over: no winner";
    const bx = BOARD_VIEW.w / 2, by = BOARD_VIEW.h / 2;
    const boxW = Math.min(BOARD_VIEW.w * 0.8, text.length * 9 + 40), boxH = 60;
    svg.insertAdjacentHTML("beforeend", `<g pointer-events="none">
      <rect x="${(bx - boxW / 2).toFixed(1)}" y="${(by - boxH / 2).toFixed(1)}" width="${boxW.toFixed(1)}" height="${boxH.toFixed(1)}" rx="10" fill="#ffb347" stroke="#1e1e24" stroke-width="2"/>
      <text x="${bx.toFixed(1)}" y="${by.toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-size="15" font-weight="bold" fill="#1e1e24">${text}</text>
    </g>`);
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

// ATTENTION (retour de revue de code) : #panel est display:none en CSS
// (template.html) — le joueur ne voit et ne clique JAMAIS rien de ce
// que cette fonction construit ci-dessous. Chaque interaction a son
// propre point d'accroche VISIBLE ailleurs (renderBoard/renderDashboards
// — dés, voitures, cases, jetons, cibles de tir cliqués directement).
// Cette fonction remplit malgré tout DEUX rôles bien réels :
//   1. Effets de bord ESSENTIELS, lus dans tout le reste du fichier
//      (sel.mode, sel.commandAvailable — voir leurs usages ailleurs
//      dans ui-script.js) et le passage automatique du tour humain
//      (passHumanTurnIfImpossible) — À NE JAMAIS RETIRER.
//   2. Construction du contenu de #panel — sans effet visible pour le
//      joueur, mais plusieurs test-ui-*.js lisent ce texte comme
//      vérification indirecte (ex. "le panneau propose bien Repair").
//      Retirer cette partie est possible mais demande de d'abord faire
//      migrer ces tests vers une vérification sur l'élément VISIBLE
//      correspondant (dashboard/plateau) — pas fait ici pour ne pas
//      risquer de perdre leur couverture sans un vrai remplacement.
function renderPanel() {
  const panel = document.getElementById("panel");
  panel.innerHTML = "";

  if (gameOver) return;

  ensureRoadDieRolled(G.roundState);
  const cp = getCurrentPlayer(G.roundState);
  if (!cp) return;

  if (cp !== HUMAN) {
    const h2 = document.createElement("h2");
    h2.textContent = `Au tour de ${playerLabel(cp)}`;
    panel.appendChild(h2);

    if (G.aiPending) {
      // Pause en cours DANS le tour de l'IA (voir driveAiTurnGenerator) :
      // un Slam implique une voiture DU JOUEUR plus grande — c'est à
      // lui de décider la relance (p.9). Texte retiré (retour de
      // Mayrik : même comportement marker-only que pour son propre
      // tour, voir le bloc "pendingSlam" dans renderBoard) — le
      // marker-reroll + la face du dé Slam sur la case de destination
      // couvrent entièrement cette décision.
      return;
    }

    // Bouton "Jouer le tour de l'IA" retiré d'ici (retour de Mayrik) —
    // il vit désormais sur le command board de l'IA (voir
    // renderDashboards), plus près du plateau.
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
    // Ancienne liste de boutons retirée (retour de Mayrik : faisait
    // doublon avec le diceboard, désormais entièrement fonctionnel).
    // Rien à afficher ici — le joueur clique directement un dé sur son
    // diceboard (halo vert).
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
    // Choix texte retiré (retour de Mayrik) — marker-reroll + la face
    // du dé Slam sur la case de destination (voir renderBoard) couvrent
    // entièrement cette étape, même comportement que pendant le tour
    // de l'IA.
  } else if (sel.step === "road-bonus-choice") {
    // Choix texte retiré (retour de Mayrik) — marker-road-N / marker-no
    // sur le plateau couvrent entièrement cette étape (voir renderBoard).
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

// ===================================================================
// ZONE 1 — Plateau de jeu : zoom FIXE (1 tuile = largeur écran) en
// usage normal (téléphone en portrait), défilement horizontal natif
// du conteneur (voir le commentaire CSS détaillé dans template.html).
//
// BUG CORRIGÉ (retour de Mayrik : sur ordinateur ou téléphone en mode
// paysage, le plateau est tronqué en hauteur) — cause identifiée et
// vérifiée dans un vrai Chromium (Playwright) : sur un écran large,
// caler UNIQUEMENT par la largeur (1 tuile = largeur du conteneur)
// peut demander une hauteur (via le ratio fixe du SVG) qui dépasse la
// hauteur verticale réellement disponible. Le conteneur se fait alors
// réduire par le calcul flexbox normal (#board-viewport n'a pas de
// hauteur explicite, seule sa hauteur "intrinsèque", dérivée du
// contenu, sert de base) — mais le SVG À L'INTÉRIEUR, lui, ignore
// cette réduction (sa largeur reste fixée en %, sa hauteur suit tout
// seul), et l'excédent se retrouve purement rogné par
// overflow-y:hidden. Vérifié précisément : sur un écran 1200×700, le
// SVG voulait 756px de haut pour seulement 376px alloués — la moitié
// de l'affichage disparaissait.
// Corrigé en calculant les DEUX hauteurs possibles (celle que
// donnerait le calage par la largeur, et le plafond raisonnable
// disponible) et en basculant sur un calage par la HAUTEUR quand la
// première dépasse la seconde — le plateau assemblé devient alors
// plus étroit que 100% du conteneur (centré), plutôt que de perdre du
// contenu. Rappelé au redimensionnement (résolution/rotation) en plus
// du calcul initial, contrairement à l'ancienne version qui ne
// tournait qu'une seule fois (BOARD_VIEW est une constante, mais
// l'espace disponible à l'écran, lui, change).
// ===================================================================
let boardWidthRatio = null; // ~3 tuiles sur toute la largeur assemblée — propriété fixe du plateau, calculée une seule fois
function setupBoardScroll() {
  if (boardWidthRatio === null) {
    const oneTileWidth = TILE_NATIVE_COLS * IMG_CELL_W;
    boardWidthRatio = BOARD_VIEW.w / oneTileWidth;
  }
  applyBoardSizing();
}
// -------------------------------------------------------------------
// COUCHE D'APPLICATION DE LA MISE EN PAGE
// Seul endroit du jeu qui pose des positions et des tailles. Elle ne
// décide de rien : elle mesure l'espace réellement utilisable, demande
// les rectangles à computeLayout() (layout-engine.js, fonction pure et
// testée), et les recopie sur les éléments.
//
// RÈGLE À NE JAMAIS ENFREINDRE : cette couche dimensionne des
// CONTENEURS. Le SVG des dashboards n'est dimensionné que par son
// propre zoom (voir setDashboardsZoom), jamais par la mise en page.
//
// MODULES DÉCLARÉS PRÉSENTS : tous existent désormais dans le DOM.
// L'illustration est le dernier à rejoindre la mise en page (chantier
// 4c) ; sa place est réservée EN PERMANENCE, même quand elle est vide
// (choix de Mayrik), pour que la mise en page ne se réorganise pas à
// chaque révélation.
// -------------------------------------------------------------------
const LAYOUT_PRESENT = { illu: true, dice: true, roaddie: true, speedo: true, dashMode: "rail" };
let lastLayout = null;

function applyBoardSizing() { applyLayout(); }

function applyLayout() {
  const wrap = document.getElementById("wrap");
  if (!wrap || typeof computeLayout !== "function") return;
  // Hauteur réellement visible : visualViewport tient compte des barres
  // système qui apparaissent/disparaissent, là où une unité CSS seule
  // peut rester en retard d'un instant.
  const vv = window.visualViewport;
  if (vv && vv.height) {
    wrap.style.height = Math.round(vv.height) + "px";
    wrap.style.width = Math.round(vv.width) + "px";
  }
  const W = wrap.clientWidth, H = wrap.clientHeight;
  if (!W || !H) return; // jsdom sans mise en page réelle : rien à faire
  const players = (typeof order !== "undefined" && order && order.length) ? order.length : 4;
  const L = computeLayout(W, H, players, "auto", LAYOUT_PRESENT);
  lastLayout = L;

  const place = (el, r) => {
    if (!el || !r) return;
    el.style.left = r.x + "px"; el.style.top = r.y + "px";
    el.style.width = r.w + "px"; el.style.height = r.h + "px";
    el.style.display = "";
  };

  // --- Plateau : le rectangle rendu inclut le curseur de position ---
  const b = L.zones.board;
  const winH = b.h - L.chrome;            // fenêtre de jeu seule
  place(document.getElementById("board-viewport"), { x: b.x, y: b.y, w: b.w, h: winH });
  const svg = document.getElementById("board");
  const vb = svg && svg.viewBox && svg.viewBox.baseVal;
  if (vb && vb.height) {
    // Calage par la HAUTEUR : c'est ce qui garantit les 6 rangées.
    // La largeur en découle par le rapport d'aspect, et le débordement
    // est absorbé par le défilement horizontal natif.
    svg.style.height = winH.toFixed(1) + "px";
    svg.style.width = (winH * vb.width / vb.height).toFixed(1) + "px";
  }
  const slider = document.getElementById("board-position-slider");
  if (slider) {
    slider.style.left = b.x + "px";
    slider.style.width = b.w + "px";
    slider.style.height = BOARD_SLIDER_H + "px";
    slider.style.top = (L.sliderOverlay ? b.y + winH - BOARD_SLIDER_H : b.y + winH) + "px";
    slider.classList.toggle("over-board", !!L.sliderOverlay);
  }

  // --- Bande d'info et module round ---
  place(document.getElementById("info-band"), L.zones.info);
  const diceEl = document.getElementById("dicetrack-module");
  if (diceEl) {
    if (L.zones.dice) {
      place(diceEl, L.zones.dice);
      diceEl.classList.toggle("over-board", !!L.zones.dice.overlay);
      // Deux dés côte à côte si la boîte est plutôt large, l'un au-dessus
      // de l'autre si elle est plutôt haute.
      diceEl.classList.toggle("vertical", L.zones.dice.h > L.zones.dice.w);
      // L'écart entre les deux dés est celui de la mise en page : la
      // boîte du dicetrack vaut deux carrés PLUS un écart, donc avec le
      // même écart à l'intérieur chaque dé retombe exactement sur le
      // côté d'un carré — la même taille que la face du road die.
      diceEl.style.gap = (L.gap || 6) + "px";
    } else diceEl.style.display = "none";
  }
  const illuEl = document.getElementById("illu-module");
  if (illuEl) {
    if (L.zones.illu) {
      place(illuEl, L.zones.illu);
      illuEl.classList.toggle("over-board", !!L.zones.illu.overlay);
    } else illuEl.style.display = "none";
  }
  const roadEl = document.getElementById("roaddie-module");
  if (roadEl) {
    if (L.zones.roaddie) {
      place(roadEl, L.zones.roaddie);
      roadEl.classList.toggle("over-board", !!L.zones.roaddie.overlay);
    } else roadEl.style.display = "none";
  }
  const speedoEl = document.getElementById("speedometer-module");
  if (speedoEl) {
    if (L.zones.speedo) {
      place(speedoEl, L.zones.speedo);
      speedoEl.classList.toggle("over-board", !!L.zones.speedo.overlay);
      // Les chiffres occupent 60% du cadran : l'afficheur à 7 segments
      // remplit sa boîte bien plus qu'une police, qui laisse toujours du
      // blanc autour des lettres. Au-delà, il mord sur le graphisme de
      // fond (calé à l'œil par Mayrik : 70% puis 65% étaient encore trop).
      const cote = Math.min(L.zones.speedo.w, L.zones.speedo.h);
      const val = document.getElementById("speedometer-value");
      if (val) {
        val.style.height = Math.round(cote * 0.60) + "px";
        val.style.width = Math.round(cote * 0.60) + "px";
      }
    } else speedoEl.style.display = "none";
  }

  // --- Dashboards : on ne pose QUE le conteneur. Le SVG à l'intérieur
  //     est dimensionné par son seul zoom (largeur en %), et le
  //     défilement natif se recale tout seul. ---
  // Le moteur rend un rectangle PAR JOUEUR visible. Le conteneur
  // défilant prend leur boîte englobante ; la grille du rail reproduit
  // leur répartition (1 colonne en portrait, 2 en paysage et sur
  // ordinateur), et les joueurs qui ne tiennent pas sont atteignables
  // par défilement.
  const rows = Object.values(L.zones).filter((z) => z && z.id && /^dash\d+$/.test(z.id));
  const dashRect = rows.length ? {
    x: Math.min(...rows.map((r) => r.x)), y: Math.min(...rows.map((r) => r.y)),
    w: Math.max(...rows.map((r) => r.x + r.w)) - Math.min(...rows.map((r) => r.x)),
    h: Math.max(...rows.map((r) => r.y + r.h)) - Math.min(...rows.map((r) => r.y))
  } : null;
  place(document.getElementById("dashboards-viewport"), dashRect);
  const rail = document.getElementById("dashboards-rail");
  if (rail && dashRect) {
    const top = Math.min(...rows.map((r) => r.y));
    const cols = rows.filter((r) => r.y === top).length;
    rail.style.setProperty("--dash-cols", String(cols));
    rail.style.setProperty("--dash-col-w", rows[0].w + "px");
    rail.style.setProperty("--dash-gap", L.gap + "px");
  }
  // Les boutons de zoom sont sortis du conteneur défilant : dedans, ils
  // auraient défilé avec le contenu. On les pose sur son coin haut-droit.
  const presets = document.getElementById("dashboards-zoom-presets");
  if (presets) {
    // Calés en bas à droite de l'ÉCRAN (retour de Mayrik) : peu
    // utilisés, ils n'ont pas de raison d'occuper la zone centrale, qui
    // est la plus regardée.
    const bw = presets.offsetWidth || 96, bh = presets.offsetHeight || 32;
    presets.style.left = (W - bw - L.gap) + "px";
    presets.style.top = (H - bh - L.gap) + "px";
  }
}

const BOARD_SLIDER_H = 18;

function syncBoardSlider() {
  const viewport = document.getElementById("board-viewport");
  const slider = document.getElementById("board-position-slider");
  const maxScroll = viewport.scrollWidth - viewport.clientWidth;
  slider.value = maxScroll > 0 ? Math.round((viewport.scrollLeft / maxScroll) * 1000) : 0;
}
function onBoardSliderInput() {
  const viewport = document.getElementById("board-viewport");
  const slider = document.getElementById("board-position-slider");
  const maxScroll = viewport.scrollWidth - viewport.clientWidth;
  viewport.scrollLeft = (Number(slider.value) / 1000) * maxScroll;
}

// ===================================================================
// ZONE 2 — Bande d'info : structure posée maintenant (retour de
// Mayrik), contenu minimal pour l'instant (round + joueur actif) en
// remplacement des anciens badges texte retirés — sera étoffée dans
// un chantier séparé.
// ===================================================================
function updateInfoBand(cp) {
  const el = document.getElementById("info-band");
  if (!el) return;
  updateRoadDieModule();
  syncDiceTrackTurn();
  syncSpeedometer();
  focusBoardOnActiveCar();
  el.textContent = gameOver
    ? "PARTIE TERMINÉE"
    : cp ? playerLabel(cp).toUpperCase() : "";
}

// Module ROUND : cadence de rafraîchissement propre (une fois par
// manche), séparée de la bande d'info réécrite à chaque action — c'est
// ce qui permettra plus tard à une animation d'y vivre sans être
// détruite à chaque changement de contexte.
// Sans pastille de couleur du joueur actif (choix de Mayrik), c'est ce
// recentrage qui indique SEUL à qui est le tour quand tous les joueurs
// ne tiennent pas à l'écran. Contrainte dure du profil, pas un confort.
function scrollActivePlayerIntoView() {
  const rail = document.getElementById("dashboards-rail");
  if (!rail || !G || gameOver) return;
  const cp = getCurrentPlayer(G.roundState);
  if (!cp) return;
  const row = rail.querySelector(`[data-dash-row="${cp}"]`);
  if (row && typeof row.scrollIntoView === "function") {
    row.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}

// Module ROAD DIE (retour de Mayrik) : la face active du dé de round,
// affichée en grand et en permanence jusqu'à la fin du round. Le petit
// dé posé sur le dashboard du premier joueur reste en place — il porte
// l'information « qui commence » — mais il est illisible (14 px au zoom
// x1), alors que ce module le montre à 88 px.
// Le dé Road est un VRAI dé à 6 faces, mais avec seulement 3 résultats
// distincts : sa table physique est [1,1,1,2,2,3] (un 1 une fois sur
// deux, un 3 une fois sur six). On pioche dans cette table plutôt que
// dans {1,2,3} à chances égales, pour que le dé qui roule pendant le
// vol se comporte comme le vrai — et pour rester juste automatiquement
// si la composition du dé changeait dans le moteur.
const ROAD_DIE_TABLE = (typeof DICE_FACES !== "undefined" && DICE_FACES.ROAD)
  ? DICE_FACES.ROAD : [1, 1, 1, 2, 2, 3];
function roadDieFaceHTML(value, size) {
  return `<img src="../images/dice/die-fx-road-${value}.webp" style="position:absolute;left:0;top:0;width:${size}px;height:${size}px;">`;
}

function updateRoadDieModule() {
  const face = document.getElementById("roaddie-face");
  if (!face) return;
  const value = (G && G.roundState && G.roundState.roadDie) || null;
  if (value) {
    face.setAttribute("src", `../images/dice/die-fx-road-${value}.webp`);
    face.style.visibility = "";
  } else {
    face.style.visibility = "hidden";
  }
}

// ===================================================================
// MODULE DICETRACK — les dés spéciaux du tour, lisibles en grand.
//
// Ce que Mayrik a demandé : tous les dés spéciaux tirés pendant le
// tour, chaque face restant affichée jusqu'au lancer suivant, avec la
// même animation de vol que le dé de round.
//
// COMMENT ON SAIT QU'UN DÉ EST TIRÉ : le moteur prévient via
// setDiceObserver (crochet de présentation, voir engine.js). On ne lit
// donc jamais les textes de journal, qui auraient été à analyser.
//
// REGROUPEMENT D'UN LANCER : certains lancers produisent deux dés d'un
// coup (un Slam tire slam + direction ; un Blast Off tire direction +
// stunt). Tous les dés notifiés dans la MÊME salve synchrone forment
// donc un seul lancer, et on vide la file à la microtâche suivante.
// Un enchaînement de slams, lui, passe par des reprises successives du
// générateur : ses dés arrivent en salves distinctes, donc remplacent
// bien l'affichage l'un après l'autre.
// Le module ne montre que 2 dés (sa taille minimale a été calculée
// pour ça). Une salve plus longue existe — un jeton Dazed tire un
// stunt puis une direction par case — et on garde alors les deux
// PREMIERS : à confirmer à l'usage avec Mayrik.
// ===================================================================
// DEUX EMPLACEMENTS, PAS UNE FILE DE DEUX DÉS. C'est la conséquence
// d'un cas relevé par Mayrik : le jeton Dazed tire une cascade ET une
// direction, puis RELANCE la seule direction à chaque case parcourue,
// la cascade restant verrouillée sur sa valeur. Le dicetrack avait
// besoin d'une notion qu'il n'avait pas : un dé qui reste.
//   - emplacement GAUCHE : le dé qui qualifie l'action (slam, cascade,
//     tir). Il ouvre une séquence et efface la droite ;
//   - emplacement DROITE : le dé de direction, qui peut être relancé.
// Un lancer ne contenant qu'une direction ne touche donc pas la
// gauche : le verrouillage du Dazed en découle sans qu'aucune ligne ne
// connaisse l'existence du Dazed.
// LIMITE CONNUE, à trancher à l'usage : un éclat de Shrapnel tire une
// direction seule. S'il survient après un slam dans le MÊME tour, la
// gauche montrera encore le dé de slam. Le dicetrack est donc vidé à
// chaque changement de tour pour borner la casse.
const DICE_ART = {
  slam:      { file: (v) => `die-fx-slam-${v}`,  faces: ["top", "top", "bottom", "bottom", "bottom", "bottom"] },
  direction: { file: (v) => `die-fx-direction-${String(v).replace("-", "")}`,
               faces: ["front", "front-left", "front-right", "rear", "rear-left", "rear-right"] },
  stunt:     { file: (v) => `die-fx-stunt-${v}`, faces: [1, 2, 2, 3, 3, 4] },
  shooting:  { file: (v) => `die-fx-shooting-${String(v).replace("-", "")}`,
               faces: ["large", "large", "large", "medium", "small-medium", "any"] }
};
function diceArtPath(kind, value) {
  const art = DICE_ART[kind];
  return art ? `../images/dice/${art.file(value)}.webp` : null;
}

let diceTrackSlots = { master: null, direction: null };
let diceTrackBurst = [];     // dés de la salve en cours d'accumulation
let diceTrackFlush = null;   // microtâche de vidage programmée
let diceTrackTurnKey = null; // tour auquel appartient l'affichage courant

// REGROUPEMENT D'UN LANCER : un Slam tire slam + direction d'un seul
// coup. Tous les dés notifiés dans la MÊME salve synchrone forment donc
// un lancer, et on vide la file à la microtâche suivante. Les relances
// successives (chaîne de slams, cases d'un Dazed) passent par des
// reprises du générateur : elles arrivent en salves distinctes.
function noteSpecialDie(kind, value) {
  if (!DICE_ART[kind]) return; // le dé de round a son propre module
  diceTrackBurst.push({ kind, value });
  if (diceTrackFlush) return;
  diceTrackFlush = Promise.resolve().then(() => {
    const lancer = diceTrackBurst;
    diceTrackBurst = [];
    diceTrackFlush = null;
    applyDiceTrackRoll(lancer);
  });
}

function applyDiceTrackRoll(dice) {
  const master = dice.find((d) => d.kind !== "direction");
  const direction = dice.find((d) => d.kind === "direction");
  const anime = [];
  if (master) {
    diceTrackSlots.master = master;      // nouvelle action : la droite repart de zéro
    diceTrackSlots.direction = null;
    anime.push("master");
  }
  if (direction) {
    diceTrackSlots.direction = direction;
    anime.push("direction");
  }
  renderDiceTrack(anime);
}

function clearDiceTrack() {
  diceTrackSlots = { master: null, direction: null };
  renderDiceTrack([]);
}

// Vide le dicetrack quand on change de tour : borne la durée de vie
// d'un dé verrouillé, qui ne doit jamais survivre au tour qui l'a tiré.
// ===================================================================
// RECENTRAGE DU PLATEAU SUR LE VÉHICULE ACTIF (retour de Mayrik)
//
// Deux occasions : quand un dé est posé sur le dashboard d'un véhicule
// (il devient le véhicule actif) et quand ce véhicule arrive sur une
// nouvelle case. Les deux se ramènent à UNE seule condition : l'identité
// ou la position du véhicule actif a changé depuis le dernier rendu.
// Un seul point d'accroche suffit donc, et il couvre aussi bien le tour
// du joueur que celui de l'IA.
//
// POURQUOI PAS scrollIntoView({inline:"center"}) : c'est l'API standard
// pour ça, mais elle ne fait rien tant que l'élément est visible — or on
// veut recentrer même un véhicule déjà à l'écran mais mal placé. On pose
// donc scrollLeft directement. Le bornage est gratuit : un navigateur
// ramène toujours scrollLeft dans [0, scrollWidth - clientWidth], ce qui
// donne exactement le comportement demandé — au bord, on fait au mieux
// sans jamais créer de vide sur les côtés.
//
// On ne recentre QUE sur changement : si le joueur fait défiler le
// plateau à la main pour regarder ailleurs, on ne lui reprend pas la
// vue tant que rien ne bouge.
// ===================================================================
let lastBoardFocusKey = null;

function activeCarForFocus() {
  if (typeof sel !== "undefined" && sel && sel.car) return sel.car;
  const ai = (typeof currentAiDecision !== "undefined") ? currentAiDecision : null;
  return (ai && ai.car) ? ai.car : null;
}

function focusBoardOnActiveCar() {
  const vp = document.getElementById("board-viewport");
  const svg = document.getElementById("board");
  if (!vp || !svg || typeof vp.scrollTo !== "function") return;
  const car = activeCarForFocus();
  if (!car || car.status === "eliminated") { lastBoardFocusKey = null; return; }
  // Véhicule encore hors plateau (premier tour) : il n'a pas de case sur
  // laquelle centrer, mais il va entrer par la GAUCHE. On cale donc la
  // vue à fond à gauche plutôt que de ne rien faire — sans ça, poser un
  // dé au premier tour ne mettait rien en valeur et il fallait faire
  // défiler à la main jusqu'au bord (retour de Mayrik).
  if (car.col === null) {
    const key = `${car.id}|hors-plateau`;
    if (key === lastBoardFocusKey) return;
    lastBoardFocusKey = key;
    vp.scrollTo({ left: 0, behavior: "smooth" });
    return;
  }
  const key = `${car.id}|${car.col}|${car.row}`;
  if (key === lastBoardFocusKey) return;
  lastBoardFocusKey = key;

  const vb = svg.viewBox && svg.viewBox.baseVal;
  const largeurRendue = parseFloat(svg.style.width) || svg.getBoundingClientRect().width;
  if (!vb || !vb.width || !largeurRendue || !vp.clientWidth) return;
  const echelle = largeurRendue / vb.width;
  const { cx } = cellCenter(car.col, car.row);
  vp.scrollTo({ left: (cx - vb.x) * echelle - vp.clientWidth / 2, behavior: "smooth" });
}

function syncDiceTrackTurn() {
  if (!G || !G.roundState) return;
  const key = `${G.roundState.roundNumber}|${getCurrentPlayer(G.roundState)}|` +
              `${G.roundState.turnsThisRound[getCurrentPlayer(G.roundState)]}`;
  if (key === diceTrackTurnKey) return;
  diceTrackTurnKey = key;
  clearDiceTrack();
  releaseSpeedometer(); // le déplacement du tour précédent est fini
}

function renderDiceTrack(aAnimer) {
  const box = document.getElementById("dicetrack-module");
  if (!box) return;
  const slots = [["master", diceTrackSlots.master], ["direction", diceTrackSlots.direction]];
  box.innerHTML = slots.map(([nom, d]) => d
    ? `<img class="dicetrack-face" data-dicetrack-slot="${nom}" src="${diceArtPath(d.kind, d.value)}" alt="">`
    : "").join("");
  if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") return;
  // Seuls les dés que CE lancer a changés volent : un dé verrouillé
  // reste simplement en place, sans rejouer son animation.
  let rang = 0;
  slots.forEach(([nom, d]) => {
    if (!d || !aAnimer.includes(nom)) return;
    const face = box.querySelector(`[data-dicetrack-slot="${nom}"]`);
    const art = DICE_ART[d.kind];
    animateOneMovingDie(face, d.value, null, (rang++) * 160, 900, {
      faceHTML: (v, size) => `<img src="${diceArtPath(d.kind, v)}" style="position:absolute;left:0;top:0;width:${size}px;height:${size}px;">`,
      randomFace: () => art.faces[Math.floor(Math.random() * art.faces.length)]
    });
  });
}

// ===================================================================
// MODULE SPEEDOMETER — cases de mouvement encore disponibles.
//
// Remplace l'afficheur ROUND, supprimé : Mayrik a constaté après de
// nombreuses parties qu'aucune mécanique n'utilise le numéro de manche,
// alors que le nombre de cases restantes manque en permanence pendant
// la phase de mouvement. Le speedometer réclamait exactement le format
// du road die, il a donc simplement pris sa place.
//
// D'OÙ VIENT LA VALEUR, dans l'ordre de priorité :
//   1. pendant un déplacement : le moteur notifie le compteur réel à
//      chaque case entrée (voir setMovesObserver dans engine.js). C'est
//      lui qui fait foi, et il compte juste la boue, qui coûte 2 cases ;
//   2. avant le déplacement : la valeur du dé posé sur le dashboard,
//      plus celle du dé de Nitro s'il y en a un ;
//   3. sinon : 0.
// Le compteur retombe à 0 en fin de phase de mouvement et y reste
// jusqu'à ce que le joueur suivant pose un dé.
//
// EXTENSION À VENIR (dé Fire) : un véhicule en feu tirera un dé
// ajoutant 1 ou 2 cases au début de sa phase de mouvement. Comme le
// moteur notifie la variable de compteur elle-même et non le dé,
// l'affichage suivra sans modification ici.
// ===================================================================
let speedoValue = 0;
let speedoLive = false;   // vrai tant qu'un déplacement est en cours

function noteMovesRemaining(n) {
  speedoValue = Math.max(0, Number(n) || 0);
  speedoLive = true;
  renderSpeedometer();
}

// Valeur annoncée par les dés posés, tant que rien ne bouge encore.
function speedoFromAssignment() {
  if (typeof sel !== "undefined" && sel && sel.car && typeof sel.dieValue === "number") {
    const nitro = (sel.commandType === "nitro" && typeof sel.commandDieValue === "number")
      ? sel.commandDieValue : 0;
    return sel.dieValue + nitro;
  }
  const ai = (typeof currentAiDecision !== "undefined") ? currentAiDecision : null;
  if (ai && ai.car && typeof ai.dieValue === "number" && !ai.isCoast) {
    const nitro = (ai.command && ai.command.type === "nitro" && typeof ai.command.dieValue === "number")
      ? ai.command.dieValue : 0;
    return ai.dieValue + nitro;
  }
  return 0;
}

function syncSpeedometer() {
  if (speedoLive) return;              // un déplacement en cours fait foi
  const v = speedoFromAssignment();
  if (v !== speedoValue) { speedoValue = v; renderSpeedometer(); }
}

// Le déplacement est terminé : on repasse en lecture des dés posés.
function releaseSpeedometer() {
  speedoLive = false;
  speedoValue = speedoFromAssignment();
  renderSpeedometer();
}

// Afficheur à 7 segments dessiné en SVG plutôt qu'avec une police de
// caractères : aucune police digitale n'est disponible sur les
// hébergeurs de polices utilisés par le jeu, et une police ajoutée au
// dépôt serait un fichier de plus à charger. Sept polygones biseautés
// suffisent, et le rendu est net à n'importe quelle taille.
const SEVEN_SEGMENT = {
  "0":"abcdef", "1":"bc", "2":"abged", "3":"abgcd", "4":"fgbc",
  "5":"afgcd", "6":"afgedc", "7":"abc", "8":"abcdefg", "9":"abcfgd"
};
const SEG_W = 12, SEG_H = 22, SEG_T = 3;
function segPolygon(seg) {
  const t = SEG_T / 2;
  const h = (x0, L, yc) => `${x0},${yc} ${x0+t},${yc-t} ${x0+L-t},${yc-t} ${x0+L},${yc} ${x0+L-t},${yc+t} ${x0+t},${yc+t}`;
  const v = (xc, y0, L) => `${xc},${y0} ${xc+t},${y0+t} ${xc+t},${y0+L-t} ${xc},${y0+L} ${xc-t},${y0+L-t} ${xc-t},${y0+t}`;
  return { a: h(1.5, 9, 1.5), g: h(1.5, 9, 11), d: h(1.5, 9, 20.5),
           f: v(1.5, 2, 8.5), b: v(10.5, 2, 8.5),
           e: v(1.5, 11.5, 8.5), c: v(10.5, 11.5, 8.5) }[seg];
}
function sevenSegmentSVG(texte, couleur) {
  const pas = SEG_W + 3;
  const chiffres = [...texte].map((ch, i) => {
    const allumes = SEVEN_SEGMENT[ch] || "";
    const segs = "abcdefg".split("").map((seg) =>
      `<polygon points="${segPolygon(seg)}" fill="${couleur}" opacity="${allumes.includes(seg) ? 1 : 0.12}"/>`).join("");
    return `<g transform="translate(${i * pas},0)">${segs}</g>`;
  }).join("");
  const w = texte.length * pas - 3;
  return `<svg viewBox="0 0 ${w} ${SEG_H}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">${chiffres}</svg>`;
}

// Vert des cases candidates au mouvement (#b0d458), sans transparence.
const SPEEDO_COLOR = "#b0d458";

function renderSpeedometer() {
  const el = document.getElementById("speedometer-value");
  if (el) el.innerHTML = sevenSegmentSVG(String(speedoValue), SPEEDO_COLOR);
}


// ===================================================================
// ZONE 3 — Dashboards : zoom et déplacement
//
// PANZOOM A ÉTÉ RETIRÉ ICI. Ce n'était pas un défaut de la
// bibliothèque : son option contain:"outside" garantit que le contenu
// RECOUVRE son conteneur. Tant que la hauteur du conteneur était posée
// égale à la hauteur naturelle du contenu, « recouvrir » et « tenir
// dedans » étaient la même chose. Depuis que le moteur de mise en page
// décide de cette hauteur, les deux divergent : au clic sur x1,
// Panzoom appliquait scale(1,039) pour recouvrir 447 px de conteneur
// avec 430 px de contenu, d'où 16 px de débordement à droite sur
// téléphone. Le désaccord était structurel, pas accidentel.
//
// À LA PLACE : le défilement natif du navigateur, et un zoom qui change
// simplement la LARGEUR du SVG.
//   - le confinement devient structurel : on ne peut pas défiler
//     au-delà du contenu, il n'y a plus rien à calculer ni à recaler
//     après un redimensionnement ;
//   - l'inertie du geste est celle du système, pas une décroissance
//     exponentielle écrite à la main (une cinquantaine de lignes
//     supprimées avec Panzoom) ;
//   - le SVG est redessiné en vectoriel à sa nouvelle taille, donc le
//     texte des cartes est NET à x4 — seule raison d'être du x4.
// Mesuré : un changement de largeur coûte au pire 0,4 ms sur ce SVG, on
// peut donc le committer à chaque image d'un pincement sans saccade
// (pas besoin de la technique en deux temps transform/largeur).
// ===================================================================
const DASH_ZOOM_MIN = 1, DASH_ZOOM_MAX = 4;
const DASH_TAP_MS = 300, DASH_TAP_SLOP = 30;
let dashZoom = 1;

function getDashboardsZoom() { return dashZoom; }

// Applique un zoom en gardant sous le doigt (ou sous le curseur) le
// point visé. Le rapport des défilements suffit : il ne dépend ni de la
// taille du conteneur ni de l'apparition d'une barre de défilement.
function setDashboardsZoom(next, anchor) {
  const vp = document.getElementById("dashboards-viewport");
  const rail = document.getElementById("dashboards-rail");
  if (!vp || !rail) return;
  const target = Math.min(DASH_ZOOM_MAX, Math.max(DASH_ZOOM_MIN, next));
  const rect = vp.getBoundingClientRect();
  const ax = anchor ? anchor.clientX - rect.left : rect.width / 2;
  const ay = anchor ? anchor.clientY - rect.top : rect.height / 2;
  const k = target / dashZoom;
  dashZoom = target;
  // Le zoom élargit les COLONNES du rail ; chaque rangée occupe 100% de
  // sa colonne et sa hauteur suit son rapport d'aspect. La zone
  // défilable grandit donc d'elle-même, sans rien à recalculer.
  rail.style.setProperty("--dash-zoom", String(target));
  vp.scrollLeft = (vp.scrollLeft + ax) * k - ax;
  vp.scrollTop = (vp.scrollTop + ay) * k - ay;
  updateDashboardsZoomButtons();
}

function updateDashboardsZoomButtons() {
  document.querySelectorAll("#dashboards-zoom-presets button").forEach((btn) => {
    btn.classList.toggle("active", Number(btn.dataset.zoomPreset) === Math.round(dashZoom));
  });
}

function initDashboardsZoom() {
  const vp = document.getElementById("dashboards-viewport");
  const rail = document.getElementById("dashboards-rail");
  if (!vp || !rail) return;
  rail.style.setProperty("--dash-zoom", "1");

  document.querySelectorAll("#dashboards-zoom-presets button").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      setDashboardsZoom(Number(btn.dataset.zoomPreset), null);
      // Retour de Mayrik : après un changement de palier, la vue revient
      // en haut à gauche du rail. À x2, cela cadre pile un dashboard
      // entier — et comme le rail commence par le joueur du tour, c'est
      // son dashboard qui se présente.
      vp.scrollLeft = 0;
      vp.scrollTop = 0;
    });
  });

  // Molette : zoom seulement avec Ctrl/Cmd (c'est aussi ce que le
  // navigateur envoie pour un pincement sur pavé tactile). La molette
  // seule fait défiler, comme partout ailleurs.
  vp.addEventListener("wheel", (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setDashboardsZoom(dashZoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e);
  }, { passive: false });

  // --- Gestes : un seul flux d'événements pointeur pour la souris, le
  // tactile et le stylet. Plus de touchend + dblclick en parallèle,
  // donc plus de double déclenchement à rattraper avec preventDefault,
  // un drapeau de garde et un écouteur non-passif — ce dernier
  // empêchait d'ailleurs le défilement natif d'être fluide.
  const pointers = new Map();
  let pinchStartDist = 0, pinchStartZoom = 1;
  let downAt = 0, downX = 0, downY = 0, moved = false;
  // -Infinity et non 0 comme sentinelle « tap déjà consommé » : dans les
  // 300 premières millisecondes de vie de la page, performance.now() - 0
  // est lui-même sous le seuil, et un 3e tap serait pris pour le second
  // d'un nouveau double-tap (défaut trouvé au test, pas à la relecture).
  let lastTapAt = -Infinity, lastTapX = 0, lastTapY = 0;

  const dist = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const mid = () => {
    const [a, b] = [...pointers.values()];
    return { clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 };
  };

  vp.addEventListener("pointerdown", (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) { pinchStartDist = dist(); pinchStartZoom = dashZoom; }
    downAt = performance.now(); downX = e.clientX; downY = e.clientY; moved = false;
  });

  vp.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 10) moved = true;
    if (pointers.size === 2 && pinchStartDist > 0) {
      // Pincement : on commite la largeur en direct (0,4 ms) plutôt que
      // de passer par un transform provisoire — le texte reste net
      // pendant tout le geste.
      e.preventDefault();
      setDashboardsZoom(pinchStartZoom * (dist() / pinchStartDist), mid());
    }
  }, { passive: false });

  const release = (e) => {
    const wasPinching = pointers.size === 2;
    pointers.delete(e.pointerId);
    if (wasPinching) { pinchStartDist = 0; return; } // fin de pincement : jamais un tap
    if (pointers.size > 0 || moved) return;
    if (performance.now() - downAt > 250) return;    // appui long : pas un tap
    const now = performance.now();
    if (now - lastTapAt < DASH_TAP_MS &&
        Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < DASH_TAP_SLOP) {
      // Double-tap (retour de Mayrik) : x1 -> x4, sinon retour à x1.
      // Le x4 n'est pas un confort mais la seule façon de lire une carte
      // sur téléphone, il doit rester atteignable en un geste.
      setDashboardsZoom(dashZoom > 1.01 ? 1 : DASH_ZOOM_MAX,
                        { clientX: e.clientX, clientY: e.clientY });
      lastTapAt = -Infinity;
    } else {
      lastTapAt = now; lastTapX = e.clientX; lastTapY = e.clientY;
    }
  };
  vp.addEventListener("pointerup", release);
  vp.addEventListener("pointercancel", (e) => { pointers.delete(e.pointerId); pinchStartDist = 0; });

  updateDashboardsZoomButtons();
}

// Cale la hauteur du conteneur pour cadrer EXACTEMENT l'ensemble des
// dashboards à l'échelle 1 (comme aujourd'hui, retour de Mayrik) —
// calculé depuis le viewBox plutôt que mesuré sur le DOM, pour rester
// correct même si un zoom Panzoom est déjà appliqué au moment de
// l'appel (measurer directement donnerait la taille TRANSFORMÉE, pas
// la taille de base).
// BUG CORRIGÉ (retour de Mayrik, décalage horizontal constaté sur un
// vrai téléphone — bande vide à gauche des command boards, graphisme
// tronqué à droite) : une bascule largeur/hauteur avait été ajoutée
// ici par précaution (même risque structurel que le plateau, voir
// applyBoardSizing), mais CETTE zone n'avait jamais été prise en
// défaut par un test réel — contrairement au plateau, elle est
// gérée par Panzoom (voir initDashboardsPanzoom), qui applique son
// propre transform (scale+translate) sur ce même SVG. Changer la
// largeur du SVG en dehors du contrôle de Panzoom entre en conflit
// avec son transform déjà posé, décalant visuellement le contenu —
// cause la plus probable du décalage observé, bien que non reproduite
// dans mes propres tests (uniquement sur l'appareil réel de Mayrik).
// Annulé par prudence : cette zone est spécifique (gérée par Panzoom,
// pas par un simple défilement natif comme le plateau) et ne doit pas
// recevoir la même extension sans une vérification directe sur
// appareil, plutôt que de continuer à deviner une correction à
// distance.
// Conservée sous son nom d'origine (appelée par render()) : la hauteur
// de la zone dashboards est désormais calculée par le moteur, en même
// temps que celle de tous les autres modules — il n'y a plus de calcul
// séparé qui puisse entrer en contradiction avec les autres.
function updateDashboardsViewportHeight() { applyLayout(); scrollActivePlayerIntoView(); }

// ===================================================================
// ANIMATION DE LANCER DE DÉS — début de round (dés de MOUVEMENT du
// diceboard uniquement pour l'instant). Technique validée avec Mayrik
// sur un prototype autonome avant intégration ici : position X en
// avance monotone (jamais de retour en arrière), hauteur pilotée par
// la fonction de rebond de Robert Penner (easeOutBounce — cf.
// https://easings.net/#easeOutBounce et le tutoriel javascript.info
// "Animate the bouncing ball", qui applique exactement cette même
// fonction à la position verticale d'une chute). Entrée par
// l'extérieur gauche de l'écran, cyclage rapide des faces pendant le
// vol, écrasement (squash) automatique à chaque contact avec le sol,
// ombre qui s'efface en fondu une fois le dé posé.
//
// PIÈGE ÉVITÉ (important) : le SVG #dashboards est piloté par Panzoom
// (voir pièges techniques du projet — ne jamais toucher aux
// dimensions/viewBox du SVG en dehors de son API). Dessiner les dés
// animés À L'INTÉRIEUR de ce SVG, hors de son viewBox actuel, les
// aurait rendus invisibles (le SVG les découpe lui-même avant même que
// Panzoom applique son propre pan/zoom). Solution : une surcouche HTML
// `position:fixed` totalement INDÉPENDANTE de Panzoom, positionnée en
// coordonnées ÉCRAN RÉELLES via getBoundingClientRect() du vrai dé
// final déjà dessiné par le render() normal (donc toujours juste,
// quel que soit le pan/zoom en cours) — jamais de recalcul manuel des
// coordonnées SVG/Panzoom.
//
// Choix d'intégration (pour ne RIEN casser d'existant) : cette
// animation est une SURCOUCHE PUREMENT COSMÉTIQUE, ajoutée PAR-DESSUS
// un render() déjà terminé et déjà correct (le vrai dé est simplement
// masqué le temps du vol, puis révélé) — jamais un remplacement du
// rendu réel, qui reste 100% synchrone comme avant. Elle ne se
// déclenche que si window.requestAnimationFrame existe réellement :
// tous nos tests jsdom en sont dépourvus (vérifié : seul
// test-ui-layout-zoom.js le polyfille, pour Panzoom, et ne traverse
// aucun changement de round), donc AUCUN test existant n'est affecté.
function easeOutBounceDie(t) {
  const n1 = 7.5625, d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) { t -= 1.5 / d1; return n1 * t * t + 0.75; }
  if (t < 2.5 / d1) { t -= 2.25 / d1; return n1 * t * t + 0.9375; }
  t -= 2.625 / d1;
  return n1 * t * t + 0.984375;
}
function easeOutCubicDie(t) { return 1 - Math.pow(1 - t, 3); }

// Round déjà animé (ou en cours d'animation) — évite de relancer le
// lancer à chaque render() appelé pendant le même round (un clic du
// joueur redessine tout, mais ne doit rejouer l'animation qu'au
// changement RÉEL de round). 0 = aucun round encore animé.
let lastRolledRoundNumber = 0;

// Contenu HTML (face + pips) d'un dé de mouvement pour une valeur
// donnée, à une taille donnée — même logique de calage que
// dieMarkup()/diePipLayout() (grille 3x3, un pip = 1/3 de la face),
// simplement transposée en <img> HTML plutôt qu'en <image> SVG.
function movingDieOverlayHTML(value, color, size) {
  const pipCell = size / 3;
  const facePath = `../images/dice/die-move-${color}.webp`;
  const pipPath = `../images/dice/die-move-pip.webp`;
  const pips = diePipLayout(value).map(([col, row]) => {
    const px = col * pipCell, py = row * pipCell;
    return `<img src="${pipPath}" style="position:absolute; left:${px}px; top:${py}px; width:${pipCell}px; height:${pipCell}px;">`;
  }).join("");
  return `<img src="${facePath}" style="position:absolute; left:0; top:0; width:${size}px; height:${size}px;">${pips}`;
}

function diceRollOverlayRoot() {
  let overlay = document.getElementById("dice-roll-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "dice-roll-overlay";
    Object.assign(overlay.style, {
      position: "fixed", inset: "0", pointerEvents: "none", zIndex: "9999", overflow: "visible"
    });
    document.body.appendChild(overlay);
  }
  return overlay;
}

// Anime UN dé, de l'extérieur gauche de l'écran jusqu'au rectangle
// écran réel du vrai dé déjà rendu (targetEl) — masqué le temps du
// vol, révélé une fois l'animation terminée (déjà à la bonne valeur/
// position, aucun changement visuel au moment de la révélation).
// opts.faceHTML(valeur, taille) permet de voler une face différente des
// dés de mouvement : le dé de round a son propre visuel (images
// die-fx-road-N.webp) et seulement 3 faces, pas 6.
function animateOneMovingDie(targetEl, finalValue, color, delay, totalMs, opts) {
  const faceHTML = (opts && opts.faceHTML) || ((v, sz) => movingDieOverlayHTML(v, color, sz));
  const randomFace = (opts && opts.randomFace) || (() => 1 + Math.floor(Math.random() * 6));
  // Chantier 4a : la promesse n'est plus seulement rendue à l'appelant
  // (qui la jetait), elle est inscrite au registre des animations en
  // vol — c'est ce qui permet aux pilotes de l'attendre.
  return suivreAnimation(new Promise((resolve) => {
    const rect = targetEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) { resolve(); return; } // élément non visible (safety net)

    const size = rect.width;
    const toX = rect.left + size / 2, toY = rect.top + size / 2;
    const fromX = -size * 2; // hors-champ, à l'extérieur gauche de l'écran
    const fromY = toY - size * 1.2;
    const amplitude = Math.max(size, toY - fromY);

    targetEl.style.opacity = "0"; // masqué le temps du vol, révélé à l'identique à la fin

    const overlayRoot = diceRollOverlayRoot();

    const die = document.createElement("div");
    die.style.position = "fixed";
    die.style.width = size + "px";
    die.style.height = size + "px";
    die.style.willChange = "transform";
    die.innerHTML = faceHTML(finalValue, size);

    const shadow = document.createElement("div");
    shadow.style.position = "fixed";
    shadow.style.width = size + "px";
    shadow.style.height = size * 0.28 + "px";
    shadow.style.borderRadius = "50%";
    shadow.style.background = "rgba(0,0,0,0.55)";
    shadow.style.filter = "blur(2px)";

    overlayRoot.appendChild(shadow);
    overlayRoot.appendChild(die);

    setTimeout(() => {
      let cycling = true;
      const cycle = setInterval(() => {
        if (cycling) die.innerHTML = faceHTML(randomFace(), size);
      }, 60);

      const startTime = performance.now();

      function frame(now) {
        const t = Math.min(1, (now - startTime) / totalMs);

        const x = fromX + (toX - fromX) * easeOutCubicDie(t);
        const heightAboveGround = amplitude * (1 - easeOutBounceDie(t));
        const y = toY - heightAboveGround;

        const rot = easeOutCubicDie(t) * 420;
        const contactPulse = Math.max(0, 1 - heightAboveGround / (amplitude * 0.12));
        const scaleX = 1 + contactPulse * 0.3;
        const scaleY = 1 - contactPulse * 0.3;

        die.style.transform =
          `translate(${x - size / 2}px, ${y - size / 2}px) rotate(${rot}deg) scale(${scaleX}, ${scaleY})`;

        const shadowScale = Math.max(0.3, 1 - heightAboveGround / amplitude);
        shadow.style.transform = `translate(${x - size / 2}px, ${toY + size * 0.36}px) scale(${shadowScale})`;
        shadow.style.opacity = (0.2 + 0.35 * shadowScale).toFixed(2);

        if (cycling && t > 0.8) {
          cycling = false;
          clearInterval(cycle);
          die.innerHTML = faceHTML(finalValue, size);
        }

        if (t < 1) {
          requestAnimationFrame(frame);
        } else {
          die.style.transform = `translate(${toX - size / 2}px, ${toY - size / 2}px)`;
          shadow.style.transition = "opacity 400ms ease";
          shadow.style.opacity = "0";
          setTimeout(() => {
            shadow.remove();
            die.remove();
            targetEl.style.opacity = ""; // révèle le vrai dé, déjà à la bonne place/valeur
            resolve();
          }, 420);
        }
      }
      requestAnimationFrame(frame);
    }, delay);
  }));
}

// Déclenche le lancer animé des 4 dés de mouvement de CHAQUE joueur,
// par-dessus le render() déjà effectué. N'affecte jamais le déroulé
// réel du jeu : les vraies valeurs (déjà tirées par le moteur dans
// G.roundState.dicePool) sont connues à l'avance, cette fonction ne
// fait que les mettre en scène visuellement.
function playRoundDiceRollAnimation() {
  const rail = document.getElementById("dashboards-rail");
  if (!rail) return;

  const order = currentDashboardRowOrder();
  const allDicePromises = [];

  order.forEach((playerName, rowIndex) => {
    const values = diceboardSlots(playerName); // 4 valeurs déjà tirées par le moteur pour ce round
    const color = PLAYER_CAR_COLOR[playerName];

    values.forEach((value, i) => {
      if (value === null) return;
      const targetEl = rail.querySelector(`[data-diceboard-die="${playerName}:${i}"]`);
      if (!targetEl) return; // safety net (ex. test/rendu partiel)
      allDicePromises.push(animateOneMovingDie(targetEl, value, color, rowIndex * 90 + i * 70, 1300));
    });
  });

  return Promise.all(allDicePromises);
}

// Gate de sécurité : ne déclenche l'animation que dans un vrai
// navigateur (requestAnimationFrame réellement disponible) et
// seulement au changement RÉEL de round — jamais à chaque simple
// render() dans le même round. Voir le commentaire détaillé plus haut
// sur pourquoi ceci ne peut casser aucun test existant.
// Lance le dé de round vers son module, puis rend la main. La face
// reste ensuite affichée jusqu'au round suivant.
function playRoadDieRollAnimation() {
  const face = document.getElementById("roaddie-face");
  const value = (G && G.roundState && G.roundState.roadDie) || null;
  if (!face || !value) return Promise.resolve();
  return animateOneMovingDie(face, value, null, 0, 1100, {
    faceHTML: roadDieFaceHTML,
    randomFace: () => ROAD_DIE_TABLE[Math.floor(Math.random() * ROAD_DIE_TABLE.length)]
  });
}

// SÉQUENCE DE DÉBUT DE ROUND (ordre demandé par Mayrik) :
//   1. le dé de round part seul vers son module ;
//   2. sa face y reste affichée jusqu'à la fin du round ;
//   3. seulement ensuite les 4 dés de mouvement de chaque joueur
//      s'envolent vers les diceboards.
// Le chaînage garantit l'ordre : les dés des joueurs ne partent qu'une
// fois le dé de round posé, jamais en même temps.
function maybeTriggerRoundDiceRollAnimation() {
  if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") return;
  if (G.roundState.roundNumber === lastRolledRoundNumber) return;
  lastRolledRoundNumber = G.roundState.roundNumber;
  // Inscrite comme UNE seule animation : sans ça, le registre se
  // retrouve vide entre l'atterrissage du road die et le départ des dés
  // des joueurs, et un pilote en attente repartirait au milieu.
  suivreAnimation(playRoadDieRollAnimation().then(() => playRoundDiceRollAnimation()));
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

  setupBoardScroll();
  renderBoard();
  renderDashboards();
  renderPanel();
  updateInfoBand(cp);
  updateDashboardsViewportHeight();

  document.getElementById("damageRow").innerHTML = G.allCars
    .filter((car) => car.status !== "eliminated" && !car.isWreck) // les épaves n'ont aucun affichage UI (retour de Mayrik)
    .map((car) => `<span class="badge">${car.owner} ${car.size} : ${car.damageTokens.length} dégât(s)${car.status === "inoperable" ? " [INOPÉRABLE]" : ""}</span>`)
    .join("");

  // Bannière de fin de partie retirée d'ici (retour de Mayrik) — elle
  // vit désormais dans le SVG du plateau, centrée dessus (voir la fin
  // de renderBoard()). L'élément #winnerBanner externe reste caché.
  document.getElementById("winnerBanner").style.display = "none";

  const logEl = document.getElementById("log");
  logEl.innerHTML = fullLog.slice().reverse().map((e) => e.sep ? `<div class="turn-sep">${e.sep}</div>` : `<div class="line">${e.line}</div>`).join("");

  appliquerVoileDeGel();
  maybeTriggerRoundDiceRollAnimation();
}

// ===================================================================
// DÉMARRAGE
// ===================================================================
// Mise en page des 3 zones (retour de Mayrik) : câblage des écouteurs
// une seule fois ici, jamais répété dans render() (contrairement à
// setupBoardScroll()/updateDashboardsViewportHeight(), rappelées à
// chaque rendu — voir leurs commentaires respectifs).
initPaceFromStorage(); // vitesse de rythme : dernier choix mémorisé, modifiable sur l'écran d'accueil
initDashboardsZoom();
if (typeof setDiceObserver === "function") setDiceObserver(noteSpecialDie);
if (typeof setMovesObserver === "function") setMovesObserver(noteMovesRemaining);

// Bouton plein écran (retour de Mayrik : voir le rendu réel sans la
// barre d'adresse du navigateur, en attendant une vraie installation
// PWA). API Fullscreen standard — NE FONCTIONNE PAS sur iOS
// Safari/Chrome pour un élément quelconque (restriction délibérée
// d'Apple, encore vraie aujourd'hui ; seul un PWA installé via
// "Ajouter à l'écran d'accueil" donne cette expérience sur iPhone).
// document.fullscreenEnabled détecte proprement ce cas : bouton
// masqué plutôt que présent mais inopérant.
const fullscreenBtn = document.getElementById("fullscreen-btn");
if (fullscreenBtn) {
  if (!document.fullscreenEnabled) {
    fullscreenBtn.style.display = "none";
  } else {
    fullscreenBtn.addEventListener("click", () => {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    });
    document.addEventListener("fullscreenchange", () => {
      fullscreenBtn.textContent = document.fullscreenElement ? "⛶ Quitter" : "⛶ Plein écran";
    });
  }
}
document.getElementById("board-viewport").addEventListener("scroll", syncBoardSlider);
document.getElementById("board-position-slider").addEventListener("input", onBoardSliderInput);
// Toutes les sources de changement de taille convergent vers un unique
// passage, groupé sur la prochaine image. window.resize seul ne suffit
// pas sur mobile : il ne se déclenche pas quand les barres système
// apparaissent ou disparaissent (plein écran, rotation) — d'où
// visualViewport.resize et fullscreenchange.
const scheduleLayout = (() => {
  let frame = 0;
  return () => {
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
    const run = () => { applyLayout(); syncBoardSlider(); };
    frame = (typeof requestAnimationFrame === "function") ? requestAnimationFrame(run) : (run(), 0);
  };
})();
window.addEventListener("resize", scheduleLayout);
window.addEventListener("orientationchange", scheduleLayout);
document.addEventListener("fullscreenchange", scheduleLayout);
if (window.visualViewport) window.visualViewport.addEventListener("resize", scheduleLayout);
if (typeof ResizeObserver === "function") new ResizeObserver(scheduleLayout).observe(document.documentElement);

// Écran d'accueil (retour de Mayrik) : visible par défaut (voir
// template.html), masqué dès qu'une partie démarre — que ce soit par
// un choix explicite (bouton 1/2/3 IA) ou par la reprise d'une
// sauvegarde existante (dans ce cas, le réglage d'alors est restauré
// tel quel par restoreGameState(), pas besoin de repasser par
// l'écran).
function hideStartScreen() {
  const el = document.getElementById("start-screen");
  if (el) el.style.display = "none";
}

function startNewGameFromScreen(aiCount) {
  configurePlayers(aiCount);
  hideStartScreen();
  newGame();
  resetSelection();
  render();
}

document.querySelectorAll(".opponent-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    startNewGameFromScreen(parseInt(btn.dataset.aiCount, 10));
  });
});

// Vitesse des animations (chantier rythme) : trois boutons sur le même
// écran que le choix du nombre d'IA. Ils ne lancent rien — ils fixent
// la vitesse de la partie lancée juste après, et la mémorisent. Le
// bouton actif est celui de la vitesse en cours, donc l'écran s'ouvre
// déjà sur le dernier réglage utilisé (voir initPaceFromStorage).
function syncPaceButtons() {
  document.querySelectorAll(".pace-btn").forEach((btn) => {
    btn.classList.toggle("selected", btn.dataset.pace === currentPaceSpeed());
  });
}

document.querySelectorAll(".pace-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!setPaceSpeed(btn.dataset.pace)) return; // valeur inconnue : on ne touche à rien
    memoriserVitesse();
    syncPaceButtons();
  });
});
syncPaceButtons();

const savedGame = loadGameState();
if (savedGame && confirm("Une partie sauvegardée a été trouvée. Reprendre cette partie ?")) {
  hideStartScreen();
  restoreGameState(savedGame);
  resetSelection();
  render();
} else if (savedGame) {
  clearSavedGame(); // le joueur a choisi de repartir à zéro
  // L'écran d'accueil reste affiché (visible par défaut) — on attend
  // son choix via un des boutons ci-dessus.
}
// Sans sauvegarde du tout : l'écran d'accueil reste affiché tel quel,
// rien à faire de plus ici.

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
