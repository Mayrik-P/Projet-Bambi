/**
 * Test jsdom dédié — RYTHME DES ANIMATIONS (chantier 4a), sur le vrai
 * bundle navigateur.
 *
 * Ce qui est vérifié ici, et qui n'existait pas avant ce chantier :
 *   1. la table de vitesses partagée (lent/moyen/rapide) et son point
 *      d'entrée setPaceSpeed(), prêt pour le futur menu Settings ;
 *   2. LE CŒUR DU CHANTIER : le jeu n'avance plus tant qu'une animation
 *      est en vol. Le test inscrit une animation factice qu'il contrôle
 *      lui-même, et vérifie que le tour de l'IA reste bloqué tant qu'il
 *      ne l'a pas libérée ;
 *   3. le gel de l'interface pendant une scène (plus aucune case
 *      cliquable, voile anti-clic posé) ;
 *   4. la non-régression hors navigateur : sans requestAnimationFrame,
 *      aucune animation n'existe, donc plus rien n'attend et tous les
 *      chemins restent aussi synchrones qu'avant.
 *
 * À lancer avec : node test-ui-rythme.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "tools", "prototype.html"), "utf8");

function section(title) { console.log("\n=== " + title + " ==="); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// pretendToBeVisual décide de la présence de requestAnimationFrame,
// donc de l'existence même des animations (voir scenePeutAnimer).
function makeDom(visuel) {
  return new JSDOM(html, { runScripts: "dangerously", resources: "usable", pretendToBeVisual: !!visuel });
}

// jsdom n'ouvre localStorage que sur une vraie origine : sans `url`,
// la page est en "about:blank" (origine opaque) et le moindre accès
// lève une exception — c'est d'ailleurs pourquoi tous les accès au
// stockage sont gardés par un try/catch dans ui-script.js. Le test de
// mémorisation a donc besoin de sa propre fenêtre, avec une origine.
function makeDomAvecStockage() {
  return new JSDOM(html, {
    runScripts: "dangerously",
    url: "https://mayrik-p.github.io/Projet-Bambi/tools/prototype.html"
  });
}

function clearHazardsAround(win, board, cells) {
  for (const { col, row } of cells) {
    const cell = win.getSpace(board, col, row);
    if (cell) cell.hazard = null;
  }
}

async function main() {
  section("Test 1 — Table de vitesses partagée (futur menu Settings)");

  const domV = makeDom(true);
  const winV = domV.window;
  winV.newGame();

  console.log("Vitesse par défaut = 500 ms (attendu true) :", winV.eval("PACE_MS") === 500);
  console.log("Nom de la vitesse par défaut = 'medium' (attendu true) :", winV.currentPaceSpeed() === "medium");
  console.log("setPaceSpeed('slow') → 900 ms (attendu true) :",
    winV.setPaceSpeed("slow") === true && winV.eval("PACE_MS") === 900);
  console.log("setPaceSpeed('fast') → 200 ms (attendu true) :",
    winV.setPaceSpeed("fast") === true && winV.eval("PACE_MS") === 200);
  console.log("setPaceSpeed('turbo') refusé, vitesse inchangée (attendu true) :",
    winV.setPaceSpeed("turbo") === false && winV.eval("PACE_MS") === 200);
  console.log("setPaceSpeed('medium') revient à 500 ms (attendu true) :",
    winV.setPaceSpeed("medium") === true && winV.eval("PACE_MS") === 500);

  section("Test 2 — Le tour de l'IA attend la fin des animations (cœur du chantier 4a)");

  const dom = makeDom(true);
  const win = dom.window;
  win.newGame();
  win.eval("PACE_MS = 10"); // battement réduit : ce test mesure l'attente des ANIMATIONS, pas le battement

  const HUMAN = win.eval("HUMAN");
  const OPPONENT = win.eval("OPPONENT");
  const CAR_SIZE = win.eval("CAR_SIZE");
  const G = win.eval("G");
  G.allCars.length = 0;
  const b = win.board();
  clearHazardsAround(win, b, [{ col: 4, row: 3 }, { col: 5, row: 3 }, { col: 6, row: 3 }]);
  const aiCar = win.createCar(OPPONENT, CAR_SIZE.SMALL, 3, 3);
  G.allCars.push(aiCar);
  G.roundState.dicePool[OPPONENT] = [3, 4, 4, 1];
  G.roundState.currentPlayerIndex = G.roundState.playerOrder.indexOf(OPPONENT);

  const decision = { car: aiCar, dieValue: 3, command: null, isEntry: false, isCoast: false, destination: { path: ["front", "front", "front"] }, slam: null, roadBonusPath: null };
  const gen = win.executeDecisionGen(G.progressionState, G.roundState, G.allCars, G.allChoppers, win.eval("PLAYER_NAMES"), OPPONENT, decision, {
    isHumanOwner: (owner) => owner === HUMAN,
    emitEvents: true
  });

  // Animation factice inscrite au registre AVANT le lancement : elle
  // tient lieu de dé encore en vol, et c'est le test qui décide quand
  // elle se termine.
  let libererAnimation;
  const animationBloquante = new Promise((r) => { libererAnimation = r; });
  win.suivreAnimation(animationBloquante);

  win.driveAiTurnGenerator(gen, "Test rythme", decision);
  const colApresPremierPas = aiCar.col;

  await sleep(150); // largement plus que le battement (10 ms) : seule l'animation peut encore retenir le tour
  console.log("Le tour reste bloqué tant que l'animation vole (attendu true) :",
    aiCar.col === colApresPremierPas && aiCar.col < 6);
  console.log("Le tour est toujours marqué en cours (attendu true) :", win.eval("G").aiAnimating === true);

  libererAnimation();
  await sleep(400);
  console.log("Une fois l'animation terminée, le tour reprend et s'achève en (col 6, row 3) (attendu true) :",
    aiCar.col === 6 && aiCar.row === 3);
  console.log("G.aiAnimating est repassé à false (attendu true) :", win.eval("G").aiAnimating === false);

  section("Test 3 — Gel de l'interface pendant une scène");

  const dom3 = makeDom(true);
  const win3 = dom3.window;
  win3.newGame();
  win3.eval("PACE_MS = 10");
  const G3 = win3.eval("G");
  G3.allCars.length = 0;
  const b3 = win3.board();
  clearHazardsAround(win3, b3, [{ col: 4, row: 3 }, { col: 4, row: 2 }, { col: 4, row: 4 }]);
  const humanCar = win3.createCar(HUMAN, CAR_SIZE.SMALL, 3, 3);
  G3.allCars.push(humanCar);
  win3.eval("sel = { step: 'move-step', car: G.allCars[0], remaining: 3 }");

  const casesAvant = win3.highlightedCells().length;
  console.log("Des cases sont bien cliquables avant le gel (attendu true) :", casesAvant > 0);

  let libererAnimation3;
  const animationBloquante3 = new Promise((r) => { libererAnimation3 = r; });
  win3.suivreAnimation(animationBloquante3);

  const gele = win3.gelerPendantLaScene();
  console.log("gelerPendantLaScene() signale un gel réel (attendu true) :", gele === true);
  console.log("G.uiLocked est passé à true (attendu true) :", win3.eval("G").uiLocked === true);
  console.log("Plus aucune case n'est cliquable pendant le gel (attendu true) :", win3.highlightedCells().length === 0);
  console.log("Le voile anti-clic est en place (attendu true) :", !!win3.document.getElementById("input-shield"));

  libererAnimation3();
  await sleep(400);
  console.log("Le gel est levé une fois la scène terminée (attendu true) :", win3.eval("G").uiLocked === false);
  console.log("Le voile anti-clic a disparu (attendu true) :", !win3.document.getElementById("input-shield"));
  console.log("Les cases redeviennent cliquables (attendu true) :", win3.highlightedCells().length === casesAvant);

  section("Test 4 — Non-régression hors navigateur : sans animation, rien n'attend jamais");

  const dom4 = makeDom(false); // pas de requestAnimationFrame : aucune animation ne peut exister
  const win4 = dom4.window;
  win4.newGame();
  win4.suivreAnimation(new Promise(() => {})); // promesse jamais résolue : elle ne doit bloquer personne

  console.log("scenePeutAnimer() est faux sans requestAnimationFrame (attendu true) :", win4.scenePeutAnimer() === false);
  console.log("animationsEnAttente() reste faux (attendu true) :", win4.animationsEnAttente() === false);
  console.log("attendreAnimations() rend null, donc les pilotes restent synchrones (attendu true) :", win4.attendreAnimations() === null);
  console.log("gelerPendantLaScene() ne gèle rien (attendu true) :",
    win4.gelerPendantLaScene() === false && win4.eval("G").uiLocked === false);

  section("Test 5 — Choix de la vitesse par bouton sur l'écran d'accueil");

  const dom5 = makeDomAvecStockage();
  const win5 = dom5.window;
  const boutons = () => Array.from(win5.document.querySelectorAll(".pace-btn"));

  console.log("Les trois boutons de vitesse existent (attendu true) :", boutons().length === 3);
  console.log("Le bouton actif au chargement est la vitesse en cours (attendu true) :",
    boutons().filter((b) => b.classList.contains("selected")).map((b) => b.dataset.pace).join() === "medium");

  boutons().find((b) => b.dataset.pace === "fast").click();
  console.log("Un clic sur 'Rapide' applique 200 ms (attendu true) :", win5.eval("PACE_MS") === 200);
  console.log("Le bouton actif a suivi, et lui seul (attendu true) :",
    boutons().filter((b) => b.classList.contains("selected")).map((b) => b.dataset.pace).join() === "fast");
  console.log("Le choix est mémorisé pour les prochaines sessions (attendu true) :",
    win5.localStorage.getItem(win5.eval("PACE_STORAGE_KEY")) === "fast");

  // Le bouton fixe la vitesse, il ne lance pas la partie : c'est le
  // choix du nombre d'IA qui démarre, avec la vitesse retenue.
  console.log("Aucune partie lancée par ce clic, l'écran d'accueil reste visible (attendu true) :",
    win5.document.getElementById("start-screen").style.display !== "none");
  win5.document.querySelector('.opponent-btn[data-ai-count="2"]').click();
  console.log("La partie démarre bien avec la vitesse choisie (attendu true) :",
    win5.eval("PACE_MS") === 200 && win5.document.getElementById("start-screen").style.display === "none");

  win5.eval("setPaceSpeed('medium')");
  win5.initPaceFromStorage();
  console.log("Au chargement suivant, la vitesse mémorisée est restaurée (attendu true) :",
    win5.currentPaceSpeed() === "fast" && win5.eval("PACE_MS") === 200);

  section("Test 6 — Empilement : le véhicule qui arrive se dessine PAR-DESSUS celui déjà là");

  // Bug signalé par Mayrik : depuis que les pauses de rythme rendent
  // l'empilement visible, l'ordre de dessin suivait l'ordre arbitraire
  // de G.allCars — tantôt l'un, tantôt l'autre par-dessus.
  const dom6 = makeDom(true);
  const win6 = dom6.window;
  win6.newGame();
  const G6 = win6.eval("G");
  G6.allCars.length = 0;
  const dejaLa = win6.createCar(HUMAN, CAR_SIZE.LARGE, 4, 3);
  const entrant = win6.createCar(OPPONENT, CAR_SIZE.SMALL, 4, 3); // même case : empilement
  G6.allCars.push(entrant, dejaLa); // ordre du tableau volontairement DÉFAVORABLE

  const ordreDessin = () => {
    const images = [...win6.document.getElementById("board").querySelectorAll("image")]
      .map((el) => el.getAttribute("href") || "");
    return {
      dejaLa: images.findIndex((h) => h.includes(win6.carImagePath(dejaLa))),
      entrant: images.findIndex((h) => h.includes(win6.carImagePath(entrant)))
    };
  };

  win6.eval("vehiculeEntrant = null");
  win6.render();
  const avant = ordreDessin();
  console.log("Les deux véhicules sont bien dessinés (attendu true) :", avant.dejaLa >= 0 && avant.entrant >= 0);
  // Sans cette vérification, le test passerait tout seul : il faut que
  // l'ordre brut de G.allCars soit bien le MAUVAIS au départ.
  console.log("Sans repère, l'ordre brut du tableau met le mauvais au-dessus (attendu true) :", avant.dejaLa > avant.entrant);

  // Le moteur annonce l'arrivée : c'est ce seul événement qui décide.
  win6.noterVehiculeEntrant({ type: "step", car: entrant });
  win6.render();
  const apres = ordreDessin();
  console.log("Le véhicule arrivé est dessiné en dernier, donc au-dessus (attendu true) :",
    apres.entrant > apres.dejaLa);

  // Slam en chaîne : la voiture percutée devient à son tour l'entrante.
  win6.noterVehiculeEntrant({ type: "step", car: dejaLa });
  win6.render();
  const inverse = ordreDessin();
  console.log("L'ordre suit le dernier arrivé, sans cas particulier (attendu true) :",
    inverse.dejaLa > inverse.entrant);

  // Le moteur peut aussi le dire explicitement au moment des dés.
  win6.noterVehiculeEntrant({ type: "slam-dice", topCar: entrant, bottomCar: dejaLa });
  win6.render();
  const parLesDes = ordreDessin();
  console.log("Le topCar annoncé avec les dés de slam fait foi (attendu true) :",
    parLesDes.entrant > parLesDes.dejaLa);

  section("Test 7 — Jeton de dégât : face visible pendant sa résolution, face cachée sinon");

  const dom7 = makeDom(true);
  const win7 = dom7.window;
  win7.newGame();

  console.log("Un Dent donne son image propre (attendu true) :",
    win7.damageImagePath({ type: "dent" }).endsWith("damage-dent.webp"));
  console.log("Un Skid donne la face de SA direction, pas une générique (attendu true) :",
    win7.damageImagePath({ type: "skid", skidDirection: "rear-left" }).endsWith("damage-skid-rear-left.webp"));
  console.log("Sans jeton, c'est le dos (attendu true) :", win7.damageImagePath(null).endsWith("damage-front.webp"));

  const G7 = win7.eval("G");
  const blesse = G7.allCars.find((c) => c.owner === HUMAN);
  const jeton = { type: "dazed" };
  blesse.damageTokens.push(jeton);
  const facesAffichees = () => [...win7.document.querySelectorAll("#dashboards-rail image")]
    .map((e) => e.getAttribute("href") || "").filter((h) => h.includes("damage"));

  win7.render();
  console.log("Hors résolution, le jeton est face cachée (attendu true) :",
    facesAffichees().some((h) => h.includes("damage-front.webp")) &&
    !facesAffichees().some((h) => h.includes("damage-dazed.webp")));

  // C'est l'événement du moteur qui ouvre et ferme la révélation.
  // Le jeton ne se pose face visible qu'une fois la scène ENTIÈRE
  // jouée dans la fenêtre Illustration : apparition du dos, puis
  // retournement, puis exposition de la face tirée. On attend donc la
  // durée réelle de la scène, lue dans le code plutôt que recopiée en
  // dur — sans quoi le test casserait au moindre réglage de rythme.
  win7.traiterEvenementPresentation({ type: "damage", car: blesse, token: jeton });
  const dureeScene = (() => { const t = win7.dureesRevelation(); return t.apparition + t.rotation + t.exposition; })();
  await sleep(dureeScene + 400);
  win7.render();
  console.log("Pendant sa résolution, il passe face visible (attendu true) :",
    facesAffichees().some((h) => h.includes("damage-dazed.webp")));

  win7.traiterEvenementPresentation({ type: "damage-resolved", car: blesse, token: jeton });
  win7.render();
  console.log("Une fois ses effets finis, il repasse face cachée (attendu true) :",
    !facesAffichees().some((h) => h.includes("damage-dazed.webp")) &&
    facesAffichees().some((h) => h.includes("damage-front.webp")));

  section("Test 8 — Le retour de la main au joueur ne coûte aucun battement");

  // Deux natures d'attente, une seule réglable : PACE_MS sépare deux
  // étapes que la MACHINE enchaîne, le retour de main n'est qu'une
  // latence. Ce test mesure la seconde en réglant la première très
  // haut : si la main revenait après un battement, elle mettrait au
  // moins 900 ms.
  console.log("Le battement de retour de main est nul (attendu true) :",
    win3.eval("BATTEMENT_RENDU_MAIN_MS") === 0);

  const dom8 = makeDom(true);
  const win8 = dom8.window;
  win8.newGame();
  win8.setPaceSpeed("slow"); // 900 ms entre deux étapes machine
  const G8 = win8.eval("G");
  G8.allCars.length = 0;
  const b8 = win8.board();
  clearHazardsAround(win8, b8, [{ col: 4, row: 3 }, { col: 4, row: 2 }, { col: 4, row: 4 }]);
  G8.allCars.push(win8.createCar(HUMAN, CAR_SIZE.SMALL, 3, 3));
  win8.eval("sel = { step: 'move-step', car: G.allCars[0], remaining: 3 }");

  let liberer8;
  win8.suivreAnimation(new Promise((r) => { liberer8 = r; }));
  win8.gelerPendantLaScene();
  const t0 = Date.now();
  liberer8();
  await sleep(120);
  const attenduSansBattement = Date.now() - t0;
  console.log("La main revient dès la fin de l'animation, pas un battement plus tard (attendu true) :",
    win8.eval("G").uiLocked === false && attenduSansBattement < 600);
  console.log("Les destinations sont de nouveau cliquables tout de suite (attendu true) :",
    win8.highlightedCells().length > 0);
  console.log("Le rythme machine→machine reste, lui, au réglage choisi (attendu true) :",
    win8.eval("PACE_MS") === 900);

  section("Test 9 — Révélation d'un jeton : trois temps 1/2/4, et tap pour écourter");

  const dom9 = makeDom(true);
  const win9 = dom9.window;
  win9.newGame();

  win9.setPaceSpeed("medium");
  const tMedium = win9.dureesRevelation();
  console.log("Les trois temps sont bien dans le rapport 1/2/4 (attendu true) :",
    tMedium.rotation === 2 * tMedium.apparition && tMedium.exposition === 4 * tMedium.apparition);

  win9.setPaceSpeed("fast");
  const tFast = win9.dureesRevelation();
  win9.setPaceSpeed("slow");
  const tSlow = win9.dureesRevelation();
  console.log("Le réglage joue sur la révélation, mais moins fort que sur le rythme (attendu true) :",
    tFast.exposition < tMedium.exposition && tMedium.exposition < tSlow.exposition &&
    (tSlow.exposition / tFast.exposition) < 2.5); // contre 4,5 pour PACE_PRESETS
  console.log("Même en Rapide, la face tirée reste lisible plus d'une seconde (attendu true) :",
    tFast.exposition >= 1000);

  win9.setPaceSpeed("medium");
  const G9 = win9.eval("G");
  const blesse9 = G9.allCars.find((c) => c.owner === HUMAN);
  const jeton9 = { type: "dent" };
  blesse9.damageTokens.push(jeton9);
  const faces9 = () => [...win9.document.querySelectorAll("#dashboards-rail image")]
    .map((e) => e.getAttribute("href") || "").filter((h) => h.includes("damage"));

  win9.traiterEvenementPresentation({ type: "damage", car: blesse9, token: jeton9 });
  console.log("Une scène est ouverte et son attrapeur de tap est posé (attendu true) :",
    !!win9.document.getElementById("scene-skip"));

  // Armement : un tap arrivé dans la foulée ne doit pas tuer la scène
  // avant qu'elle ne s'affiche (cas d'une cascade de dégâts, où deux
  // scènes s'enchaînent dans la même image).
  console.log("Un tap immédiat n'écourte pas encore (attendu true) :",
    win9.sauterSceneIllustration() === false);

  await sleep(250); // scène armée, et encore loin de sa fin (3,5 s)
  win9.render();
  console.log("À ce stade la scène joue encore, le jeton n'est pas posé (attendu true) :",
    !faces9().some((h) => h.includes("damage-dent.webp")));

  // Un clic AILLEURS ne passe pas : seul le rectangle de la fenêtre
  // Illustration écoute, pour ne pas écourter par erreur quand on tape
  // pour défiler ou zoomer.
  const voile9 = win9.document.getElementById("input-shield");
  if (voile9) voile9.dispatchEvent(new win9.MouseEvent("click", { bubbles: true }));
  console.log("Un clic sur le voile n'écourte rien (attendu true) :",
    win9.eval("sceneIllustration") !== null);

  win9.document.getElementById("scene-skip").dispatchEvent(new win9.MouseEvent("click", { bubbles: true }));
  await sleep(120);
  win9.render();
  console.log("Un tap sur la fenêtre Illustration mène directement à l'état final (attendu true) :",
    faces9().some((h) => h.includes("damage-dent.webp")));
  console.log("La scène est close et son attrapeur retiré (attendu true) :",
    win9.eval("sceneIllustration") === null && !win9.document.getElementById("scene-skip"));
  console.log("Un tap de plus ne fait rien (attendu true) :",
    win9.sauterSceneIllustration() === false);

  section("Test 10 — Le pas que le joueur choisit lui-même a un rythme fixe");

  // Mesuré sur le vrai bundle : du clic sur une case de destination
  // jusqu'au retour des cases cliquables. Avant ce réglage, ce délai
  // valait PACE_MS (≈1 s en Lent) — le joueur attendait avant son
  // propre coup suivant.
  async function delaiPasJoueur(vitesse) {
    const d = makeDom(true);
    const w = d.window;
    w.newGame();
    w.setPaceSpeed(vitesse);
    const Gm = w.eval("G");
    Gm.allCars.length = 0;
    const bm = w.board();
    clearHazardsAround(w, bm, [{ col: 4, row: 3 }, { col: 5, row: 3 }, { col: 6, row: 3 }]);
    const voiture = w.createCar(HUMAN, CAR_SIZE.MEDIUM, 4, 3);
    Gm.allCars.push(voiture);
    Object.assign(w.eval("sel"), {
      mode: "normal", commandAvailable: false, car: voiture, dieValue: 3, remaining: 3,
      slamOptions: { decideReroll: w.decideSlamRerollDefault }, roadEligible: false,
      hadSlam: false, hadDamage: false, roadBonusOffered: true, inRoadBonus: false, step: "move-step"
    });
    w.render();
    const t0 = Date.now();
    w.pickMoveStep({ direction: "front", col: 5, row: 3, outcome: "normal", cost: 1 });
    w.render();
    let delai = null;
    for (let i = 0; i < 300; i++) {
      if (voiture.col === 5 && w.highlightedCells().length > 0) { delai = Date.now() - t0; break; }
      await sleep(10);
    }
    return delai;
  }

  const dLent = await delaiPasJoueur("slow");
  const dRapide = await delaiPasJoueur("fast");
  console.log("Le battement du pas joueur est fixe, hors réglage (attendu true) :",
    win3.eval("BATTEMENT_PAS_JOUEUR_MS") === 200);
  console.log("En Lent, les destinations reviennent en moins de 600 ms (attendu true) :", dLent !== null && dLent < 600);
  console.log("Lent et Rapide donnent le même ressenti, à 150 ms près (attendu true) :",
    dRapide !== null && Math.abs(dLent - dRapide) < 150);

  section("Test 11 — Révélation d'un hazard : même scène, mêmes durées, même tap");

  const dom11 = makeDom(true);
  const win11 = dom11.window;
  win11.newGame();
  win11.setPaceSpeed("medium");

  const faceDe = (t) => win11.eval("HAZARD_FACE_IMAGE")[t] || "";
  console.log("Les cinq types de hazard ont une face, Mine et Wreck compris (attendu true) :",
    ["blank", "dirt", "oil_slick", "mine", "wreck"].every((t) => faceDe(t).includes("hazard-")));
  console.log("Seuls Road/Mud/Oil Slick restent posés sur la case (attendu true) :",
    Object.keys(win11.eval("HAZARD_REVEALED_IMAGE")).sort().join(",") === "blank,dirt,oil_slick");

  const imgIllu = () => { const e = win11.document.querySelector("#illu-module img"); return e ? e.src.split("/").pop() : "(vide)"; };

  // Un Wreck : aucune trace sur le plateau après résolution, la fenêtre
  // est donc le SEUL endroit où on peut le voir.
  win11.traiterEvenementPresentation({ type: "hazard", hazardType: "wreck", col: 4, row: 3 });
  console.log("Le dos générique s'affiche d'abord (attendu true) :", imgIllu() === "hazard-back.webp");
  console.log("Une scène écourtable est ouverte (attendu true) :", !!win11.document.getElementById("scene-skip"));

  const t11 = win11.dureesRevelation();
  await sleep(t11.apparition + t11.rotation + 150);
  console.log("Après le retournement, c'est la face du Wreck (attendu true) :", imgIllu() === "hazard-wreck.webp");

  await sleep(t11.exposition + 250);
  console.log("La fenêtre se vide et la scène se clôt (attendu true) :",
    imgIllu() === "(vide)" && win11.eval("sceneIllustration") === null);

  // Un type sans visuel connu (extensions à venir) n'ouvre aucune scène
  // plutôt que d'afficher une fenêtre vide.
  win11.traiterEvenementPresentation({ type: "hazard", hazardType: "sandworm", col: 4, row: 3 });
  console.log("Un hazard sans image connue n'ouvre pas de scène (attendu true) :",
    win11.eval("sceneIllustration") === null && !win11.document.getElementById("scene-skip"));

  section("Test 12 — Illustrations à deux véhicules : Slam et tir");

  const dom12 = makeDom(true);
  const win12 = dom12.window;
  win12.newGame();
  const G12 = win12.eval("G");
  G12.allCars.length = 0;
  const b12 = win12.board();
  clearHazardsAround(win12, b12, [{ col: 4, row: 3 }, { col: 5, row: 3 }]);
  const gros = win12.createCar(HUMAN, CAR_SIZE.LARGE, 4, 3);
  const petit = win12.createCar(win12.eval("OPPONENT"), CAR_SIZE.SMALL, 5, 3);
  G12.allCars.push(gros, petit);
  const q = (s) => win12.document.querySelector(s);

  // SLAM — topCar = la voiture entrante, celle qui percute : en HAUT,
  // même convention que le TOP du dé de Slam et que l'ordre de dessin
  // sur le plateau.
  win12.traiterEvenementPresentation({ type: "slam-dice", topCar: gros, bottomCar: petit });
  console.log("Le percutant est dans la moitié haute (attendu true) :",
    !!q(".illu-haut img") && q(".illu-haut").dataset.carId === String(gros.id));
  console.log("Le percuté est dans la moitié basse (attendu true) :",
    !!q(".illu-bas img") && q(".illu-bas").dataset.carId === String(petit.id));
  console.log("Le trait blanc sépare les deux moitiés (attendu true) :", !!q(".illu-trait"));
  console.log("Les deux boîtes ont la même taille, l'échelle vient des webp (attendu true) :",
    q(".illu-haut").className.includes("illu-demi") && q(".illu-bas").className.includes("illu-demi"));

  // Une relance réémet ses dés : la scène ne doit pas se rejouer.
  const boiteAvant = q(".illu-haut");
  win12.traiterEvenementPresentation({ type: "slam-dice", topCar: gros, bottomCar: petit, rerolled: true });
  console.log("Une relance ne rejoue pas l'entrée des véhicules (attendu true) :", q(".illu-haut") === boiteAvant);

  win12.traiterEvenementPresentation({ type: "slam-resolved", topCar: gros, bottomCar: petit });
  console.log("La résolution vide la fenêtre (attendu true) :", !q("#illu-module .illu-scene"));

  // TIR — le tireur entre seul, la cible n'arrive qu'une fois désignée.
  win12.illustrerTireur(gros);
  console.log("Le tireur occupe la moitié gauche, la droite reste vide (attendu true) :",
    !!q(".illu-gauche img") && !q(".illu-droite"));
  win12.illustrerCible(petit);
  console.log("La cible désignée entre par la droite (attendu true) :",
    !!q(".illu-droite img") && q(".illu-droite").dataset.carId === String(petit.id));

  win12.traiterEvenementPresentation({ type: "shoot-dice", shooter: gros, target: petit, hit: true });
  console.log("Le coup de feu pose un éclair et un criblage (attendu true) :", !!q(".illu-flash") && !!q(".illu-impact"));
  await sleep(400);
  console.log("L'éclair s'efface, le criblage reste sur la cible (attendu true) :", !q(".illu-flash") && !!q(".illu-impact"));

  win12.traiterEvenementPresentation({ type: "shoot-dice", shooter: gros, target: petit, hit: false });
  await sleep(400);
  console.log("Un tir manqué ne laisse aucun impact (attendu true) :", !q(".illu-impact"));

  win12.traiterEvenementPresentation({ type: "shoot-resolved", shooter: gros, target: petit, hit: false });
  console.log("La fin du tir vide la fenêtre (attendu true) :", !q("#illu-module .illu-scene"));

  console.log("\n=== Fin des tests dédiés (rythme des animations, 4a) ===");
}

main();
