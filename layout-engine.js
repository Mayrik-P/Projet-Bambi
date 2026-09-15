/**
 * layout-engine.js — Moteur de mise en page du jeu.
 *
 * RÔLE : à partir des seules dimensions utiles de l'écran, décider où
 * va chaque module et quelle taille il reçoit. Fonction PURE : aucun
 * accès au DOM, aucune mesure, aucun effet de bord — elle prend des
 * nombres et rend des rectangles. C'est ce qui la rend testable hors
 * navigateur (voir test-layout-engine.js, qui la passe sur ~12 000
 * tailles d'écran) là où l'ancienne mise en page, écrite en impératif
 * dans ui-script.js, n'était vérifiable qu'à l'œil sur un vrai
 * téléphone.
 *
 * POURQUOI CE MODULE EXISTE : l'ancienne mise en page calculait la
 * hauteur de chaque zone indépendamment des autres, puis confiait le
 * tout à une colonne flex. Quand la somme dépassait la hauteur
 * disponible — systématiquement en paysage et sur ordinateur —
 * flexbox rétrécissait les conteneurs en silence pendant que les SVG
 * gardaient la taille qu'on leur avait donnée, d'où le plateau tronqué
 * (mesuré : 50 px obtenus pour 164 px demandés en paysage). Ici, un
 * seul calcul répartit la totalité de la hauteur entre tous les
 * modules : plus personne ne peut réclamer une place qui n'existe pas.
 *
 * LES 7 MODULES : plateau, dashboards, info contextuelle,
 * illustration, dicetrack, round, road die. Chacun porte un minimum
 * chiffré (voir SPEC) tiré du contenu réel — longueur du texte le plus
 * long mesurée dans la police du jeu, rapport d'aspect des images de
 * véhicules, seuil de cible tactile pour les cases du plateau.
 *
 * ÉCHELLE DE DÉGRADATION : quand tout ne rentre pas, l'ordre des
 * sacrifices est fixé et identique partout — dicetrack et road die en
 * surimpression, puis illustration, puis texte court sur une ligne,
 * puis dashboards en tiroir. Le plateau et l'info ne sont jamais
 * sacrifiés : ce sont eux qui portent le jeu.
 *
 * DEUX RÈGLES NON ÉVIDENTES, découvertes au balayage automatique :
 *  - la hauteur du plateau est plafonnée par « une tuile entière
 *    visible en largeur », PAS par la taille de case : sans ce
 *    plafond, l'algorithme agrandissait le plateau jusqu'à n'en
 *    montrer que 0,73 tuile ;
 *  - sous ~363 px de large, « une tuile entière » et « case >= 44 px »
 *    s'excluent mathématiquement (8 cases dans 348 px font 43,5 px).
 *    La tuile entière gagne, la case cède.
 *
 * MODULES PRÉSENTS : le 5e argument `present` déclare quels modules
 * existent réellement dans le DOM appelant. Un module absent n'est pas
 * placé du tout et sa place est rendue aux autres — jamais une boîte
 * vide. C'est ce qui permet d'intégrer ce moteur au jeu par étapes :
 * aujourd'hui seuls le plateau, l'info, le round et les dashboards ont
 * du contenu ; illustration, dicetrack et road die s'activeront quand
 * le leur arrivera, sans retoucher à la mise en page.
 *
 * Utilisable tel quel dans Node (module.exports) comme dans le
 * navigateur (variables globales après concaténation ou <script>).
 */

"use strict";

const SPEC = {
  board: { vbW:907.7, vbH:229.3, cellW:37.90, tileW:303.0, cellMin:44, cellMax:92 },
  dash:  { aspect:871/234, minW:340, minVisible:2 },
  info:  { hTwoLines:48, hOneLine:32, minW:340, oneLineFrom:800 },
  illu:  { min:160, target:200 },
  dice:  { minW:140, minH:72 },
  round: { minW:80,  minH:28 },
  roaddie:{ min:64, target:88 },
  gap: 6
};
const boardMinH = SPEC.board.vbH * (SPEC.board.cellMin / SPEC.board.cellW); // 266 px
const boardMaxH = SPEC.board.vbH * (SPEC.board.cellMax / SPEC.board.cellW);

/* =====================================================================
   2. MOTEUR DE MISE EN PAGE — fonction pure, testable hors navigateur.
      Entrée : dimensions utiles + nombre de joueurs.
      Sortie : un rectangle par module + les dégradations appliquées.
   ===================================================================== */
function computeLayout(W, H, players, forced, present){
  // Plateau, info et dashboards sont toujours là : ce sont eux qui
  // portent le jeu. Les quatre autres sont déclarables absents.
  const has = Object.assign({ illu:true, dice:true, round:true, roaddie:true }, present || {});
  const ratio = W / H;
  const profile = (forced && forced !== "auto") ? forced
    : (ratio < 0.85 ? "portrait" : (W >= 1000 && ratio >= 1.2 && H >= 520 ? "wide" : "landscape"));
  const G = profile === "landscape" ? 4 : SPEC.gap;
  const steps = [];
  const z = {};
  const put = (id, x, y, w, h, minW, minH, over) =>
    z[id] = { id, x:Math.round(x), y:Math.round(y), w:Math.round(w), h:Math.round(h),
              minW, minH, overlay: !!over };
  // Le plateau ne doit jamais être agrandi au point de montrer moins d'une tuile
  // complète en largeur : c'est ce plafond, et non la taille de case, qui le borne.
  const capByTile = bw => SPEC.board.vbH * (bw / SPEC.board.tileW);
  // Sous ~363 px de large, « une tuile entière » et « case ≥ 44 px » s'excluent :
  // 8 cases dans 348 px font 43,5 px. La tuile entière gagne, la case cède.
  const boardMin = bw => Math.min(boardMinH, capByTile(bw));

  if (profile === "portrait") {
    const w = W - 2*G;
    let infoH = W >= SPEC.info.oneLineFrom ? SPEC.info.hOneLine : SPEC.info.hTwoLines;
    let drawer = false, illuOver = false, clusterOver = false;
    const diceH = SPEC.dice.minH + 16;
    // Largeur minimale réclamée par la pile de droite, selon ce qui existe.
    const pairW = (has.roaddie && has.round) ? SPEC.roaddie.min + G + SPEC.round.minW
                : has.roaddie ? SPEC.roaddie.min
                : has.round   ? SPEC.round.minW : 0;
    const stackMinW = Math.max(has.dice ? SPEC.dice.minW : 0, pairW);
    let illu = 0, stackW = 0, rdSide = 0, rdBeside = false, stackH = 0;
    let illuFlow = false, clusterFlow = false;

    function layoutMedia(){
      illuFlow = has.illu && !illuOver;
      clusterFlow = stackMinW > 0 && !clusterOver;
      if (illuFlow) {
        illu = clusterFlow ? Math.min(SPEC.illu.target, w - G - stackMinW) : Math.min(SPEC.illu.target, w);
        if (clusterFlow && illu < SPEC.illu.min) {
          clusterOver = true; clusterFlow = false; illu = Math.min(SPEC.illu.target, w);
          steps.push("dicetrack, road die et round en surimpression : largeur insuffisante à côté de l'illustration");
        }
        stackW = clusterFlow ? w - illu - G : 0;
      } else { illu = 0; stackW = clusterFlow ? w : 0; }
      if (clusterFlow) {
        rdSide = has.roaddie
          ? Math.min(SPEC.roaddie.target, has.round ? stackW - SPEC.round.minW - G : stackW) : 0;
        rdBeside = has.roaddie && has.round && rdSide >= SPEC.roaddie.min;
        if (has.roaddie && !rdBeside) rdSide = Math.min(SPEC.roaddie.target, stackW);
        stackH = (has.dice ? diceH : 0)
               + (has.roaddie ? (has.dice ? G : 0) + rdSide : 0)
               + (has.round && !rdBeside ? ((has.dice || has.roaddie) ? G : 0) + SPEC.round.minH : 0);
      } else stackH = 0;
      return Math.max(illuFlow ? illu : 0, clusterFlow ? stackH : 0);
    }
    let mediaH = layoutMedia();

    let rowH = w / SPEC.dash.aspect, visible = SPEC.dash.minVisible;
    const rest = () => H - (infoH + mediaH + (drawer ? 0 : visible*rowH + (visible-1)*G)
                            + (mediaH ? 5 : 4)*G - (drawer ? G : 0));
    let boardH = rest(), guard = 0;
    while (boardH < boardMin(w) && guard++ < 5) {
      if (clusterFlow) { clusterOver = true;
        steps.push("dicetrack, road die et round en surimpression pour préserver les 6 rangées"); }
      else if (illuFlow) { illuOver = true;
        steps.push("illustration en surimpression pour préserver les 6 rangées"); }
      else if (infoH > SPEC.info.hOneLine) { infoH = SPEC.info.hOneLine;
        steps.push("texte court sur une ligne"); }
      else if (!drawer) { drawer = true;
        steps.push("dashboards en tiroir escamotable : hauteur insuffisante"); }
      else break;
      mediaH = layoutMedia();
      boardH = rest();
    }
    const cap = Math.min(boardMaxH, capByTile(w));
    let slack = 0;
    if (boardH > cap) {
      slack = boardH - cap; boardH = cap;
      while (!drawer && visible < players && slack >= rowH + G) { visible++; slack -= rowH + G;
        steps.push("un dashboard de plus tient à l'écran"); }
    }

    let y = G;
    put("board", G, y, w, boardH, Math.round(SPEC.board.tileW*(boardH/SPEC.board.vbH)), boardMin(w));
    const boardTop = y, boardBottom = y + boardH;
    y += boardH + G;
    put("info", G, y, w, infoH, SPEC.info.minW, SPEC.info.hOneLine); y += infoH + G;

    if (illuFlow) put("illu", G, y, illu, illu, SPEC.illu.min, SPEC.illu.min);
    if (clusterFlow) {
      const sx = G + (illuFlow ? illu + G : 0);
      let sy = y;
      if (has.dice) { put("dice", sx, sy, stackW, diceH, SPEC.dice.minW, SPEC.dice.minH); sy += diceH + G; }
      if (has.roaddie) {
        put("roaddie", sx, sy, rdSide, rdSide, SPEC.roaddie.min, SPEC.roaddie.min);
        if (rdBeside) put("round", sx+rdSide+G, sy+(rdSide-SPEC.round.minH)/2, stackW-rdSide-G,
                          SPEC.round.minH, SPEC.round.minW, SPEC.round.minH);
        sy += rdSide + G;
      }
      if (has.round && !rdBeside) put("round", sx, sy, stackW, SPEC.round.minH, SPEC.round.minW, SPEC.round.minH);
    }
    if (mediaH) y += mediaH + G;

    // Modules renvoyés en surimpression sur le plateau, faute de place.
    if (has.illu && !illuFlow)
      put("illu", W-G-8-SPEC.illu.min, boardTop+8, SPEC.illu.min, SPEC.illu.min,
          SPEC.illu.min, SPEC.illu.min, true);
    if (has.dice && !clusterFlow)
      put("dice", G+8, boardBottom-SPEC.dice.minH-8, SPEC.dice.minW, SPEC.dice.minH,
          SPEC.dice.minW, SPEC.dice.minH, true);
    if (has.roaddie && !clusterFlow)
      put("roaddie", W-G-8-SPEC.roaddie.min, boardBottom-SPEC.roaddie.min-8,
          SPEC.roaddie.min, SPEC.roaddie.min, SPEC.roaddie.min, SPEC.roaddie.min, true);
    // Le round garde toujours son second emplacement : coin haut-gauche du plateau.
    if (has.round && !clusterFlow)
      put("round", G+8, boardTop+8, SPEC.round.minW, SPEC.round.minH,
          SPEC.round.minW, SPEC.round.minH, true);

    for (let i=0;i<visible;i++) put("dash"+i, G, drawer ? H-G-rowH : y+i*(rowH+G), w, rowH,
      SPEC.dash.minW, SPEC.dash.minW/SPEC.dash.aspect, drawer);
    if (drawer) visible = 1;
    // L'espace restant sert d'amorce du dashboard suivant : le joueur voit qu'il peut défiler.
    if (!drawer && visible < players && slack >= 24) {
      put("dash"+visible, G, y+visible*(rowH+G), w, Math.min(slack-G, rowH), SPEC.dash.minW, 0);
      steps.push("amorce du dashboard suivant visible : indice de défilement");
    }
    z._visible = visible;
  }

  else if (profile === "landscape") {
    const w = W - 2*G;
    let infoH = W >= SPEC.info.oneLineFrom ? SPEC.info.hOneLine : SPEC.info.hTwoLines;
    // La colonne droite n'existe que si l'illustration est là : c'est elle
    // qui justifie 200 px de large. Seuls, un dicetrack ou un round ne
    // valent pas qu'on ampute le plateau.
    let side = has.illu ? Math.max(SPEC.illu.min, Math.min(SPEC.illu.target, w*0.22)) : 0;
    let sideFlow = has.illu && (w - side - G) >= SPEC.board.tileW + 40;
    if (has.illu && !sideFlow) { side = 0; steps.push("colonne droite abandonnée : le plateau perdrait sa tuile"); }
    let boardW = sideFlow ? w - side - G : w;

    let cols = 2, colW = (w - G)/2, drawer = false;
    if (colW < SPEC.dash.minW) { cols = 1; colW = w; steps.push("dashboards sur une colonne"); }
    let rowH = colW / SPEC.dash.aspect;
    const rest = () => H - (infoH + (drawer ? 0 : rowH) + (drawer ? 3 : 4)*G);
    let boardH = rest(), guard = 0;
    while (boardH < boardMin(boardW) && guard++ < 4) {
      if (colW > SPEC.dash.minW) { colW = SPEC.dash.minW; rowH = colW/SPEC.dash.aspect;
        steps.push("dashboards ramenés à leur largeur minimale"); }
      else if (infoH > SPEC.info.hOneLine) { infoH = SPEC.info.hOneLine; steps.push("texte court sur une ligne"); }
      else if (!drawer) { drawer = true; steps.push("dashboards en tiroir escamotable : écran trop plat"); }
      else break;
      boardH = rest();
    }
    boardH = Math.min(boardH, boardMaxH, capByTile(boardW));

    let y = G;
    put("board", G, y, boardW, boardH, Math.round(SPEC.board.tileW*(boardH/SPEC.board.vbH)), boardMin(boardW));
    // La colonne droite s'étend sur la hauteur du plateau ET de la bande d'info.
    const colH = boardH + G + infoH, sx = G + boardW + G;
    const colNeed = SPEC.illu.min + (has.dice ? SPEC.dice.minH + G : 0)
                                  + (has.round ? SPEC.round.minH + G : 0);
    const colOk = sideFlow && colH >= colNeed;
    if (colOk) {
      const ill = Math.min(side, colH - (colNeed - SPEC.illu.min));
      put("illu", sx, y, side, ill, SPEC.illu.min, SPEC.illu.min);
      let sy = y + ill + G;
      if (has.dice) { put("dice", sx, sy, side, SPEC.dice.minH, SPEC.dice.minW, SPEC.dice.minH); sy += SPEC.dice.minH + G; }
      if (has.round) put("round", sx, sy, side, SPEC.round.minH, SPEC.round.minW, SPEC.round.minH);
    } else {
      if (has.illu) put("illu", W-G-8-SPEC.illu.min, y+8, SPEC.illu.min, SPEC.illu.min,
                        SPEC.illu.min, SPEC.illu.min, true);
      if (has.dice) put("dice", G+8, y+boardH-SPEC.dice.minH-8, SPEC.dice.minW, SPEC.dice.minH,
                        SPEC.dice.minW, SPEC.dice.minH, true);
      if (has.round) put("round", G+8, y+8, SPEC.round.minW, SPEC.round.minH,
                        SPEC.round.minW, SPEC.round.minH, true);
      if (has.illu) steps.push("illustration, dicetrack et round en surimpression sur le plateau");
    }
    y += boardH + G;
    put("info", G, y, boardW, infoH, SPEC.info.minW, SPEC.info.hOneLine); y += infoH + G;
    const dy = drawer ? H - G - rowH : y;
    for (let i=0;i<cols;i++) put("dash"+i, G+i*(colW+G), dy, colW, rowH,
      SPEC.dash.minW, SPEC.dash.minW/SPEC.dash.aspect, drawer);
    // Le road die se loge dans la largeur laissée libre par les dashboards.
    if (has.roaddie) {
      const freeW = w - (cols*colW + (cols-1)*G) - G;
      if (freeW >= SPEC.roaddie.min && !drawer) {
        const rd = Math.min(SPEC.roaddie.target, freeW, rowH);
        put("roaddie", W-G-rd, dy+(rowH-rd)/2, rd, rd, SPEC.roaddie.min, SPEC.roaddie.min);
      } else put("roaddie", W-G-8-SPEC.roaddie.min, G+8, SPEC.roaddie.min, SPEC.roaddie.min,
                 SPEC.roaddie.min, SPEC.roaddie.min, true);
    }
    z._visible = cols;
  }

  else { /* wide */
    // Colonne latérale seulement si l'illustration est là (même raison
    // qu'en paysage) ; sinon le plateau prend toute la largeur.
    const sideW = has.illu ? Math.max(340, Math.min(420, W*0.26)) : 0;
    const leftW = has.illu ? W - sideW - 3*G : W - 2*G;
    let infoH = SPEC.info.hOneLine;
    let cols = 2, colW = (leftW - G)/2;
    if (colW < SPEC.dash.minW) { cols = 1; colW = leftW;
      steps.push("dashboards sur une colonne : la colonne latérale mange la largeur"); }
    let rowH = colW/SPEC.dash.aspect;
    let rows = Math.ceil(players/cols);
    const rest = () => H - (infoH + rows*rowH + (rows-1)*G + 4*G);
    let boardH = rest(), guard = 0;
    while (boardH < boardMin(leftW) && guard++ < 3) {
      if (rows > 1) { rows--; steps.push("une rangée de dashboards sur deux, les autres au défilement"); }
      else break;
      boardH = rest();
    }
    boardH = Math.min(boardH, boardMaxH, capByTile(leftW));

    let y = G;
    put("board", G, y, leftW, boardH, Math.round(SPEC.board.tileW*(boardH/SPEC.board.vbH)), boardMin(leftW));
    const boardTop = y;
    y += boardH + G;
    put("info", G, y, leftW, infoH, SPEC.info.minW, SPEC.info.hOneLine); y += infoH + G;
    let shown = 0;
    for (let r=0;r<rows;r++) for (let c=0;c<cols && shown<players;c++,shown++)
      put("dash"+shown, G+c*(colW+G), y+r*(rowH+G), colW, rowH, SPEC.dash.minW, SPEC.dash.minW/SPEC.dash.aspect);
    z._visible = shown;

    if (has.illu) {
      // Colonne latérale : illustration, dicetrack, road die, round — chacun son budget.
      const sx = W - sideW - G;
      const diceH = Math.max(SPEC.dice.minH, Math.min(140, sideW*SPEC.dice.minH/SPEC.dice.minW));
      const need = (has.dice ? diceH + G : 0) + (has.roaddie ? SPEC.roaddie.target + G : 0)
                 + (has.round ? SPEC.round.minH + G : 0) + G;
      let sy = G, ill = Math.min(sideW, 400, H - G - need);
      if (ill >= SPEC.illu.min) { put("illu", sx, sy, sideW, ill, SPEC.illu.min, SPEC.illu.min); sy += ill + G; }
      else { put("illu", W-sideW, H-G-8-SPEC.illu.min, SPEC.illu.min, SPEC.illu.min,
                  SPEC.illu.min, SPEC.illu.min, true);
             steps.push("illustration en surimpression : colonne latérale trop courte"); }
      if (has.dice) {
        if (H - sy - G >= diceH) { put("dice", sx, sy, sideW, diceH, SPEC.dice.minW, SPEC.dice.minH); sy += diceH + G; }
        else { put("dice", sx+8, H-G-8-SPEC.dice.minH, SPEC.dice.minW, SPEC.dice.minH,
                    SPEC.dice.minW, SPEC.dice.minH, true); steps.push("dicetrack en surimpression"); }
      }
      const rd = SPEC.roaddie.target;
      const rdOk = has.roaddie && H - sy - G >= rd;
      if (rdOk) {
        put("roaddie", sx, sy, rd, rd, SPEC.roaddie.min, SPEC.roaddie.min);
        if (has.round) put("round", sx+rd+G, sy+(rd-SPEC.round.minH)/2, sideW-rd-G, SPEC.round.minH,
                           SPEC.round.minW, SPEC.round.minH);
      } else {
        if (has.roaddie) put("roaddie", sx, H-G-SPEC.roaddie.min, SPEC.roaddie.min, SPEC.roaddie.min,
                             SPEC.roaddie.min, SPEC.roaddie.min, true);
        if (has.round) {
          if (H - sy - G >= SPEC.round.minH) put("round", sx, sy, sideW, SPEC.round.minH,
                                                 SPEC.round.minW, SPEC.round.minH);
          else put("round", G+8, boardTop+8, SPEC.round.minW, SPEC.round.minH,
                   SPEC.round.minW, SPEC.round.minH, true);
        }
      }
    } else {
      if (has.dice) put("dice", G+8, boardTop+boardH-SPEC.dice.minH-8, SPEC.dice.minW, SPEC.dice.minH,
                        SPEC.dice.minW, SPEC.dice.minH, true);
      if (has.roaddie) put("roaddie", W-G-8-SPEC.roaddie.min, boardTop+8, SPEC.roaddie.min, SPEC.roaddie.min,
                           SPEC.roaddie.min, SPEC.roaddie.min, true);
      if (has.round) put("round", G+8, boardTop+8, SPEC.round.minW, SPEC.round.minH,
                        SPEC.round.minW, SPEC.round.minH, true);
    }
  }

  const scale = z.board.h / SPEC.board.vbH;
  return { profile, zones:z, steps, ratio,
    cell: SPEC.board.cellW * scale,
    tiles: (z.board.w / scale) / SPEC.board.tileW,
    visible: z._visible, players };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { SPEC, boardMinH, boardMaxH, computeLayout };
}
